/**
 * 分析概览页图表配色色板
 *
 * ECharts 运行在 canvas 中，无法读取 CSS 变量，因此这里用 TS 常量与主题主色
 * （#3B82F6 / HSL 217 91% 60%）保持同步。主色一旦调整，此处需一并更新。
 */
export const CHART_COLORS = {
  /** 主题主蓝 */
  primary: '#3B82F6',
  /** 成功绿（AI 会话 / AI 回复占比） */
  success: '#10B981',
  /** 紫色（辅助维度） */
  purple: '#A78BFA',
  /** 青色（辅助维度） */
  cyan: '#06B6D4',
  /** 蓝绿（辅助维度） */
  teal: '#14B8A6',
  /** 琥珀（警示 / 中等问题） */
  amber: '#F59E0B',
  /** 红色（错误 / 复杂问题） */
  red: '#EF4444',
} as const;

/** 多系列图表的统一调色板（饼图 / 玫瑰图 / 雷达等） */
export const CHART_PALETTE: string[] = [
  CHART_COLORS.primary,
  CHART_COLORS.purple,
  CHART_COLORS.cyan,
  CHART_COLORS.teal,
  CHART_COLORS.amber,
  CHART_COLORS.red,
];
