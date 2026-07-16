import type { CsatRequestPayload } from '#/api/csat/types';
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
  sendPingSignal,
  sendTypingSignal,
  sendWsMessage,
} from '#/api/session';

// ---- 重连策略常量 ----
const WS_MAX_RETRY = 3;
/** 指数退避延迟（ms）：第 1/2/3 次重连 */
const WS_RETRY_DELAYS = [1000, 3000, 8000] as const;

/**
 * 心跳间隔（ms）。
 * 大多数 Nginx/LB 默认 proxy_read_timeout = 60s，25s 发一次 PING 保持连接活跃。
 */
const HEARTBEAT_MS = 25_000;

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
  /** CSAT 评价邀请（人工会话关闭后由服务端 WS 推送，data 为 JSON 信封） */
  onCsatRequest?: (payload: CsatRequestPayload) => void;
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
  let heartbeatTimer: null | ReturnType<typeof setInterval> = null;
  /** 并发锁：防止短时间多次重连触发多个增量拉取请求 */
  let fetchInflight = false;

  // ---- 心跳 ----

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      sendPingSignal(visitorWs);
    }, HEARTBEAT_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

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
    stopHeartbeat();
    if (wsRetryTimer) {
      clearTimeout(wsRetryTimer);
      wsRetryTimer = null;
    }
    visitorWs?.close();
    visitorWs = null;
  }

  // ---- 消息处理 ----

  /** 安全解析 CSAT_REQUEST 信封（content 为 JSON 字符串） */
  function tryParseCsat(content?: string): CsatRequestPayload | undefined {
    if (!content) return undefined;
    try {
      return JSON.parse(content) as CsatRequestPayload;
    } catch {
      return undefined;
    }
  }

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
    } else if (msg.type === 'CSAT_REQUEST') {
      // 人工会话关闭后推送的评价邀请，JSON 信封放在 content 字段
      // 解析失败静默忽略，不阻塞 WS 主消息链路
      const payload = tryParseCsat(msg.content);
      if (payload?.csatId) callbacks.onCsatRequest?.(payload);
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
    // 连接建立后启动心跳，防止代理因空闲超时断开
    startHeartbeat();
    // 重连成功后拉增量消息，补齐离线期间漏收的座席回复
    void fetchMissingMessages(sessionId.value);
  }

  function handleWsClose(event: CloseEvent): void {
    visitorWs = null;
    wsStatus.value = 'disconnected';
    // 断线时停止心跳
    stopHeartbeat();

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

  /**
   * 发送输入中信号（访客正在打字）。
   * 不写入历史，由后端仅转发给座席。
   */
  function sendTyping(): void {
    sendTypingSignal(visitorWs);
  }

  return { wsStatus, connect, disconnect, sendText, sendTyping };
}
