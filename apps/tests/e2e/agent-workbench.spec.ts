/**
 * 客服工作台（/customerservice/agent）UI 自动化用例（增量补充）
 *
 * 覆盖本次功能完善后新增/强化的交互：
 *   - TC-WB-SEARCH   队列搜索（姓名 / 标签 / 会话编号）
 *   - TC-WB-CTX      右栏"会话信息"真实数据（姓名 / 编号 / 标签 / 排队时长 / 消息轮数）
 *   - TC-WB-CLOSE-01 结束会话二次确认弹窗
 *   - TC-WB-CONN-03  当前会话 WS 连接状态点（已连接）
 *
 * 运行依赖：后端 8082（会话/对话）/ 8083（auth）就绪，前端 dev server 在 BASE_URL（默认 5670）。
 * 鉴权：复用 N-03/N-05 的「直取 token + addInitScript 注入」模式，跳过 Vben 登录页时序。
 */
import type { APIRequestContext, BrowserContext } from '@playwright/test';

import { expect, test } from '@playwright/test';

import {
  E2E_SUPERADMIN_PASSWORD,
  E2E_SUPERADMIN_USER,
  E2E_VBEN_NS_PREFIX,
} from './fixtures';

const AUTH_BASE = 'http://localhost:8083/api/v1/auth/login';
const SESSION_BASE = 'http://localhost:8082/api/v1/sessions';
const CHAT_BASE = 'http://localhost:8082/api/v1/chat';

async function apiLogin(
  req: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const resp = await req.post(AUTH_BASE, {
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
      // oxlint-disable-next-line no-document-cookie -- E2E addInitScript 为同步上下文，无法使用 cookieStore API
      document.cookie = `Authorization=${tok}; path=/`;
    },
    { tok: token, prefix: E2E_VBEN_NS_PREFIX },
  );
}

/** 制造一个等待队列项（访客转人工），返回 sid */
async function seedWaitingSession(
  req: APIRequestContext,
  sid: string,
  userName: string,
  tag: string,
  transferReason: string,
): Promise<void> {
  const r = await req.post(`${CHAT_BASE}/transfer`, {
    headers: { 'Content-Type': 'application/json' },
    data: { sessionId: sid, userName, tag, transferReason },
  });
  if (!r.ok()) throw new Error(`transfer 失败 ${sid}: ${await r.text()}`);
}

