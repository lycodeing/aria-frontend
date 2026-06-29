import type { WsChatMessage } from '#/api/session';

import { onUnmounted } from 'vue';

import { connectAgentWs, sendWsMessage } from '#/api/session';

/**
 * useAgentWebSocket — 座席 WebSocket 连接管理 Composable。
 *
 * 职责：
 * - 维护 agentWsMap（sessionId → WebSocket）
 * - 暴露 connectSession / disconnectSession / sendMessage
 * - 组件卸载时自动关闭所有连接
 *
 * 使用方：
 *   const { connectSession, disconnectSession, sendMessage } = useAgentWebSocket(onUserMessage)
 */
export function useAgentWebSocket(
  onUserMessage: (sessionId: string, content: string) => void,
) {
  const agentWsMap = new Map<string, WebSocket>();

  function connectSession(sessionId: string) {
    if (agentWsMap.has(sessionId)) return;

    const ws = connectAgentWs(sessionId, (msg: WsChatMessage) => {
      if (msg.type === 'MESSAGE' && msg.role === 'user') {
        onUserMessage(sessionId, msg.content ?? '');
      }
    });
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
