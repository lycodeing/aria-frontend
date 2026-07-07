import type { WsChatMessage } from '#/api/session';

import { onUnmounted, reactive } from 'vue';

import { connectAgentWs, sendWsMessage } from '#/api/session';

/**
 * useAgentWebSocket — 座席 WebSocket 连接管理 Composable。
 *
 * 职责：
 * - 维护 agentWsMap（sessionId → WebSocket）
 * - 暴露 connectSession / disconnectSession / sendMessage
 * - WS 连接建立或重连成功时触发 onReconnect 钩子（用于拉增量历史）
 * - 跟踪每个会话的 WS 连接状态（connecting / open / closed），供 UI 状态点与断线横幅使用
 * - 组件卸载时自动关闭所有连接
 *
 * 使用方：
 * <pre>
 *   const { connectSession, disconnectSession, sendMessage, getStatus } = useAgentWebSocket({
 *     onUserMessage: (sid, msg) => { ... },     // 收到访客消息时
 *     onReconnect:    (sid) => { ... },         // WS 连接打开时（含重连）
 *   });
 * </pre>
 */
export type WsStatus = 'closed' | 'connecting' | 'error' | 'open';

export interface AgentWebSocketOptions {
  /** 访客消息回调，传完整 WsChatMessage（含 seq 字段） */
  onUserMessage: (sessionId: string, msg: WsChatMessage) => void;
  /** WS 连接成功（含重连）钩子，调用方可凭 lastSeq 拉增量补齐空窗消息 */
  onReconnect?: (sessionId: string) => void;
  /** WS 连接状态变化钩子（open / closed / connecting），供 UI 展示状态点与断线提示 */
  onStatusChange?: (sessionId: string, status: WsStatus) => void;
}

export function useAgentWebSocket(options: AgentWebSocketOptions) {
  const agentWsMap = new Map<string, WebSocket>();
  // 每个会话的 WS 连接状态，供 UI 展示状态点与断线横幅（reactive 保证模板响应）
  const statusMap = reactive<Record<string, WsStatus>>({});

  function setStatus(sessionId: string, status: WsStatus) {
    statusMap[sessionId] = status;
    options.onStatusChange?.(sessionId, status);
  }

  function connectSession(sessionId: string) {
    if (agentWsMap.has(sessionId)) return;
    setStatus(sessionId, 'connecting');

    const ws = connectAgentWs(
      sessionId,
      (msg: WsChatMessage) => {
        if (msg.type === 'MESSAGE' && msg.role === 'user') {
          options.onUserMessage(sessionId, msg);
        }
      },
      () => {
        // WS onopen：首次连接 + 重连均触发，调用方据此拉 sinceSeq 增量
        setStatus(sessionId, 'open');
        options.onReconnect?.(sessionId);
      },
      () => {
        // WS onclose：异常断开或主动关闭，UI 据此提示可重连
        setStatus(sessionId, 'closed');
      },
    );
    agentWsMap.set(sessionId, ws);
  }

  function disconnectSession(sessionId: string) {
    agentWsMap.get(sessionId)?.close();
    agentWsMap.delete(sessionId);
    // 保留键但置为 closed，避免动态 delete 触发 lint；getStatus 对缺失键同样返回 closed
    statusMap[sessionId] = 'closed';
  }

  function sendMessage(sessionId: string, content: string): boolean {
    const ws = agentWsMap.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    sendWsMessage(ws, content);
    return true;
  }

  /** 读取某会话当前 WS 状态（未连接过视为 closed） */
  function getStatus(sessionId: string): WsStatus {
    return statusMap[sessionId] ?? 'closed';
  }

  function disconnectAll() {
    agentWsMap.forEach((ws) => ws.close());
    agentWsMap.clear();
  }

  onUnmounted(disconnectAll);

  return {
    connectSession,
    disconnectSession,
    sendMessage,
    disconnectAll,
    statusMap,
    getStatus,
  };
}