test.describe('客服工作台 UI 增强场景', () => {
  test('TC-WB-SEARCH 队列搜索按姓名过滤等待队列', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await apiLogin(
      request,
      E2E_SUPERADMIN_USER,
      E2E_SUPERADMIN_PASSWORD,
    );
    const sidA = `wbsearch-a-${Date.now()}`;
    const sidB = `wbsearch-b-${Date.now()}`;
    await seedWaitingSession(request, sidA, '赵搜索测试', '投诉', '搜索回归A');
    await seedWaitingSession(request, sidB, '钱搜索测试', '退款', '搜索回归B');

    const ctx = await browser.newContext();
    await injectTokenCtx(ctx, token);
    const page = await ctx.newPage();
    await page.goto('/customerservice/agent', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('实时接待转接会话')).toBeVisible({
      timeout: 30_000,
    });
    // 等待队列加载 + SSE 注册
    await page.waitForTimeout(3000);
    await expect(page.locator(`text=#${sidA}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(`text=#${sidB}`)).toBeVisible({
      timeout: 10_000,
    });

    // 在搜索框输入"赵"，仅匹配 sidA
    const search = page.getByPlaceholder('搜索姓名 / 标签 / 会话编号');
    await search.fill('赵');
    await expect(page.locator(`text=#${sidA}`)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(`text=#${sidB}`)).toHaveCount(0);

    // 无匹配态
    await search.fill('不存在的关键字xyz');
    await expect(page.getByText(/未找到匹配/)).toBeVisible({ timeout: 5000 });

    // 清空恢复
    await search.fill('');
    await expect(page.locator(`text=#${sidB}`)).toBeVisible({
      timeout: 5000,
    });

    // 清理
    await request
      .post(`${SESSION_BASE}/${sidA}/close`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .catch(() => {});
    await request
      .post(`${SESSION_BASE}/${sidB}/close`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .catch(() => {});
    await ctx.close();
  });

  test('TC-WB-CTX 右栏会话信息展示真实数据', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const token = await apiLogin(
      request,
      E2E_SUPERADMIN_USER,
      E2E_SUPERADMIN_PASSWORD,
    );
    const sid = `wbctx-${Date.now()}`;
    const userName = '上下文测试员';
    const tag = '投诉';
    const reason = 'CTX 回归：账单异议';
    await seedWaitingSession(request, sid, userName, tag, reason);

    const ctx = await browser.newContext();
    await injectTokenCtx(ctx, token);
    const page = await ctx.newPage();
    await page.goto('/customerservice/agent', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('实时接待转接会话')).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(2000);

    // API 接入后刷新，让 onMounted 恢复 ACTIVE 会话
    const accept = await request.post(`${SESSION_BASE}/${sid}/accept`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(accept.ok()).toBeTruthy();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('实时接待转接会话')).toBeVisible({
      timeout: 20_000,
    });

    // 右栏"会话信息"卡片
    await expect(page.getByText('会话信息')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`text=#${sid}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(userName)).toBeVisible({ timeout: 5000 });
    // 标签着色 + 排队时长（mm:ss）
    await expect(page.getByText(tag)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/\d+:\d{2}/)).toBeVisible({ timeout: 5000 });
    // 转接原因
    await expect(page.getByText(reason)).toBeVisible({ timeout: 5000 });

    // 清理
    await request
      .post(`${SESSION_BASE}/${sid}/close`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .catch(() => {});
    await ctx.close();
  });

  test('TC-WB-CLOSE-01 结束会话弹出二次确认', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const token = await apiLogin(
      request,
      E2E_SUPERADMIN_USER,
      E2E_SUPERADMIN_PASSWORD,
    );
    const sid = `wbclose-${Date.now()}`;
    await seedWaitingSession(
      request,
      sid,
      '结束确认测试',
      '咨询',
      'CLOSE 回归',
    );

    const ctx = await browser.newContext();
    await injectTokenCtx(ctx, token);
    const page = await ctx.newPage();
    await page.goto('/customerservice/agent', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('实时接待转接会话')).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(2000);
    const accept = await request.post(`${SESSION_BASE}/${sid}/accept`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(accept.ok()).toBeTruthy();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('实时接待转接会话')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(`text=#${sid}`)).toBeVisible({
      timeout: 10_000,
    });

    // 点击"结束会话" → 出现"确认结束"弹窗；取消则保留
    await page.getByRole('button', { name: '结束会话' }).click();
    const confirmBtn = page.getByRole('button', { name: '确认结束' });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: '取消' }).click();
    await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    await expect(page.locator(`text=#${sid}`)).toBeVisible({ timeout: 5000 });

    // 再次确认结束 → 会话清空
    await page.getByRole('button', { name: '结束会话' }).click();
    await confirmBtn.click();
    await expect(page.getByText('暂无进行中的会话')).toBeVisible({
      timeout: 10_000,
    });

    await ctx.close();
  });

  test('TC-WB-CONN-03 当前会话 WS 状态点显示已连接', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const token = await apiLogin(
      request,
      E2E_SUPERADMIN_USER,
      E2E_SUPERADMIN_PASSWORD,
    );
    const sid = `wbconn-${Date.now()}`;
    await seedWaitingSession(request, sid, '连接态测试', '咨询', 'CONN 回归');

    const ctx = await browser.newContext();
    await injectTokenCtx(ctx, token);
    const page = await ctx.newPage();
    await page.goto('/customerservice/agent', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('实时接待转接会话')).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(2000);
    const accept = await request.post(`${SESSION_BASE}/${sid}/accept`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(accept.ok()).toBeTruthy();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('实时接待转接会话')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(`text=#${sid}`)).toBeVisible({
      timeout: 10_000,
    });

    // WS 建连后状态点文案应为"已连接"（短暂 connecting 后转 open）
    await expect(page.getByText('已连接')).toBeVisible({ timeout: 15_000 });

    await request
      .post(`${SESSION_BASE}/${sid}/close`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .catch(() => {});
    await ctx.close();
  });
});
