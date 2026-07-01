import type { APIRequestContext, BrowserContext } from '@playwright/test';

import { expect, test } from '@playwright/test';

import {
  E2E_SUPERADMIN_PASSWORD,
  E2E_SUPERADMIN_USER,
  E2E_VBEN_NS_PREFIX,
} from './fixtures';

/**
 * N-05 座席端结束会话 → 访客端 code=1000 显示「会话已结束」。
 *
 * 验证 Bug-P0-012 修复：SessionQueueController.close 后访客 WS 主动 NORMAL 关闭。
 *
 * 改写策略（参考 N-03）：
 *   - 访客侧：真实 UI（/chat → 转人工），需要真实浏览器接收 WS code=1000
 *   - 座席侧：API 注入 token → addInitScript → goto /customerservice/agent
 *     跳过 Vben 登录页的时序问题
 *
 * 两个 fixme 原因已消除：
 *   1) 双 page 登录页抖动 → 改用 addInitScript 注入，无需经过登录页
 *   2) SSE 等待超时 → 改用 API accept，不依赖 SSE 推送队列
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

async function injectTokenCtx(ctx: BrowserContext, token: string) {
  await ctx.addInitScript(
    ({ tok, prefix }) => {
      const payload = JSON.stringify({
        accessToken: tok,
        accessCodes: [],
        refreshToken: '',
        isLockScreen: false,
      });
      localStorage.setItem(`${prefix}-core-access`, payload);
      localStorage.setItem('core-access', payload);
      document.cookie = `Authorization=${tok}; path=/`;
    },
    // N-11 修复：NS_PREFIX 改为从 fixtures 导出的常量，版本升级只需改一处
    { tok: token, prefix: E2E_VBEN_NS_PREFIX },
  );
}

test('N-05 座席 close → 访客侧显示「会话已结束」', async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

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
  await expect(visitorPage.getByText('已为您转接人工客服')).toBeVisible();

  // 获取访客 sessionId
  const sid = await visitorPage.evaluate(() =>
    localStorage.getItem('chat_session_id'),
  );
  expect(sid).toBeTruthy();

  // —— 座席：注入 token → 打开工作台（建立 SSE）→ API 接入 → 刷新让 onMounted 恢复 ACTIVE 会话 ——
  const agentCtx = await browser.newContext();
  await injectTokenCtx(agentCtx, superToken);
  const agentPage = await agentCtx.newPage();
  await agentPage.goto('/customerservice/agent', {
    waitUntil: 'domcontentloaded',
  });
  await expect(agentPage.getByText('实时接待转接会话')).toBeVisible({
    timeout: 30_000,
  });
  // 等 SSE 注册稳定，确保 ACCEPTED 广播时 emitter 已在列表
  await agentPage.waitForTimeout(3000);

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

  // —— 访客侧应当显示「会话已结束」（code=1000 WS 关闭触发） ——
  await expect(visitorPage.getByText('会话已结束')).toBeVisible({
    timeout: 15_000,
  });
  // 「转人工」按钮恢复
  await expect(
    visitorPage.getByRole('button', { name: '转人工' }),
  ).toBeVisible();

  await visitorCtx.close();
  await agentCtx.close();
});
