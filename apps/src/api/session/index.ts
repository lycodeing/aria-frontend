// src/api/session/index.ts
import { useAccessStore } from '@vben/stores';

import { conversationClient, publicConversationClient } from '#/api/request';

/**
 * agentClient：带 Authorization token，baseURL=/conversation，
 *              经过 nginx /conversation 前缀路由到 conversation-service。
 *
 * publicClient：独立 RequestClient 实例，不注册 token 拦截器。
 *              /chat 页无需登录，与座席 token 共用会导致访客请求
 *              意外携带座席 token，存在权限叠加和 token 泄露风险。
 */
const agentClient = conversationClient;
const publicClient = publicConversationClient;

// -------------------------------------------------------
// 访客身份验证（手机号 + 短信验证码）
// -------------------------------------------------------

/** 发送短信验证码（后端路径 /api/v1/chat/auth/sms/send → conversation-service:8082） */
export async function sendSmsCodeApi(phone: string): Promise<void> {
  return publicClient.post('/chat/auth/sms/send', { phone });
}

/** 校验短信验证码，成功返回访客 token */
export async function verifySmsCodeApi(
  phone: string,
  code: string,
): Promise<{ token: string }> {
  return publicClient.post('/chat/auth/sms/verify', { phone, code });
}

export interface SessionQueueItem {
  sessionId: string;
  userName: string;
  transferReason: string;
  tag: string;
  waitSince: number; // epoch seconds
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING';
}

export interface WsChatMessage {
  type:
    | 'AGENT_JOINED'
    | 'CONNECTED'
    | 'KICKED_OUT'
    | 'MESSAGE'
    | 'PING'
    | 'TYPING';
  /**
   * 会话 ID。MESSAGE / TYPING / AGENT_JOINED 必填；
   * CONNECTED / KICKED_OUT 为连接级信令，后端不带此字段。
   */
  sessionId?: string;
  role?: 'agent' | 'user';
  content?: string;
  /**
   * session 内单调递增序号（仅 MESSAGE 类型有效），用于断线重连后的 sinceSeq 增量同步。
   * 后端 JacksonLongToStringConfig 把 Long 序列化为字符串，前端消费时务必 Number(seq) 归一化。
   */
  seq?: number | string;
  timestamp?: number;
}

/** AI 消息中触发的工具调用条目（LangChain ToolCall 结构，前端只展示） */
export interface ChatToolCall {
  id?: null | string;
  name?: null | string;
  /** 入参对象或已序列化字符串，后端返回结构不定，前端渲染前 typeof 判定即可 */
  arguments?: unknown;
}

/** 历史消息项（含 seq 字段，支持增量同步） */
export interface ChatHistoryItem {
  role: string;
  content: string;
  /** session 内单调递增序号，老数据可能为 null；后端 Long → string，前端消费需 Number() 归一化 */
  seq?: null | number | string;
  /** 消息毫秒时间戳（四元组新增字段，旧三元组数据无此字段） */
  timestamp?: null | number;
  /** 仅 role='tool' 消息含此字段：被调用的工具名，如 get_current_weather */
  toolName?: null | string;
  /** 仅 role='tool' 消息含此字段：与触发它的 AI 消息的 toolCalls[].id 对应 */
  toolRequestId?: null | string;
  /** 仅 role='ai' 消息含此字段：本轮触发的工具调用列表 */
  toolCalls?: ChatToolCall[] | null;
}

/** 获取所有状态的会话列表（座席端，需 token）。
 * 返回 AI_CHAT / WAITING / ACTIVE / CLOSED 四种状态，CLOSED 最多 50 条按结束时间倒序。
 */
export async function getAllSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/sessions');
}

/** 座席接入会话（需 token） */
export async function acceptSessionApi(
  sessionId: string,
): Promise<SessionQueueItem> {
  return agentClient.post(`/sessions/${sessionId}/accept`);
}

/** 获取结束会话（需 token） */
export async function closeSessionApi(sessionId: string): Promise<void> {
  return agentClient.post(`/sessions/${sessionId}/close`);
}

/**
 * 获取会话历史消息（座席端，需 token）。
 *
 * @param sessionId 会话唯一标识
 * @param sinceSeq  起始 seq（不含），> 0 时走增量模式，缺省=0 拉全量历史
 */
export async function getSessionHistoryApi(
  sessionId: string,
  sinceSeq = 0,
): Promise<ChatHistoryItem[]> {
  return agentClient.get('/chat/history', {
    params: { sessionId, sinceSeq },
  });
}

