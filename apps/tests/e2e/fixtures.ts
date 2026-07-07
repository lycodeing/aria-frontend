import { env } from 'node:process';

import { test as base, expect } from '@playwright/test';

/**
 * S-04：测试账号凭据从环境变量读取，不再硬编码。
 * 本地开发：在 .env.test.local 中配置（已在 .gitignore 中忽略）。
 * CI：通过 GitHub Secrets / 环境变量注入。
 */
export const E2E_SUPERADMIN_USER = env.E2E_SUPERADMIN_USER ?? 'superadmin';
export const E2E_SUPERADMIN_PASSWORD =
  env.E2E_SUPERADMIN_PASSWORD ?? 'Test@123456';
export const E2E_KFMANAGER_USER = env.E2E_KFMANAGER_USER ?? 'kfmanager';
export const E2E_KFMANAGER_PASSWORD =
  env.E2E_KFMANAGER_PASSWORD ?? 'Test@123456';
/** Vben pinia-plugin-persistedstate 持久化 key 前缀，版本升级后同步维护 */
export const E2E_VBEN_NS_PREFIX =
  env.VBEN_NS_PREFIX ?? 'vben-web-antd-5.7.0-dev';

/**
 * 共享 Fixture：
 * - cleanStorage：每个用例前清掉 localStorage / sessionStorage，避免遗留 chat_session_id
 * - login：以 superadmin/Test@123456 登录座席工作台
 *
 * 用 SuperAdmin 账号验证 UI 行为；多座席转交另写专门用例（kfmanager + isolated context）
 */
export const test = base.extend<{
  cleanStorage: undefined;
  superAdminLogin: () => Promise<void>;
}>({
  cleanStorage: [
    async ({ page }, use) => {
      // 先访问 baseURL 拿到正确 origin，再清 storage，否则 evaluate 在 about:blank 会抛
      await page.goto('/chat');
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (error) {
          void error;
        }
      });
      // 清完再 reload，避免 in-memory state 仍持有旧 chat_session_id
      await page.reload();
      await use();
    },
    { auto: true },
  ],
  superAdminLogin: async ({ page }, use) => {
    await use(async () => {
      await page.goto('/auth/login');
      await page
        .getByRole('textbox', { name: '请输入用户名' })
        .fill(E2E_SUPERADMIN_USER);
      await page
        .getByRole('textbox', { name: '密码' })
        .fill(E2E_SUPERADMIN_PASSWORD);
      await page.getByRole('button', { name: 'login' }).click();
      await page.waitForURL(/\/(analytics|customerservice)/, {
        timeout: 15_000,
      });
    });
  },
});

export { expect };
