import type { WsChatMessage } from '#/api/session';

import { onScopeDispose, reactive, watch } from 'vue';

import { useAgentWsChannel } from './useAgentWsChannel';

export type WsStatus = 'closed' | 'connecting' | 'error' | 'open';

export interface AgentWebSocketOptions {
  onUserMessage: (sessionId: string, msg: WsChatMessage) => void;
  onTyping?: (sessionId: string) => void;
  onReconnect?: (sessionId: string) => void;
  onStatusChange?: (sessionId: string, status: WsStatus) => void;
}

/**
 * useAgentWebSocket — 座席端会话订阅层
 *
 * 职责：
 *   - 将业务回调（onUserMessage / onTyping / onReconnect）注册到 useAgentWsChannel
 *   - 对外暴露与改造前完全一致的接口，调用方（agent/index.vue）零感知
 *
 * 不包含：
 *   - WebSocket 连接管理（由 useAgentWsChannel 负责）
 *   - 心跳 / 重连逻辑（由 useAgentWsChannel 负责）
 *   - channel 生命周期（由 layouts/basic.vue watch accessToken 驱动）
 */
export function useAgentWebSocket(options: AgentWebSocketOptions) {
  const channel = useAgentWsChannel();
  const subscribedSessions = new Set<string>();
  const statusMap = reactive<Record<string, WsStatus>>({});

  // channel 整体状态变化时同步到所有已订阅会话
  // （单连接模式下所有会话共享同一连接状态）
  watch(channel.status, (s) => {
    let mapped: WsStatus;
    if (s === 'open') {
      mapped = 'open';
    } else if (s === 'connecting') {
      mapped = 'connecting';
    } else if (s === 'error') {
      mapped = 'error';
    } else {
      mapped = 'closed';
    }
    for (const sid of subscribedSessions) {
      statusMap[sid] = mapped;
      options.onStatusChange?.(sid, mapped);
    }
  });

  /**
   * 订阅某个会话的消息，幂等（同一 sessionId 重复调用安全）。
   * 初始状态跟随 channel 当前状态。
   */
  function connectSession(sessionId: string): void {
    if (subscribedSessions.has(sessionId)) return;
    subscribedSessions.add(sessionId);
    statusMap[sessionId] =
      channel.status.value === 'open' ? 'open' : 'connecting';

    channel.subscribe(sessionId, {
      onMessage(msg) {
        // 只处理用户消息（AGENT_JOINED / CONNECTED 等由访客端处理）
        if (msg.type === 'MESSAGE' && msg.role === 'user') {
          options.onUserMessage(sessionId, msg);
        }
      },
      onTyping() {
        options.onTyping?.(sessionId);
      },
      onReconnect() {
        statusMap[sessionId] = 'open';
        options.onReconnect?.(sessionId);
      },
    });
  }

  /** 注销某个会话的订阅（座席结束会话时调用）。 */
  function disconnectSession(sessionId: string): void {
    subscribedSessions.delete(sessionId);
    channel.unsubscribe(sessionId);
    statusMap[sessionId] = 'closed';
    options.onStatusChange?.(sessionId, 'closed');
  }

  function sendMessage(sessionId: string, content: string): boolean {
    return channel.send(sessionId, content);
  }

  function getStatus(sessionId: string): WsStatus {
    return statusMap[sessionId] ?? 'closed';
  }

  /** 注销所有订阅（页面卸载时调用）。注意：不调用 channel.dispose()，channel 生命周期由登录态管理。 */
  function disconnectAll(): void {
    for (const sid of subscribedSessions) {
      channel.unsubscribe(sid);
      statusMap[sid] = 'closed';
    }
    subscribedSessions.clear();
  }

  // 组件（或 composable scope）卸载时自动清理订阅，防止回调泄漏
  onScopeDispose(() => disconnectAll());

  return {
    connectSession,
    disconnectSession,
    sendMessage,
    disconnectAll,
    statusMap,
    getStatus,
  };
}