/**
 * 获取会话历史消息（访客端，无需 token，公开接口）。
 *
 * 同 {@link getSessionHistoryApi}，但走 publicClient，适用于 chat-widget 嵌入第三方页面。
 */
export async function getVisitorHistoryApi(
  sessionId: string,
  sinceSeq = 0,
): Promise<ChatHistoryItem[]> {
  return publicClient.get('/chat/history', {
    params: { sessionId, sinceSeq },
  });
}

/** 用户请求转人工（访客公开接口，无需 token） */
export async function transferToAgentApi(params: {
  sessionId: string;
  tag?: string;
  transferReason?: string;
  userName: string;
}): Promise<SessionQueueItem> {
  return publicClient.post('/chat/transfer', params);
}

/**
 * 查询会话当前状态（onMounted 兜底：检测 AI 工具触发转接后页面关闭的场景）。
 * 若返回 WAITING 或 ACTIVE，前端应自动恢复转接状态并重连 WebSocket。
 */
export async function getSessionStateApi(sessionId: string): Promise<{
  sessionId: string;
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING';
}> {
  return publicClient.get('/chat/state', { params: { sessionId } });
}

// -------------------------------------------------------
// 座席间转交功能
// -------------------------------------------------------

/** 在线座席信息 */
export interface OnlineAgentItem {
  /** 座席 ID */
  id: string;
  /** 座席显示名称 */
  name: string;
  /** 当前 ACTIVE 会话数 */
  sessions: number;
}

/** 获取在线座席列表（用于转交 Modal） */
export async function getOnlineAgentsApi(): Promise<OnlineAgentItem[]> {
  return agentClient.get('/sessions/agents/online');
}

/**
 * 转交会话给指定座席（需 token）。
 * 后端会广播 TRANSFER SSE 事件，目标座席前端收到后自动接入。
 */
export async function transferSessionApi(
  sessionId: string,
  targetAgentId: string,
): Promise<void> {
  return agentClient.post(`/sessions/${sessionId}/transfer`, {
    targetAgentId,
  });
}

/**
 * 座席订阅 SSE 事件流（队列变化通知）。
 *
 * 浏览器原生 EventSource 不支持自定义请求头，鉴权 token 通过 query param 传递。
 * 后端 AgentHandshakeInterceptor 同样从 ?token= 参数中取值校验。
 * 返回 EventSource 实例，调用方负责在 onUnmounted 中调用 close()。
 */
/**
 * SSE 事件 payload。
 * TRANSFER 事件含 fromAgentId / toAgentId，其他事件为 null。
 */
export interface SessionSseEvent {
  type: 'ACCEPTED' | 'CLOSED' | 'ENQUEUE' | 'TRANSFER';
  item: SessionQueueItem;
  fromAgentId?: null | string;
  toAgentId?: null | string;
}

export function subscribeSessionEvents(
  onEvent: (event: SessionSseEvent) => void,
  onError?: () => void,
  onOpen?: () => void,
): EventSource {
  // 从 Pinia store 取座席 token，附加到 URL query param 实现鉴权
  const accessStore = useAccessStore();
  const token = accessStore.accessToken ?? '';
  const url = token
    ? `/conversation/api/v1/sessions/events?token=${encodeURIComponent(token)}`
    : '/conversation/api/v1/sessions/events';
  const es = new EventSource(url);
  es.addEventListener('open', () => onOpen?.());
  es.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data);
      onEvent(data);
    } catch {
      // 忽略心跳等非 JSON 数据
    }
  });
  if (onError) es.addEventListener('error', onError);
  return es;
}

// -------------------------------------------------------
// WebSocket 双向对话（访客 ↔ 座席）
// -------------------------------------------------------

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host; // 含端口，如 localhost:5667
  return `${proto}//${host}${path}`;
}

/**
 * 访客端 WebSocket 连接。
 * 路径：/ws/chat/{sessionId}（经 Vite proxy 转发到 localhost:8082）
 * onClose 传入 CloseEvent，调用方可根据 code 区分主动关闭（1000）和异常断线。
 */
