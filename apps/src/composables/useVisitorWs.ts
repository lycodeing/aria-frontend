import type { WsChatMessage } from '#/api/session';

/**
 * useVisitorWs — 访客端 WebSocket 连接管理
 *
 * 职责：
 *   - 建立访客 WS 连接并路由收到的消息（agent 消息、座席接入通知）
 *   - 断线检测与指数退避自动重连（最多 3 次）
 *   - 重连成功后按 lastSeq 拉增量消息，补齐离线期间漏收的座席回复
 *   - 发送文字消息到 WS（转人工模式下）
 *
 * 不包含：SSE、转接入队、身份验证任何逻辑。
 */
import { ref } from 'vue';

import {
  connectVisitorWs,
  getVisitorHistoryApi,
  sendWsMessage,
} from '#/api/session';

// ---- 重连策略常量 ----
const WS_MAX_RETRY = 3;
/** 指数退避延迟（ms）：第 1/2/3 次重连 */
const WS_RETRY_DELAYS = [1000, 3000, 8000] as const;

export interface VisitorWsCallbacks {
  /** 座席发来的文字消息 */
  onAgentMessage: (content: string) => void;
  /** 座席接入成功 */
  onAgentJoined: () => void;
  /** 会话被正常关闭（code=1000） */
  onSessionClosed: () => void;
  /** 重连耗尽，清除转接状态 */
  onMaxRetryExceeded: () => void;
  /** 断线重连中，通知 UI */
  onReconnecting: (attempt: number, delaySeconds: number) => void;
}

export function useVisitorWs(
  sessionId: { value: string },
  readLastSeq: () => number,
  writeLastSeq: (seq: number) => void,
  callbacks: VisitorWsCallbacks,
) {
  const wsStatus = ref<'connected' | 'connecting' | 'disconnected'>(
    'disconnected',
  );

  let visitorWs: null | WebSocket = null;
  let wsRetryCount = 0;
  let wsRetryTimer: null | ReturnType<typeof setTimeout> = null;
  /** 并发锁：防止短时间多次重连触发多个增量拉取请求 */
  let fetchInflight = false;

  // ---- 连接 ----

  function connect(sid: string): void {
    wsStatus.value = 'connecting';
    visitorWs = connectVisitorWs(
      sid,
      handleWsMessage,
      handleWsOpen,
      handleWsClose,
    );
  }

  function disconnect(): void {
    if (wsRetryTimer) {
      clearTimeout(wsRetryTimer);
      wsRetryTimer = null;
    }
    visitorWs?.close();
    visitorWs = null;
  }

  // ---- 消息处理 ----

  function handleWsMessage(msg: WsChatMessage): void {
    // 更新 lastSeq：后端 Long 序列化为字符串，需 Number() 归一化
    if (msg.type === 'MESSAGE' && msg.seq !== null && msg.seq !== undefined) {
      const seq = Number(msg.seq);
      if (Number.isFinite(seq)) writeLastSeq(seq);
    }

    if (msg.type === 'MESSAGE' && msg.role === 'agent') {
      callbacks.onAgentMessage(msg.content ?? '');
    } else if (msg.type === 'AGENT_JOINED') {
      callbacks.onAgentJoined();
    }
  }

  // ---- 连接回调 ----

  function handleWsOpen(): void {
    wsStatus.value = 'connected';
    wsRetryCount = 0;
    if (wsRetryTimer) {
      clearTimeout(wsRetryTimer);
      wsRetryTimer = null;
    }
    // 重连成功后拉增量消息，补齐离线期间漏收的座席回复
    void fetchMissingMessages(sessionId.value);
  }

  function handleWsClose(event: CloseEvent): void {
    visitorWs = null;
    wsStatus.value = 'disconnected';

    if (event.code === 1000) {
      // 服务端正常关闭（座席结束会话），不重连
      callbacks.onSessionClosed();
      return;
    }

    // 非正常断线，尝试重连
    if (wsRetryCount < WS_MAX_RETRY) {
      const delay = WS_RETRY_DELAYS[wsRetryCount] ?? 8000;
      wsRetryCount++;
      callbacks.onReconnecting(wsRetryCount, delay / 1000);
      wsRetryTimer = setTimeout(() => connect(sessionId.value), delay);
    } else {
      // 重试耗尽，通知外部清除转接状态
      wsRetryCount = 0;
      callbacks.onMaxRetryExceeded();
    }
  }

  // ---- 增量消息补齐 ----

  /**
   * 重连成功后按 lastSeq 拉取离线期间漏收的座席消息。
   *
   * 实现要点：
   *   - 入口快照 sinceSeq，防止拉取过程中 WS 推送更新 lastSeq 导致重复跳过
   *   - fetchInflight 并发锁：同一时间只允许一个增量请求
   *   - 只渲染 agent 角色（AI 回复已由 SSE 本地 echo，避免重复）
   */
  async function fetchMissingMessages(sid: string): Promise<void> {
    if (fetchInflight) return;
    const sinceSeq = readLastSeq();
    if (sinceSeq <= 0) return;

    fetchInflight = true;
    try {
      const items = await getVisitorHistoryApi(sid, sinceSeq);
      for (const item of items) {
        const seq =
          item.seq === null || item.seq === undefined
            ? Number.NaN
            : Number(item.seq);
        if (!Number.isFinite(seq) || seq <= sinceSeq) continue;
        if (!item.content || item.role !== 'agent') continue;
        callbacks.onAgentMessage(item.content);
        writeLastSeq(seq);
      }
    } catch (error) {
      console.warn('[WS] fetchMissingMessages failed', sid, error);
    } finally {
      fetchInflight = false;
    }
  }

  // ---- 发送 ----

  /**
   * 发送文字消息到 WS（转人工模式下使用）。
   * @returns 是否成功入队（WS 已连接）
   */
  function sendText(text: string): boolean {
    if (!visitorWs || visitorWs.readyState !== WebSocket.OPEN) return false;
    try {
      sendWsMessage(visitorWs, text);
      return true;
    } catch {
      return false;
    }
  }

  return { wsStatus, connect, disconnect, sendText };
}
