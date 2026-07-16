/**
 * CSAT（会话满意度评价）前端类型定义。
 *
 * 与后端 `docs/superpowers/plans/2026-07-16-csat.md` 中的接口契约一一对应：
 *   - CsatRequestPayload  = SSE/WS 的 `csat_request` 事件 data 信封
 *   - CsatOverviewData    = GET /dashboard/csat-overview（含扩展主概览字段）
 *   - CsatTrendItem       = GET /dashboard/csat-trend
 *   - CsatDistributionItem= GET /dashboard/csat-distribution
 *   - CsatByAgentItem     = GET /dashboard/csat-by-agent
 */

/** `csat_request` 实时事件的 data 信封（AI 流末尾 / 人工关闭推送） */
export interface CsatRequestPayload {
  /** 评价记录 ID（提交评分/跳过时回传） */
  csatId: number;
  /** 会话 ID */
  sessionId: string;
  /** 邀请提示文案 */
  message: string;
  /** 邀请过期时间（ISO 字符串），前端可用于倒计时/禁用 */
  expiresAt: string;
}

/** CSAT 概览（平均分 / 响应率 / 评价数） */
export interface CsatOverviewData {
  /** 近 30 天平均 CSAT 分（0.0 表示无数据） */
  csatAvgScore: number;
  /** 近 30 天评价响应率（0.0–1.0） */
  csatResponseRate: number;
  /** 近 30 天已评价总数 */
  csatRatedCount: number;
}

/** CSAT 均分趋势（按天聚合） */
export interface CsatTrendItem {
  /** 日期标签，yyyy-MM-dd */
  date: string;
  /** 当日平均评分（1–5） */
  avgScore: number;
  /** 当日评价数 */
  ratedCount: number;
}

/** CSAT 星级分布（1–5 星） */
export interface CsatDistributionItem {
  /** 星级 1~5 */
  score: number;
  /** 该星级评价数 */
  count: number;
  /** 占比（0–100） */
  percentage: number;
}

/** CSAT 分坐席评分 */
export interface CsatByAgentItem {
  agentId: null | number;
  agentName: null | string;
  /** 该坐席平均评分（1–5） */
  avgScore: number;
  /** 该坐席评价数 */
  ratedCount: number;
}

/** 访客提交评价请求体 */
export interface CsatRateRequest {
  /** 1–5 星 */
  score: number;
  /** 文字说明（可空） */
  comment?: string;
}
