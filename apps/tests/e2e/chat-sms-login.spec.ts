import { expect, test } from './fixtures';

/**
 * N-01 访客手机号验证码登录。
 *
 * 验证 Bug-P0-013 修复：前端 SMS 路径补全 `/chat`，使
 *   POST /chat-api/chat/auth/sms/send 不再 404。
 *
 * 完整业务（验证码 → token → 自动重试问题）需要从后端日志拿验证码，
 * 这里只断言：发送按钮点击后倒计时启动 + 表单进入验证码输入态。
 */
test('N-01 SMS 验证码发送按钮可用 + 倒计时启动', async ({ page }) => {
  await page.goto('/chat');
  const input = page.getByRole('textbox', { name: '输入您的问题...' });

  // 触发需要鉴权的关键词，弹出身份验证对话框
  await input.fill('我想查询我的订单');
  await page
    .locator('button[type="submit"]')
    .or(input.locator('xpath=..').locator('button').first())
    .click();

  await expect(page.getByText('需要验证手机号')).toBeVisible({ timeout: 8000 });

  const phoneInput = page.getByPlaceholder('请输入手机号');
  await phoneInput.fill('13800138000');
  await page.getByRole('button', { name: '发送验证码' }).click();

  // 发送成功后按钮变为"xs 后重发"文本，且验证码输入框出现
  await expect(page.getByRole('button', { name: /\d+s 后重发/ })).toBeVisible({
    timeout: 8000,
  });
  await expect(page.getByPlaceholder('请输入 6 位验证码')).toBeVisible();
});
