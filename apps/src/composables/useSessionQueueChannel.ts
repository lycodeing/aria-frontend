// apps/src/composables/useSessionQueueChannel.ts
import type { Ref } from 'vue';

import type { SessionSseEvent } from '#/api/session';
import type { QueueItem } from '#/composables/useSessionQueue';

import { ref } from 'vue';

import { message as antMessage } from 'ant-design-vue';

import { getSessionQueueApi, subscribeSessionEvents } from '#/api/session';
import { formatWaitTime, toQueueItem } from '#/composables/useSessionQueue';

// ---- 类型 ----

export type EnqueueHandler = (item: QueueItem) => void;
export type ClosedHandler = (sessionId: string) => void;
export type TransferHandler = (event: SessionSseEvent) => void;

export interface SessionQueueChannel {
  readonly queue: Readonly<Ref<QueueItem[]>>;
  readonly sseConnected: Readonly<Ref<boolean>>;
  readonly sseStatus: Readonly<Ref<'closed' | 'connecting' | 'error' | 'open'>>;
  init(): void;
  dispose(): void;
  reconnect(): void;
  loadQueue(): Promise<void>;
  onEnqueue(handler: EnqueueHandler): void;
  offEnqueue(handler: EnqueueHandler): void;
  onClosed(handler: ClosedHandler): void;
  offClosed(handler: ClosedHandler): void;
  onTransfer(handler: TransferHandler): void;
  offTransfer(handler: TransferHandler): void;
}

// ---- 重连常量 ----

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRIES = 10;

// ---- 模块级单例状态 ----

const queue = ref<QueueItem[]>([]);
const sseConnected = ref(false);
const sseStatus = ref<'closed' | 'connecting' | 'error' | 'open'>('closed');

let eventSource: EventSource | null = null;
let sseRetryCount = 0;
let sseRetryTimer: null | ReturnType<typeof setTimeout> = null;
let waitTimer: null | ReturnType<typeof setInterval> = null;
let _loadGen = 0;

// 多播监听器
const enqueueHandlers = new Set<EnqueueHandler>();
const closedHandlers = new Set<ClosedHandler>();
const transferHandlers = new Set<TransferHandler>();

// ---- 内部函数 ----

function _stopWaitTimer(): void {
  if (waitTimer !== null) {
    clearInterval(waitTimer);
    waitTimer = null;
  }
}

function _startWaitTimer(): void {
  _stopWaitTimer();
  waitTimer = setInterval(() => {
    queue.value.forEach((item) => {
      item.waitMin = formatWaitTime(item.waitSince);
    });
  }, 1000);
}

function _stopSse(): void {
  if (sseRetryTimer !== null) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  eventSource?.close();
  eventSource = null;
  sseConnected.value = false;
}

function _connect(): void {
  _stopSse();

  const es = subscribeSessionEvents(
    (event) => {
      sseRetryCount = 0;
      const sid = event.item?.sessionId;
      if (!sid) return;

      if (event.type === 'ENQUEUE') {
        const item = event.item;
        if (!queue.value.some((q) => q.id === item.sessionId)) {
          const qi = toQueueItem(item);
          queue.value.push(qi);
          antMessage.info(`新会话请求：${item.userName}`);
          enqueueHandlers.forEach((h) => h(qi));
        }
      } else if (event.type === 'ACCEPTED' || event.type === 'CLOSED') {
        queue.value = queue.value.filter((q) => q.id !== sid);
        if (event.type === 'CLOSED') {
          closedHandlers.forEach((h) => h(sid));
        }
      } else if (event.type === 'TRANSFER') {
        queue.value = queue.value.filter((q) => q.id !== sid);
        transferHandlers.forEach((h) => h(event));
      }
    },
    () => {
      // Stale guard: if this error belongs to an old ES, ignore it (I-1)
      if (eventSource !== es) return;
      // 断线：指数退避重连
      sseConnected.value = false;
      es.close(); // 阻止原生 EventSource 自动重连，避免与 setTimeout 重连并存（双重连接）
      eventSource = null;
      if (sseRetryCount >= MAX_RETRIES) {
        sseStatus.value = 'error';
        return; // stop retrying (I-3)
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** sseRetryCount, MAX_DELAY_MS);
      sseRetryCount++;
      sseStatus.value = 'connecting';
      sseRetryTimer = setTimeout(_connect, delay);
    },
    () => {
      sseRetryCount = 0;
      sseConnected.value = true;
      sseStatus.value = 'open';
    },
  );

  eventSource = es;
  _startWaitTimer();
}

// ---- loadQueue ----

async function loadQueue(): Promise<void> {
  const gen = ++_loadGen;
  try {
    const items = await getSessionQueueApi();
    if (gen !== _loadGen) return; // dispose() was called mid-flight (I-2)
    queue.value.splice(
      0,
      queue.value.length,
      ...items.map((item) => toQueueItem(item)),
    );
  } catch (error) {
    console.error('[useSessionQueueChannel] loadQueue 失败:', error);
  }
}

// ---- 导出单例 ----

export function useSessionQueueChannel(): SessionQueueChannel {
  return {
    queue,
    sseConnected,
    sseStatus,

    // token は subscribeSessionEvents 内部で useAccessStore から取得するため、
    // パラメータは不要。(M-1)
    init() {
      if (eventSource) return; // 幂等：已连接则不重复建连
      sseRetryCount = 0;
      sseStatus.value = 'connecting';
      _connect();
    },

    dispose() {
      _stopSse();
      _stopWaitTimer();
      _loadGen++; // invalidate any in-flight loadQueue() (I-2)
      queue.value.splice(0);
      sseRetryCount = 0;
      sseStatus.value = 'closed';
      // 清空所有事件监听器，防止 logout → re-login 场景下回调残留
      enqueueHandlers.clear();
      closedHandlers.clear();
      transferHandlers.clear();
    },

    reconnect() {
      sseRetryCount = 0;
      _connect();
    },

    loadQueue,

    onEnqueue(handler) {
      enqueueHandlers.add(handler);
    },
    offEnqueue(handler) {
      enqueueHandlers.delete(handler);
    },
    onClosed(handler) {
      closedHandlers.add(handler);
    },
    offClosed(handler) {
      closedHandlers.delete(handler);
    },
    onTransfer(handler) {
      transferHandlers.add(handler);
    },
    offTransfer(handler) {
      transferHandlers.delete(handler);
    },
  };
}
