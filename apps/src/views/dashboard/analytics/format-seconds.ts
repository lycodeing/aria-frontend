/**
 * 将秒数格式化为人类可读字符串。
 * - 0 或负数 → '--'
 * - < 60 秒  → '45秒'
 * - ≥ 60 秒  → '1分32秒'
 */
export function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
