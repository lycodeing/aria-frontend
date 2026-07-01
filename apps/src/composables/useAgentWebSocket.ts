import type { WsChatMessage } from '#/api/session';

import { onUnmounted } from 'vue';

import { connectAgentWs, sendWsMessage } from '#/api/session';

/**
 * useAgentWebSocket — 座席 WebSocket 连接管理 Composable。
 *
 * 职责：
 * - 维护 agentWsMap（sessionId → WebSocket）
 * - 暴露 connectSession / disconnectSession / sendMessage
 * - WS 连接建立或重连成功时触发 onReconnect 钩子（用于拉增量历史）
 * - 组件卸载时自动关闭所有连接
 *
 * 使用方：
 * <pre>
 *   const { connectSession, disconnectSession, sendMessage } = useAgentWebSocket({
 *     onUserMessage: (sid, msg) => { ... },     // 收到访客消息时
 *     onReconnect:    (sid) => { ... },         // WS 连接打开时（含重连）
 *   });
 * </pre>
 */
export interface AgentWebSocketOptions {
  /** 访客消息回调，传完整 WsChatMessage（含 seq 字段） */
  onUserMessage: (sessionId: string, msg: WsChatMessage) => void;
  /** WS 连接成功（含重连）钩子，调用方可凭 lastSeq 拉增量补齐空窗消息 */
  onReconnect?: (sessionId: string) => void;
}

export function useAgentWebSocket(options: AgentWebSocketOptions) {
  const agentWsMap = new Map<string, WebSocket>();

  function connectSession(sessionId: string) {
    if (agentWsMap.has(sessionId)) return;

    const ws = connectAgentWs(
      sessionId,
      (msg: WsChatMessage) => {
        if (msg.type === 'MESSAGE' && msg.role === 'user') {
          options.onUserMessage(sessionId, msg);
        }
      },
      () => {
        // WS onopen：首次连接 + 重连均触发，调用方据此拉 sinceSeq 增量
        options.onReconnect?.(sessionId);
      },
    );
    agentWsMap.set(sessionId, ws);
  }

  function disconnectSession(sessionId: string) {
    agentWsMap.get(sessionId)?.close();
    agentWsMap.delete(sessionId);
  }

  function sendMessage(sessionId: string, content: string): boolean {
    const ws = agentWsMap.get(sessionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    sendWsMessage(ws, content);
    return true;
  }

  function disconnectAll() {
    agentWsMap.forEach((ws) => ws.close());
    agentWsMap.clear();
  }

  onUnmounted(disconnectAll);

  return { connectSession, disconnectSession, sendMessage, disconnectAll };
}