export function connectVisitorWs(
  sessionId: string,
  onMessage: (msg: WsChatMessage) => void,
  onOpen?: () => void,
  onClose?: (event: CloseEvent) => void,
): WebSocket {
  const ws = new WebSocket(buildWsUrl(`/ws/chat/${sessionId}`));
  ws.addEventListener('open', () => onOpen?.());
  ws.addEventListener('message', (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('close', (event) => onClose?.(event as CloseEvent));
  return ws;
}

/**
 * 座席端 WebSocket 连接。
 * 路径：/ws/agent/{sessionId}?token=xxx（经 Vite proxy 转发到 localhost:8082）
 *
 * @deprecated 改造为单连接多路复用后，座席端不再直接使用此函数。
 * 请通过 useAgentWsChannel.init() 建立连接，旧路径 /ws/agent/{sessionId} 已废弃。
 * 访客端 connectVisitorWs 不受影响。
 */
export function connectAgentWs(
  sessionId: string,
  onMessage: (msg: WsChatMessage) => void,
  onOpen?: () => void,
  onClose?: (event: CloseEvent) => void,
): WebSocket {
  const accessStore = useAccessStore();
  const token = accessStore.accessToken ?? '';
  const path = token
    ? `/ws/agent/${sessionId}?token=${encodeURIComponent(token)}`
    : `/ws/agent/${sessionId}`;
  const ws = new WebSocket(buildWsUrl(path));
  ws.addEventListener('open', () => onOpen?.());
  ws.addEventListener('message', (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('close', (event) => onClose?.(event as CloseEvent));
  return ws;
}

/** 通过 WebSocket 发送文本消息 */
export function sendWsMessage(ws: null | WebSocket, content: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'MESSAGE', content }));
}

/** 通过 WebSocket 发送访客输入中信号（不存入历史，仅通知座席） */
export function sendTypingSignal(ws: null | WebSocket): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'TYPING' }));
}

/** 通过 WebSocket 发送心跳 PING，防止代理/负载均衡因空闲超时断开连接 */
export function sendPingSignal(ws: null | WebSocket): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'PING' }));
}

// -------------------------------------------------------
// 历史工单 + AI 总结
// -------------------------------------------------------

/** 访客历史工单摘要 */
export interface VisitorHistorySession {
  sessionId: string;
  tag: string;
  transferReason: string;
  startedAt: string; // ISO 8601
  endedAt: string;
  msgCount: number;
  aiSummary?: null | string; // 已缓存则有值，否则 null
}

/**
 * 查询同一访客的历史已结束工单（排除当前会话）
 */
export async function getVisitorSessionHistoryApi(
  visitorName: string,
  excludeSessionId: string,
): Promise<VisitorHistorySession[]> {
  return agentClient.get('/sessions/visitor-history', {
    params: { visitorName, excludeSessionId },
  });
}

/**
 * 查询已缓存的 AI 总结。
 * summary 为 null 表示后端尚未生成，空字符串同样视为无内容。
 */
export async function getAiSummaryApi(
  sessionId: string,
): Promise<{ summary: null | string }> {
  return agentClient.get(`/sessions/${sessionId}/ai-summary`);
}

/**
 * 创建 AI 总结流式 SSE 连接（与 subscribeSessionEvents 保持相同的 token 鉴权模式）。
 * token 在函数内部从 Pinia store 读取，调用方无需感知鉴权细节。
 * 返回 EventSource 实例，调用方负责在适当时机调用 close()。
 */
export function createAiSummaryEventSource(sessionId: string): EventSource {
  const accessStore = useAccessStore();
  const token = accessStore.accessToken ?? '';
  const url = token
    ? `/conversation/api/v1/sessions/${sessionId}/ai-summary/stream?token=${encodeURIComponent(token)}`
    : `/conversation/api/v1/sessions/${sessionId}/ai-summary/stream`;
  return new EventSource(url);
}

// -------------------------------------------------------
// AI 回复建议
// -------------------------------------------------------

/** AI 回复建议条目 */
export interface ReplySuggestion {
  /** 前端 v-for key */
  id: string;
  /** 建议回复内容 */
  content: string;
  /** 置信度 0-1 */
  confidence: number;
  /** KB=知识库命中, CONTEXT=上下文推理 */
  source: 'CONTEXT' | 'KB';
}

/**
 * 根据当前会话上下文 + 知识库生成回复建议（KB + 上下文双路并行）
 * @param signal 可选的 AbortSignal，用于取消进行中的请求（切换会话时防止过期响应覆盖）
 */
export async function getReplySuggestionsApi(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ReplySuggestion[]> {
  return agentClient.post(
    `/sessions/${sessionId}/reply-suggestions`,
    undefined,
    { signal },
  );
}
