import type { APIRequestContext } from '@playwright/test';

import { expect, test } from '@playwright/test';

import { E2E_SUPERADMIN_PASSWORD, E2E_SUPERADMIN_USER } from './fixtures';

/**
 * N-05 座席端结束会话 → 访客端 code=1000 显示「会话已结束」。
 *
 * 验证 Bug-P0-012 修复：SessionQueueController.close 后访客 WS 主动 NORMAL 关闭。
 *
 * 改写策略（参考 N-03）：
 *   - 访客侧：真实 UI（/chat → 转人工），需要真实浏览器接收 WS code=1000
 *   - 座席侧：真实 UI 登录（superadmin）→ goto /customerservice/agent
 *     注：本项目登录守卫会做 API 校验并写入登录态，仅靠 token 注入（addInitScript）
 *         无法跳过登录页，故座席侧与访客侧一致走真实 UI 登录。
 *
 * 已消除的时序问题：
 *   1) SSE 等待超时 → 改用 API accept，不依赖 SSE 推送队列
 *   2) 结束会话需二次确认 → 点「结束会话」后点「确认结束」
 */

async function apiLogin(
  req: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const resp = await req.post('http://localhost:8083/api/v1/auth/login', {
    data: { username, password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok())
    throw new Error(`API 登录失败 ${username}: HTTP ${resp.status()}`);
  const body = await resp.json();
  const t: string | undefined = body?.data?.tokenValue;
  if (!t) throw new Error(`登录响应无 tokenValue: ${JSON.stringify(body)}`);
  return t;
}

test('N-05 座席 close → 访客侧显示「会话已结束」', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);

  const superToken = await apiLogin(
    request,
    E2E_SUPERADMIN_USER,
    E2E_SUPERADMIN_PASSWORD,
  );

  // —— 访客：真实 UI，/chat → 转人工，等 WS code=1000 信号 ——
  const visitorCtx = await browser.newContext();
  const visitorPage = await visitorCtx.newPage();
  await visitorPage.goto('/chat', { waitUntil: 'domcontentloaded' });
  await visitorPage.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (error) {
      void error;
    }
  });
  await visitorPage.reload();

  const input = visitorPage.getByRole('textbox', { name: '输入您的问题...' });
  await expect(input).toBeVisible();
  await input.fill('N-05 回归测试：会话结束流程');
  // 用 Enter 键触发发送（避免按钮 locator 不稳定）
  await visitorPage.keyboard.press('Enter');
  await expect(
    visitorPage.getByText('N-05 回归测试：会话结束流程'),
  ).toBeVisible();
  await visitorPage.getByRole('button', { name: '转人工' }).click();
  // 访客页转接成功后的真实标识是 header「👤 人工服务中」
  // （old: 「已为您转接人工客服」仅存在于座席侧 chat 页与 SSE toast，访客 /chat 页无此文案）
  await expect(visitorPage.getByText('人工服务中')).toBeVisible();

  // 获取访客 sessionId
  const sid = await visitorPage.evaluate(() =>
    localStorage.getItem('chat_session_id'),
  );
  expect(sid).toBeTruthy();

  // —— 座席：真实 UI 登录（token 注入无法绕过本项目登录守卫）→ 打开工作台（建立 SSE）→ API 接入 ——
  const agentCtx = await browser.newContext();
  const agentPage = await agentCtx.newPage();
  await agentPage.goto('/auth/login');
  await agentPage
    .getByRole('textbox', { name: '请输入用户名' })
    .fill(E2E_SUPERADMIN_USER);
  await agentPage
    .getByRole('textbox', { name: '密码' })
    .fill(E2E_SUPERADMIN_PASSWORD);
  await agentPage.getByRole('button', { name: 'login' }).click();
  await agentPage.waitForURL(/\/(analytics|customerservice)/, {
    timeout: 15_000,
  });
  await agentPage.goto('/customerservice/agent', {
    waitUntil: 'domcontentloaded',
  });
  // 「座席工作台」为 Page 组件可见 title（原 description「实时接待转接会话」仅作 tooltip 不可见，已废弃）。
  // 该文案在顶部导航与页面标题两处都出现，需限定到页面标题 div（text-lg font-semibold）以唯一匹配，避免严格模式多匹配。
  await expect(
    agentPage.locator('.text-lg.font-semibold', { hasText: '座席工作台' }),
  ).toBeVisible({
    timeout: 30_000,
  });
  // 缩短座席准备期，减少访客 WS 空闲掉线→重连导致的关闭延迟
  await agentPage.waitForTimeout(1000);

  // 通过 API 接入（不依赖 SSE 推送队列）
  const acceptResp = await request.post(
    `http://localhost:8082/api/v1/sessions/${sid}/accept`,
    { headers: { Authorization: `Bearer ${superToken}` } },
  );
  expect(acceptResp.ok()).toBeTruthy();

  // 刷新页面：onMounted 调用 getActiveSessionsApi 拿到 ACTIVE 会话，
  // 并调用 connectAgentSession 建立 /ws/agent/{sid} 连接，
  // 从而触发 notifyVisitor(AGENT_JOINED) → 访客 WS 端收到接入通知
  await agentPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(agentPage.getByText('实时接待转接会话')).toBeVisible({
    timeout: 20_000,
  });

  // 等访客侧收到 AGENT_JOINED（此时 visitorSessions 里有访客 WS，close 才能发 code=1000）
  await expect(visitorPage.getByText('人工客服已接入')).toBeVisible({
    timeout: 20_000,
  });
  // 确认工作台出现「结束会话」
  await expect(agentPage.getByRole('button', { name: '结束会话' })).toBeVisible(
    { timeout: 10_000 },
  );

  // —— 座席点击「结束会话」——
  await agentPage.getByRole('button', { name: '结束会话' }).click();
  // 结束会话需二次确认（防误关），弹出确认弹窗
  await expect(agentPage.getByRole('button', { name: '确认结束' })).toBeVisible(
    { timeout: 5000 },
  );
  await agentPage.getByRole('button', { name: '确认结束' }).click();

  // —— 访客侧应当进入结束态（code=1000 WS 关闭触发 onSessionClosed → sessionEnded=true）——
  // 用唯一的「开始新对话」按钮（仅结束态 v-if 渲染）作为断言，规避「会话已结束」多匹配与时机抖动。
  await expect(
    visitorPage.getByRole('button', { name: '开始新对话' }),
  ).toBeVisible({
    // 访客 WS 在座席准备阶段空闲时可能触发非正常断线→重连（累计 1+3+8=12s，偶发多轮），
    // code=1000 关闭因此晚于点击「确认结束」抵达；放宽到 90s 以覆盖重连后关闭。
    timeout: 90_000,
  });
  // 「转人工」按钮恢复
  await expect(
    visitorPage.getByRole('button', { name: '转人工' }),
  ).toBeVisible();

  await visitorCtx.close();
  await agentCtx.close();
});
