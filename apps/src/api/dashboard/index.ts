/**
 * Dashboard 统计 API。
 *
 * 所有接口走 vite proxy 的 /api/v1/dashboard/** 路径，
 * 由 conversation-service (8082) 提供服务，需 Sa-Token 登录。
 */
import { rawRequestClient } from '#/api/request';

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
}

/** 会话趋势数据项 */
export interface ConversationTrendItem {
  /** 月份标签，如 "2026-07" */
  month: string;
  /** 人工会话数 */
  humanCount: number;
  /** AI 会话数 */
  aiCount: number;
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

/** 获取概览指标 */
export function getDashboardOverviewApi(): Promise<DashboardOverviewData> {
  return rawRequestClient.get('/api/v1/dashboard/overview');
}

/** 获取会话趋势（按月，区分人工/AI） */
export function getConversationTrendsApi(): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/conversation-trends');
}

/** 获取消息量趋势（按月） */
export function getMessageTrendsApi(): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/message-trends');
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

/** 获取座席工作量统计 */
export function getAgentWorkloadApi(): Promise<AgentWorkloadItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/agent-workload');
}
