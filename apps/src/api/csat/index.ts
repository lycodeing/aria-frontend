import type {
  CsatByAgentItem,
  CsatDistributionItem,
  CsatOverviewData,
  CsatRateRequest,
  CsatTrendItem,
} from './types';

import type { TimeRange } from '#/api/dashboard';

import { toTimeRangeParams } from '#/api/dashboard';
/**
 * CSAT（会话满意度评价）API。
 *
 * 两类 client：
 *   - publicConversationClient：访客公开接口（无 token 注入），用于访客提交/跳过评价。
 *   - conversationClient：座席/管理员接口（带 token），用于看板统计查询。
 *
 * 路径前缀对齐项目服务域拆分约定（vite proxy /conversation → conversation-service:8082）。
 * 后端计划文档中的 `/api/v1/chat/csat/...` 与 `/api/v1/dashboard/...` 在本项目统一为
 * `/conversation/api/v1/chat/csat/...` 与 `/conversation/api/v1/dashboard/...`。
 */
import { conversationClient, publicConversationClient } from '#/api/request';

// 统一从模块根导出类型，调用方无需感知 ./types 子路径
export type {
  CsatByAgentItem,
  CsatDistributionItem,
  CsatOverviewData,
  CsatRateRequest,
  CsatRequestPayload,
  CsatTrendItem,
} from './types';

const publicClient = publicConversationClient;
const agentClient = conversationClient;

// ─── 访客侧（公开，无 token） ──────────────────────────────────────────────────

/**
 * 访客提交评分。
 * POST /conversation/api/v1/chat/csat/{csatId}/rate
 */
export async function rateCsatApi(
  csatId: number,
  req: CsatRateRequest,
): Promise<void> {
  return publicClient.post(`/chat/csat/${csatId}/rate`, req);
}

/**
 * 访客跳过评价。
 * POST /conversation/api/v1/chat/csat/{csatId}/skip
 */
export async function skipCsatApi(csatId: number): Promise<void> {
  return publicClient.post(`/chat/csat/${csatId}/skip`);
}

// ─── 看板侧（座席/管理员，带 token） ───────────────────────────────────────────

/**
 * CSAT 概览（平均分 / 响应率 / 评价数）。
 * GET /conversation/api/v1/dashboard/csat-overview
 */
export async function getCsatOverviewApi(): Promise<CsatOverviewData> {
  return agentClient.get('/dashboard/csat-overview');
}

/**
 * CSAT 均分趋势（按天）。
 * GET /conversation/api/v1/dashboard/csat-trend
 */
export async function getCsatTrendApi(
  range: TimeRange = 'month',
): Promise<CsatTrendItem[]> {
  return agentClient.get('/dashboard/csat-trend', {
    params: toTimeRangeParams(range),
  });
}

/**
 * CSAT 星级分布（1–5 星）。
 * GET /conversation/api/v1/dashboard/csat-distribution
 */
export async function getCsatDistributionApi(): Promise<
  CsatDistributionItem[]
> {
  return agentClient.get('/dashboard/csat-distribution');
}

/**
 * CSAT 分坐席评分。
 * GET /conversation/api/v1/dashboard/csat-by-agent
 */
export async function getCsatByAgentApi(
  page = 1,
  size = 20,
): Promise<CsatByAgentItem[]> {
  return agentClient.get('/dashboard/csat-by-agent', {
    params: { page, size },
  });
}
