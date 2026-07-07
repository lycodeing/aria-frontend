import type { APIRequestContext } from '@playwright/test';

import { expect, test } from '@playwright/test';

import {
  E2E_KFMANAGER_PASSWORD,
  E2E_KFMANAGER_USER,
  E2E_SUPERADMIN_PASSWORD,
  E2E_SUPERADMIN_USER,
  E2E_VBEN_NS_PREFIX,
} from './fixtures';

/**
 * N-03 多座席完整转交（P0-018 闭环回归）
 *
 * 目标：访客转人工 → superadmin 接入 → 转交给 kfmanager → kfmanager 端能看到该会话。
 *
 * 实现：
 *   - 全部 token 通过 /api/v1/auth/login 直拿，跳过 Vben 登录页时序问题
 *   - 用 page.addInitScript 在脚本运行前注入 core-access pinia 持久化 key（含 accessToken）
 *   - 直接 goto /customerservice/agent，Vben 路由 guard 看见 accessToken 后正常拉菜单 → 渲染工作台
 *   - 等 kfmanager 在后端 online 列表中 → API 触发转交 → UI 断言 `#${sid}` 出现
 *
 * 该用例闭环 P0-018：座席工作台 useSessionQueue/agent index 在 SSE TRANSFER 时
 * 推入新会话到 sessions 列表。
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

test('N-03 superadmin 接入 → 转交 kfmanager → kfmanager 端 UI 出现该 sessionId', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);

  const superToken = await apiLogin(
    request,
    E2E_SUPERADMIN_USER,
    E2E_SUPERADMIN_PASSWORD,
  );
  const mgrToken = await apiLogin(
    request,
    E2E_KFMANAGER_USER,
    E2E_KFMANAGER_PASSWORD,
  );

  // —— 注入 kfmanager pinia 持久化 token ——
  // N-11 修复：NS_PREFIX 改为从 fixtures 导出的常量，版本升级只需改一处
  const mgrCtx = await browser.newContext();
  await mgrCtx.addInitScript(
    ({ tok, prefix }) => {
      const payload = JSON.stringify({
        accessToken: tok,
        accessCodes: [],
        refreshToken: '',
        isLockScreen: false,
      });
      localStorage.setItem(`${prefix}-core-access`, payload);
      // 兼容老/新版本可能的别名 key
      localStorage.setItem('core-access', payload);
      // oxlint-disable-next-line no-document-cookie -- E2E addInitScript 为同步上下文，无法使用 cookieStore API
      document.cookie = `Authorization=${tok}; path=/`;
    },
    { tok: mgrToken, prefix: E2E_VBEN_NS_PREFIX },
  );

  const mgrPage = await mgrCtx.newPage();
  await mgrPage.goto('/customerservice/agent', {
    waitUntil: 'domcontentloaded',
  });

  // 页面就绪：等到工作台主标题旁的描述文案出现（描述只在主内容区出现一次）
  await expect(mgrPage.getByText('实时接待转接会话')).toBeVisible({
    timeout: 30_000,
  });
  // 给 SSE EventSource onopen 一点窗口
  await mgrPage.waitForTimeout(4000);

  // 验证 kfmanager 已被后端注册为 online
  await expect
    .poll(
      async () => {
        const r = await request.get(
          'http://localhost:8082/api/v1/sessions/agents/online',
          {
            headers: { Authorization: `Bearer ${superToken}` },
          },
        );
        const b = await r.json().catch(() => ({ data: [] }));
        const list: Array<{ id: string }> = b?.data ?? [];
        return list.some((a) => a.id === mgrToken);
      },
      { intervals: [1000, 2000, 3000], timeout: 30_000 },
    )
    .toBe(true);

  // —— 访客转人工 → superadmin 接入 → 转交 ——
  const sid = `pwn03-${Date.now()}`;
  const tferReq = await request.post(
    'http://localhost:8082/api/v1/chat/transfer',
    {
      headers: { 'Content-Type': 'application/json' },
      data: {
        sessionId: sid,
        userName: 'pw-tester',
        transferReason: 'N-03 回归',
        tag: '咨询',
      },
    },
  );
  expect(tferReq.ok()).toBeTruthy();

  const accepted = await request.post(
    `http://localhost:8082/api/v1/sessions/${sid}/accept`,
    { headers: { Authorization: `Bearer ${superToken}` } },
  );
  expect(accepted.ok()).toBeTruthy();

  const transferred = await request.post(
    `http://localhost:8082/api/v1/sessions/${sid}/transfer`,
    {
      headers: {
        Authorization: `Bearer ${superToken}`,
        'Content-Type': 'application/json',
      },
      data: { targetAgentId: mgrToken },
    },
  );
  if (!transferred.ok()) {
    throw new Error(
      `transfer 失败 ${transferred.status()}: ${await transferred.text()}`,
    );
  }

  // —— P0-018 关键断言：kfmanager 端 UI 自动出现 #sid ——
  await expect(mgrPage.locator(`text=#${sid}`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    mgrPage.locator(String.raw`text=/1\s*\/\s*5\s*会话接待中/`),
  ).toBeVisible({ timeout: 5000 });

  // 清理
  await request.post(`http://localhost:8082/api/v1/sessions/${sid}/close`, {
    headers: { Authorization: `Bearer ${mgrToken}` },
  });
  await mgrCtx.close();
});
