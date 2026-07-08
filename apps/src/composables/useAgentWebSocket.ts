import type { WsChatMessage } from '#/api/session';

import { onUnmounted, reactive } from 'vue';

import { connectAgentWs, sendWsMessage } from '#/api/session';

export type WsStatus = 'closed' | 'connecting' | 'error' | 'open';

export interface AgentWebSocketOptions {
  onUserMessage: (sessionId: string, msg: WsChatMessage) => void;
  onTyping?: (sessionId: string) => void;
  onReconnect?: (sessionId: string) => void;
  onStatusChange?: (sessionId: string, status: WsStatus) => void;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRIES = 10;
const HEARTBEAT_MS = 12_000; // 每 12s 检查一次连接健康

export function useAgentWebSocket(options: AgentWebSocketOptions) {
  const agentWsMap = new Map<string, WebSocket>();
  const statusMap = reactive<Record<string, WsStatus>>({});
  const retryMap = new Map<
    string,
    { count: number; timer: null | ReturnType<typeof setTimeout> }
  >();
  const heartbeatMap = new Map<string, ReturnType<typeof setInterval>>();
  const intentionalClose = new Set<string>();

  function setStatus(sessionId: string, status: WsStatus) {
    statusMap[sessionId] = status;
    options.onStatusChange?.(sessionId, status);
  }

  // ===== 心跳：定期检查 readyState，配合 offline 事件主动感知断线 =====
  function startHeartbeat(sessionId: string) {
    stopHeartbeat(sessionId);
    const timer = setInterval(() => {
      const ws = agentWsMap.get(sessionId);
      if (!ws) {
        stopHeartbeat(sessionId);
        return;
      }

      const dead =
        ws.readyState === WebSocket.CLOSED ||
        ws.readyState === WebSocket.CLOSING ||
        !navigator.onLine;

      if (dead && statusMap[sessionId] === 'open') {
        console.warn(`[WS:Agent] 心跳检测到连接断开（sessionId=${sessionId}）`);
        ws.close(); // 触发 onclose → scheduleReconnect
      }
    }, HEARTBEAT_MS);
    heartbeatMap.set(sessionId, timer);
  }

  function stopHeartbeat(sessionId: string) {
    const t = heartbeatMap.get(sessionId);
    if (t) {
      clearInterval(t);
      heartbeatMap.delete(sessionId);
    }
  }

  // ===== 指数退避重连 =====
  function scheduleReconnect(sessionId: string) {
    if (intentionalClose.has(sessionId)) return;
    if (!retryMap.has(sessionId))
      retryMap.set(sessionId, { count: 0, timer: null });
    const retry = retryMap.get(sessionId);
    if (!retry) return;

    if (retry.count >= MAX_RETRIES) {
      console.warn(
        `[WS:Agent] 会话 ${sessionId} 达到最大重试次数，停止自动重连`,
      );
      return;
    }

    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retry.count);
    retry.count++;
    console.warn(
      `[WS:Agent] 会话 ${sessionId} 将在 ${delay}ms 后重连（第 ${retry.count} 次）`,
    );

    retry.timer = setTimeout(() => {
      if (!intentionalClose.has(sessionId)) connectSession(sessionId);
    }, delay);
  }

  // ===== 核心：建立连接 =====
  function connectSession(sessionId: string) {
    const existing = agentWsMap.get(sessionId);
    if (existing) {
      if (
        existing.readyState === WebSocket.CONNECTING ||
        existing.readyState === WebSocket.OPEN
      )
        return;
      existing.close();
      agentWsMap.delete(sessionId);
    }

    setStatus(sessionId, 'connecting');

    const ws = connectAgentWs(
      sessionId,
      (msg: WsChatMessage) => {
        if (msg.type === 'MESSAGE' && msg.role === 'user') {
          options.onUserMessage(sessionId, msg);
        } else if (msg.type === 'TYPING') {
          options.onTyping?.(sessionId);
        }
      },
      () => {
        setStatus(sessionId, 'open');
        const retry = retryMap.get(sessionId);
        if (retry) retry.count = 0;
        startHeartbeat(sessionId);
        options.onReconnect?.(sessionId);
      },
      () => {
        agentWsMap.delete(sessionId);
        stopHeartbeat(sessionId);
        setStatus(sessionId, 'closed');
        scheduleReconnect(sessionId);
      },
    );

    agentWsMap.set(sessionId, ws);
  }

  // ===== 主动断开（不触发自动重连） =====
  function disconnectSession(sessionId: string) {
    intentionalClose.add(sessionId);
    const retry = retryMap.get(sessionId);
    if (retry?.timer) clearTimeout(retry.timer);
    retryMap.delete(sessionId);
    stopHeartbeat(sessionId);
    agentWsMap.get(sessionId)?.close();
    agentWsMap.delete(sessionId);
    statusMap[sessionId] = 'closed';
  }

  function sendMessage(sessionId: string, content: string): boolean {
    const ws = agentWsMap.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    sendWsMessage(ws, content);
    return true;
  }

  function getStatus(sessionId: string): WsStatus {
    return statusMap[sessionId] ?? 'closed';
  }

  function disconnectAll() {
    retryMap.forEach((r) => {
      if (r.timer) clearTimeout(r.timer);
    });
    retryMap.clear();
    heartbeatMap.forEach((t) => clearInterval(t));
    heartbeatMap.clear();
    agentWsMap.forEach((ws) => ws.close());
    agentWsMap.clear();
    intentionalClose.clear();
  }

  // ===== 监听浏览器 offline 事件，断网时立即感知 =====
  function onBrowserOffline() {
    agentWsMap.forEach((ws, sessionId) => {
      if (statusMap[sessionId] === 'open') {
        console.warn(`[WS:Agent] 浏览器 offline 事件，主动关闭 ${sessionId}`);
        ws.close(); // 触发 onclose → scheduleReconnect
      }
    });
  }

  window.addEventListener('offline', onBrowserOffline);

  onUnmounted(() => {
    window.removeEventListener('offline', onBrowserOffline);
    disconnectAll();
  });

  return {
    connectSession,
    disconnectSession,
    sendMessage,
    disconnectAll,
    statusMap,
    getStatus,
  };
}
