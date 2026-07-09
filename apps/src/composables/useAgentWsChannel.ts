import type { Ref } from 'vue';

import type { WsChatMessage } from '#/api/session';

import { ref } from 'vue';

// ---- 类型定义 ----

export interface ChannelCallbacks {
  onMessage: (msg: WsChatMessage) => void;
  onTyping?: (sessionId: string) => void;
  onReconnect?: (sessionId: string) => void;
}

export interface AgentWsChannelOptions {
  // 多登录模式（BROADCAST/KICK）由后端 agent.ws.multi-login-mode 配置，前端无需传递
  onKickedOut?: () => void;
}

export interface AgentWsChannel {
  init(token: string, options?: AgentWsChannelOptions): void;
  /**
   * token 刷新时调用：只换 token 重建 WS，不清 subscriberMap。
   * 与 dispose()+init() 的区别：保留所有会话订阅，避免 token 刷新导致消息丢失。
   */
  reconnect(newToken: string): void;
  dispose(): void;
  subscribe(sessionId: string, callbacks: ChannelCallbacks): void;
  unsubscribe(sessionId: string): void;
  send(sessionId: string, content: string): boolean;
  sendTyping(sessionId: string): void;
  readonly status: Ref<'closed' | 'connecting' | 'error' | 'kicked' | 'open'>;
}

// ---- 重连常量 ----

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRIES = 10;
const HEARTBEAT_MS = 12_000;

// ---- 模块级单例状态 ----

let ws: null | WebSocket = null;
let _token = '';
let retryCount = 0;
let retryTimer: null | ReturnType<typeof setTimeout> = null;
let heartbeatTimer: null | ReturnType<typeof setInterval> = null;
/** KICK 模式下被踢出，禁止自动重连 */
let kicked = false;
let _onKickedOut: (() => void) | undefined;

/** sessionId → 订阅回调集合 */
const subscriberMap = new Map<string, Set<ChannelCallbacks>>();

/** 响应式状态，供 UI 展示连接指示器 */
const status = ref<'closed' | 'connecting' | 'error' | 'kicked' | 'open'>(
  'closed',
);

// ---- 内部工具函数 ----

function buildWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/agent?token=${encodeURIComponent(_token)}`;
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!ws) {
      stopHeartbeat();
      return;
    }
    const dead =
      ws.readyState === WebSocket.CLOSED ||
      ws.readyState === WebSocket.CLOSING ||
      !navigator.onLine;
    if (dead && status.value === 'open') {
      ws.close(); // 触发 onclose → scheduleReconnect
    }
  }, HEARTBEAT_MS);
}

function scheduleReconnect(): void {
  if (retryCount >= MAX_RETRIES) {
    status.value = 'error';
    // 401 握手失败耗尽重试后 status='error'，由 basic.vue 监听并触发 token 刷新
    return;
  }
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retryCount);
  retryCount++;
  retryTimer = setTimeout(connect, delay);
}

function onOpen(): void {
  status.value = 'open';
  retryCount = 0;
  startHeartbeat();
  // 重连成功后通知所有订阅会话，触发漏消息补齐（sinceSeq 增量拉取）
  subscriberMap.forEach((cbs, sessionId) => {
    cbs.forEach((cb) => cb.onReconnect?.(sessionId));
  });
}

function onMessage(event: MessageEvent): void {
  let msg: WsChatMessage;
  try {
    msg = JSON.parse(event.data as string) as WsChatMessage;
  } catch {
    return;
  }

  // KICKED_OUT 是连接级信令，无 sessionId，直接处理后返回
  if (msg.type === 'KICKED_OUT') {
    kicked = true;
    status.value = 'kicked';
    ws?.close();
    _onKickedOut?.();
    return;
  }

  const { sessionId, type } = msg;
  if (!sessionId) return;

  const cbs = subscriberMap.get(sessionId);
  if (!cbs) return;

  // TYPING 信号由订阅层单独处理，其余消息统一走 onMessage
  cbs.forEach((cb) => {
    if (type === 'TYPING') {
      cb.onTyping?.(sessionId);
    } else {
      cb.onMessage(msg);
    }
  });
}

/**
 * onClose 回调使用闭包捕获对应的 socket 实例。
 * 关键：只清理触发本次 onclose 的那个 socket，防止 dispose()+init() 后
 * 旧连接的异步 onclose 把新建的 ws 引用抹掉（竞态 bug）。
 */
function makeOnClose(socket: WebSocket): () => void {
  return function onClose() {
    if (ws === socket) ws = null;
    stopHeartbeat();
    // 先检查 kicked（被踢出），再检查 status（主动 dispose）
    if (!kicked && status.value !== 'closed') {
      status.value = 'connecting';
      scheduleReconnect();
    }
  };
}

function onError(): void {
  // 握手失败（401）时浏览器先触发 onerror 再触发 onclose；
  // status 会在 onclose → scheduleReconnect 里更新。
  // 若 retryCount 耗尽，status='error'，由 basic.vue 的 watch(status) 处理 token 刷新。
}

function onBrowserOffline(): void {
  if (ws && status.value === 'open') {
    ws.close(); // 触发 onclose → scheduleReconnect
  }
}

function connect(): void {
  if (
    ws &&
    (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
  )
    return;

  status.value = 'connecting';
  const socket = new WebSocket(buildWsUrl());
  ws = socket;
  socket.addEventListener('open', onOpen);
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', makeOnClose(socket));
  socket.addEventListener('error', onError);
}

// ---- 导出单例 ----

export function useAgentWsChannel(): AgentWsChannel {
  return {
    init(t: string, options?: AgentWsChannelOptions) {
      if (ws) return; // 幂等：已有连接则不重复建连
      _token = t;
      kicked = false;
      _onKickedOut = options?.onKickedOut;
      window.addEventListener('offline', onBrowserOffline);
      connect();
    },

    reconnect(newToken: string) {
      // token 刷新专用：只换 token 重建 WS，保留 subscriberMap 避免会话订阅丢失。
      // 不能调 dispose()+init()，因为 dispose 会清空订阅，刷新后消息静默丢失。
      _token = newToken;
      kicked = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      retryCount = 0;
      stopHeartbeat();
      ws?.close(); // 异步触发旧连接的 makeOnClose，但 ws 会立即在 connect() 中被替换
      status.value = 'connecting';
      // 延迟一个微任务，确保旧 socket 的 close 事件已注册
      setTimeout(connect, 0);
    },

    dispose() {
      status.value = 'closed';
      kicked = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      stopHeartbeat();
      window.removeEventListener('offline', onBrowserOffline);
      ws?.close();
      ws = null;
      // 不清 subscriberMap：token 刷新走 reconnect()；
      // 真正登出时组件也会卸载，订阅由 onScopeDispose 清理
    },

    subscribe(sessionId: string, callbacks: ChannelCallbacks) {
      if (!subscriberMap.has(sessionId))
        subscriberMap.set(sessionId, new Set());
      // Set 已在上方确保存在，直接取值
      const set = subscriberMap.get(sessionId);
      if (set) set.add(callbacks);
    },

    unsubscribe(sessionId: string) {
      subscriberMap.delete(sessionId);
    },

    send(sessionId: string, content: string): boolean {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'MESSAGE', sessionId, content }));
      return true;
    },

    sendTyping(sessionId: string): void {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'TYPING', sessionId }));
    },

    status,
  };
}
