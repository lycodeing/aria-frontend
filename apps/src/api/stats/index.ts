/**
 * 观测统计接口（管理端，/stats/* 页面）。
 *
 * 对接 conversation-service AdminStatsController：
 *   GET /admin/stats/intent-classification
 *   GET /admin/stats/rag-quality
 *   GET /admin/stats/llm-cost
 * 均需 token（system:session:query），故走 conversationClient。
 *
 * 注意：入参 period 用 code（today/7d/30d），返回体里的 period 字段是枚举名
 * （TODAY/LAST_7D/LAST_30D），前端只用于展示，不用它反推区间。
 */
import { conversationClient } from '#/api/request';

const statsClient = conversationClient;

/** 统计区间 code（接口入参） */
export type StatsPeriod = '7d' | '30d' | 'today';

/** 意图分类三层命中率（P0-A） */
export interface IntentStats {
  /** 枚举名回显：TODAY / LAST_7D / LAST_30D */
  period: string;
  totalClassifications: number;
  /** 0-1，4 位小数；总数为 0 时为 0 */
  tier1HitRate: number;
  tier2HitRate: number;
  tier3TriggerRate: number;
  /** 各层平均延迟 ms，无数据为 null */
  avgLatencyMs: {
    EMBEDDING: null | number;
    LLM: null | number;
    RULE: null | number;
  };
}

/** RAG 未命中查询榜单项（后端原始 snake_case 列名） */
export interface RagMissQuery {
  miss_count: number;
  query_text: string;
}

/** RAG 检索质量（P0-B） */
export interface RagStats {
  period: string;
  totalSearches: number;
  missCount: number;
  /** 0-1，4 位小数 */
  missRate: number;
  /** top1 平均分，取整；无数据为 null */
  avgTop1Score: null | number;
  /** 未命中榜，最多 20 条 */
  topMissQueries: RagMissQuery[];
}

/** LLM 成本按模型分组行（后端原始 snake_case） */
export interface LlmModelRow {
  call_count: number;
  model_name: string;
  total_tokens: number;
}

/** LLM 成本按调用类型分组行 */
export interface LlmCallTypeRow {
  call_type: string;
  total_tokens: number;
}

/** LLM Token 成本（P0-D） */
export interface LlmCostStats {
  period: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  callCount: number;
  avgTokensPerCall: number;
  /** 注意：byModel / byCallType 忽略 modelName 过滤，始终为区间内全量 */
  byModel: LlmModelRow[];
  byCallType: LlmCallTypeRow[];
}

/** 意图分类命中率统计 */
export async function getIntentStatsApi(
  period: StatsPeriod,
  domainCode?: string,
): Promise<IntentStats> {
  return statsClient.get('/admin/stats/intent-classification', {
    params: { period, domainCode },
  });
}

/** RAG 检索质量统计 */
export async function getRagStatsApi(period: StatsPeriod): Promise<RagStats> {
  return statsClient.get('/admin/stats/rag-quality', { params: { period } });
}

/** LLM Token 成本统计 */
export async function getLlmCostStatsApi(
  period: StatsPeriod,
  modelName?: string,
): Promise<LlmCostStats> {
  return statsClient.get('/admin/stats/llm-cost', {
    params: { period, modelName },
  });
}
