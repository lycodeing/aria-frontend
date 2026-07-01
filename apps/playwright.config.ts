import type { PlaywrightTestConfig } from '@playwright/test';

import { devices } from '@playwright/test';

/**
 * web-antd 端到端回归配置。
 *
 * <p>S-04：测试账号凭据从 .env.test.local 加载，该文件已在 .gitignore 通过 *.local 规则忽略。
 * CI 中通过 GitHub Secrets 以环境变量方式注入。
 * <p>Playwright 支持通过 use.testMatch 旁边的 env 文件自动加载，但为保持显式可读，
 * 改在 process.env 读时提供默认值，生产 CI 须通过 secrets 覆盖。
 */
const config: PlaywrightTestConfig = {
  expect: { timeout: 8000 },
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  outputDir: 'node_modules/.e2e/results',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'node_modules/.e2e/report' }],
  ],
  retries: process.env.CI ? 1 : 0,
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    actionTimeout: 10_000,
    baseURL: process.env.BASE_URL ?? 'http://localhost:5670',
    headless: !!process.env.CI,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  workers: 1,
};

export default config;
