/**
 * Dashboard 统计 API。
 *
 * 所有接口走 vite proxy 的 /api/v1/dashboard/** 路径，
 * 由 conversation-service (8082) 提供服务，需 Sa-Token 登录。
 */
import { rawRequestClient } from '#/api/request';

// ─── 时间范围 ────────────────────────────────────────────────────────────────

/** 前端时间范围枚举 */
export type TimeRange = 'days7' | 'days30' | 'month' | 'week';

/** 后端时间范围请求参数 */
export interface TimeRangeParams {
  rangeType: 'custom' | 'month' | 'week';
  days?: number;
}

/** 将前端 TimeRange 枚举转换为后端 API 参数 */
export function toTimeRangeParams(range: TimeRange): TimeRangeParams {
  switch (range) {
    case 'days7': {
      return { rangeType: 'custom', days: 7 };
    }
    case 'days30': {
      return { rangeType: 'custom', days: 30 };
    }
    case 'month': {
      return { rangeType: 'month' };
    }
    case 'week': {
      return { rangeType: 'week' };
    }
  }
}

// ─── 数据类型 ────────────────────────────────────────────────────────────────

/** 概览指标 */
export interface DashboardOverviewData {
  /** 今日会话量 */
  todayConversationCount: number;
  /** 总会话量 */
  totalConversationCount: number;
  /** 当前进行中会话数（ACTIVE） */
  activeConversationCount: number;
  /** 当前等待接入会话数（WAITING） */
  waitingConversationCount: number;
  /** 总用户数 */
  totalUserCount: number;
  /** 总消息数 */
  totalMessageCount: number;
  /** AI 回复消息数 */
  aiMessageCount: number;
  /** 人工座席回复消息数 */
  agentMessageCount: number;
  /** 平均等待时长（秒），accepted_at - started_at */
  avgWaitSeconds: number;
  /** 平均处理时长（秒），ended_at - accepted_at */
  avgHandleSeconds: number;
  /** 平均首次回复时长（秒），first_reply_at - accepted_at */
  avgFirstReplySeconds: number;
}

/** 会话趋势数据项（month 字段值为 YYYY-MM-DD 日期标签） */
export interface ConversationTrendItem {
  /** 时间标签，如 "2026-07-01" */
  month: string;
  /** 人工会话数 */
  humanCount: number;
  /** AI 会话数 */
  aiCount: number;
}

/** 效率趋势数据项（按天聚合） */
export interface EfficiencyTrendItem {
  /** 日期标签，YYYY-MM-DD */
  date: string;
  /** 平均等待时长（秒） */
  avgWaitSeconds: number;
  /** 平均处理时长（秒） */
  avgHandleSeconds: number;
  /** 平均首次回复时长（秒） */
  avgFirstReplySeconds: number;
}

/** 状态分布数据项 */
export interface StatusDistributionItem {
  status: string;
  count: number;
}

/** 标签分布数据项 */
export interface TagDistributionItem {
  tag: string;
  count: number;
}

// ─── 复杂度分布 ──────────────────────────────────────────────────────────────

/** 复杂度等级（对应后端 cs_conversation.complexity 字段取值） */
export type ComplexityLevel = 'COMPLEX' | 'MEDIUM' | 'SIMPLE';

/** 复杂度分布数据项（后端按等级聚合后的占比） */
export interface ComplexityDistributionItem {
  /** 等级：SIMPLE / MEDIUM / COMPLEX */
  level: ComplexityLevel;
  /** 该等级占比（0-100，后端已计算，保留一位小数） */
  percent: number;
}

/**
 * 复杂度卡片展示项（前端映射后的形态，含中文标签与语义色）。
 * 与 complexity-trend-card.vue 共享，避免在卡片内重复定义。
 */
export interface ComplexityItem {
  label: string;
  percent: number;
  /** 进度条背景色（Tailwind 类，与设计稿语义色一致） */
  color: string;
}

/** 最近会话项 */
export interface RecentSessionItem {
  sessionId: string;
  visitorName: string;
  tag: null | string;
  transferReason: null | string;
  status: string;
  agentId: null | string;
  startedAt: string;
  endedAt: null | string;
  messageCount: number;
}

/** 座席工作量项 */
export interface AgentWorkloadItem {
  agentId: string;
  totalSessions: number;
  activeSessions: number;
}

// ─── API 函数 ─────────────────────────────────────────────────────────────────

/** 获取概览指标 */
export function getDashboardOverviewApi(): Promise<DashboardOverviewData> {
  return rawRequestClient.get('/api/v1/dashboard/overview');
}

/** 获取会话趋势（按天，支持时间范围） */
export function getConversationTrendsApi(
  range: TimeRange = 'month',
): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/conversation-trends', {
    params: toTimeRangeParams(range),
  });
}

/** 获取消息量趋势（按天，支持时间范围） */
export function getMessageTrendsApi(
  range: TimeRange = 'month',
): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/message-trends', {
    params: toTimeRangeParams(range),
  });
}

/** 获取效率趋势（按天，支持时间范围） */
export function getEfficiencyTrendsApi(
  range: TimeRange = 'month',
): Promise<EfficiencyTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/efficiency-trends', {
    params: toTimeRangeParams(range),
  });
}

/** 获取会话状态分布 */
export function getStatusDistributionApi(): Promise<StatusDistributionItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/status-distribution');
}

/** 获取问题标签分布 */
export function getTagDistributionApi(): Promise<TagDistributionItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/tag-distribution');
}

/** 获取最近会话列表 */
export function getRecentSessionsApi(limit = 10): Promise<RecentSessionItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/recent-sessions', {
    params: { limit },
  });
}

/**
 * 获取会话复杂度分布（简单/中等/复杂 三项占比）。
 * 快照数据，不受时间范围筛选影响。
 */
export function getComplexityDistributionApi(): Promise<
  ComplexityDistributionItem[]
> {
  return rawRequestClient.get('/api/v1/dashboard/complexity-distribution');
}

/** 获取座席工作量统计 */
export function getAgentWorkloadApi(): Promise<AgentWorkloadItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/agent-workload');
}
