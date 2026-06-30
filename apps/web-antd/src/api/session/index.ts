// src/api/session/index.ts
import { rawRequestClient, requestClient } from '#/api/request';

/**
 * agentClient：带 Authorization token，用于座席端受保护接口
 * publicClient：无 token，用于访客公开接口（/chat 页面无需登录）
 */
const agentClient = requestClient;
const publicClient = rawRequestClient;

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
  timestamp?: number;
}

/** 获取等待队列（座席端，需 token） */
export async function getSessionQueueApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/chat-api/sessions/queue');
}

/** 获取进行中的会话（座席端，刷新恢复用，需 token） */
export async function getActiveSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/chat-api/sessions/active');
}

/** 座席接入会话（需 token） */
export async function acceptSessionApi(
  sessionId: string,
): Promise<SessionQueueItem> {
  return agentClient.post(`/chat-api/sessions/${sessionId}/accept`);
}

/** 结束会话（需 token） */
export async function closeSessionApi(sessionId: string): Promise<void> {
  return agentClient.post(`/chat-api/sessions/${sessionId}/close`);
}

/** 用户请求转人工（访客公开接口，无需 token） */
export async function transferToAgentApi(params: {
  sessionId: string;
  tag?: string;
  transferReason?: string;
  userName: string;
}): Promise<SessionQueueItem> {
  return publicClient.post('/chat-api/chat/transfer', params);
}

/**
 * 座席订阅 SSE 事件流（队列变化通知）。
 * 返回 EventSource 实例，调用方负责在 onUnmounted 中调用 close()。
 */
export function subscribeSessionEvents(
  onEvent: (event: { item: SessionQueueItem; type: string }) => void,
  onError?: () => void,
  onOpen?: () => void,
): EventSource {
  const es = new EventSource('/chat-api/sessions/events');
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
 * 路径：/ws/agent/{sessionId}（经 Vite proxy 转发到 localhost:8082）
 */
export function connectAgentWs(
  sessionId: string,
  onMessage: (msg: WsChatMessage) => void,
  onOpen?: () => void,
  onClose?: () => void,
): WebSocket {
  const ws = new WebSocket(buildWsUrl(`/ws/agent/${sessionId}`));
  ws.addEventListener('open', () => onOpen?.());
  ws.addEventListener('message', (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('close', () => onClose?.());
  return ws;
}

/** 通过 WebSocket 发送文本消息 */
export function sendWsMessage(ws: null | WebSocket, content: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ content }));
}
