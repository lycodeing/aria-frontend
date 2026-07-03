// src/api/session/index.ts
import { useAccessStore } from '@vben/stores';

import {
  publicRequestClient,
  rawRequestClient,
  requestClient,
} from '#/api/request';

/**
 * agentClient：带 Authorization token（rawRequestClient 已注入 token 拦截器），baseURL 为空，
 *              用于走 vite proxy 的 /api/v1/* 路径（避免 /api 前缀拼接成 /api/api/v1/*）。
 *
 * publicClient：I-03 修复 — 独立 RequestClient 实例，不注册 token 拦截器。
 *              /chat 页无需登录，与座席 token 共用 rawRequestClient 会导致访客请求
 *              意外携带座席 token，存在权限叠加和 token 泄露风险。
 */
const agentClient = rawRequestClient;
const publicClient = publicRequestClient;
// requestClient 保留导入以兼容其他直接调用 /api/v1/* 的接口
void requestClient;

// -------------------------------------------------------
// 访客身份验证（手机号 + 短信验证码）
// -------------------------------------------------------

/** 发送短信验证码（后端路径 /api/v1/chat/auth/sms/send → conversation-service:8082） */
export async function sendSmsCodeApi(phone: string): Promise<void> {
  return publicClient.post('/api/v1/chat/auth/sms/send', { phone });
}

/** 校验短信验证码，成功返回访客 token */
export async function verifySmsCodeApi(
  phone: string,
  code: string,
): Promise<{ token: string }> {
  return publicClient.post('/api/v1/chat/auth/sms/verify', { phone, code });
}

export interface SessionQueueItem {
  sessionId: string;
  userName: string;
  transferReason: string;
  tag: string;
  waitSince: number; // epoch seconds
  status: 'ACTIVE' | 'CLOSED' | 'WAITING';
}

export interface WsChatMessage {
  type: 'AGENT_JOINED' | 'CONNECTED' | 'MESSAGE';
  sessionId: string;
  role?: 'agent' | 'user';
  content?: string;
  /**
   * session 内单调递增序号（仅 MESSAGE 类型有效），用于断线重连后的 sinceSeq 增量同步。
   * 后端 JacksonLongToStringConfig 把 Long 序列化为字符串，前端消费时务必 Number(seq) 归一化。
   */
  seq?: number | string;
  timestamp?: number;
}

/** 历史消息项（含 seq 字段，支持增量同步） */
export interface ChatHistoryItem {
  role: string;
  content: string;
  /** session 内单调递增序号，老数据可能为 null；后端 Long → string，前端消费需 Number() 归一化 */
  seq?: null | number | string;
  /** 消息毫秒时间戳（四元组新增字段，旧三元组数据无此字段） */
  timestamp?: null | number;
}

/** 获取等待队列（座席端，需 token） */
export async function getSessionQueueApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/api/v1/sessions/queue');
}

/** 获取进行中的会话（座席端，刷新恢复用，需 token） */
export async function getActiveSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/api/v1/sessions/active');
}

/** 座席接入会话（需 token） */
export async function acceptSessionApi(
  sessionId: string,
): Promise<SessionQueueItem> {
  return agentClient.post(`/api/v1/sessions/${sessionId}/accept`);
}

/** 获取结束会话（需 token） */
export async function closeSessionApi(sessionId: string): Promise<void> {
  return agentClient.post(`/api/v1/sessions/${sessionId}/close`);
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
  return agentClient.get('/api/v1/chat/history', {
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
  return publicClient.get('/api/v1/chat/history', {
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
  return publicClient.post('/api/v1/chat/transfer', params);
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
  return agentClient.get('/api/v1/sessions/agents/online');
}

/**
 * 转交会话给指定座席（需 token）。
 * 后端会广播 TRANSFER SSE 事件，目标座席前端收到后自动接入。
 */
export async function transferSessionApi(
  sessionId: string,
  targetAgentId: string,
): Promise<void> {
  return agentClient.post(`/api/v1/sessions/${sessionId}/transfer`, {
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
    ? `/api/v1/sessions/events?token=${encodeURIComponent(token)}`
    : '/api/v1/sessions/events';
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
 * 后端 AgentHandshakeInterceptor 在握手阶段从 ?token= 参数校验座席身份。
 * WebSocket 握手不支持自定义 Header，因此统一使用 query param 携带 token。
 *
 * I-05 修复：onClose 传入 CloseEvent，调用方可根据 code 区分主动关闭（1000）和异常断线，
 * 与 connectVisitorWs 保持一致的接口签名。
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
  ws.send(JSON.stringify({ content }));
}
