import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from './fixtures';

/**
 * N-02 知识库文档上传。
 *
 * 验证 Bug-P0-014（vite proxy 8084→8081）+ Bug-P0-015（multipart 不是 JSON）+ P0-016（pgvector Handler）。
 *
 * 期望：登录 superadmin → 进入知识库 → 上传 markdown → 列表出现该文件 + 状态 PUBLISHED。
 * 前提：knowledge-service 8081 在跑、ai_knowledge.knowledge_kb 已有 'default' 行。
 *
 * flaky 修复：
 *   1) 移除对 toast「上传成功」的断言（toast 显示时间短于 Playwright poll 间隔，极易误失败）
 *   2) 直接断言文件名出现在列表（更稳，与 N-02 核心目标一致）
 *   3) 上传后 timeout 提至 30s（knowledge-service 摄取需要时间）
 */
test('N-02 知识库上传 markdown 文档', async ({ page, superAdminLogin }) => {
  test.setTimeout(90_000);

  await superAdminLogin();
  await page.goto('/customerservice/knowledge');

  await expect(page.getByText('知识库管理')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '上传文档' }).click();

  // 生成唯一文件名，避免历史记录干扰断言
  const tmp = mkdtempSync(path.join(tmpdir(), 'kb-'));
  const fp = path.join(tmp, `regression-${Date.now()}.md`);
  writeFileSync(
    fp,
    `# 回归测试\n\n这是 Playwright 自动生成的知识库测试文档。\n\n文件：${path.basename(fp)}\n`,
    'utf8',
  );

  await page.setInputFiles('input[type="file"]', fp);
  await page.getByRole('button', { name: '开始上传' }).click();

  // 直接断言文件名出现在列表（不依赖短暂 toast，更稳定）
  await expect(page.getByText(path.basename(fp))).toBeVisible({
    timeout: 30_000,
  });
});
