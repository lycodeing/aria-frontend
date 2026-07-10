// apps/src/composables/useSessionQueueChannel.ts
import type { Ref } from 'vue';

import type {
  SessionQueueItem as ApiSessionItem,
  SessionSseEvent,
} from '#/api/session';
import type { QueueItem } from '#/composables/useSessionQueue';

import { ref } from 'vue';

import { message as antMessage } from 'ant-design-vue';

import { getSessionQueueApi, subscribeSessionEvents } from '#/api/session';
import { formatWaitTime, resolveTagColor } from '#/composables/useSessionQueue';

// ---- 类型 ----

export type EnqueueHandler = (item: QueueItem) => void;
export type ClosedHandler = (sessionId: string) => void;
export type TransferHandler = (event: SessionSseEvent) => void;

export interface SessionQueueChannel {
  readonly queue: Readonly<Ref<QueueItem[]>>;
  readonly sseConnected: Readonly<Ref<boolean>>;
  init(token: string): void;
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

// ---- 内部工具（toQueueItem 未从 useSessionQueue 导出，此处内联） ----

const QUEUE_AVATAR_COLOR = '#f87171';

function toQueueItem(item: ApiSessionItem): QueueItem {
  return {
    id: item.sessionId,
    name: item.userName,
    color: QUEUE_AVATAR_COLOR,
    waitMin: formatWaitTime(item.waitSince),
    waitSince: item.waitSince,
    reason: item.transferReason,
    tag: item.tag,
    tagColor: resolveTagColor(item.tag),
  };
}

// ---- 模块级单例状态 ----

const queue = ref<QueueItem[]>([]);
const sseConnected = ref(false);

let eventSource: EventSource | null = null;
let sseRetryCount = 0;
let sseRetryTimer: null | ReturnType<typeof setTimeout> = null;
let waitTimer: null | ReturnType<typeof setInterval> = null;

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

  eventSource = subscribeSessionEvents(
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
      // 断线：指数退避重连
      sseConnected.value = false;
      eventSource?.close();
      eventSource = null;
      const delay = Math.min(BASE_DELAY_MS * 2 ** sseRetryCount, MAX_DELAY_MS);
      sseRetryCount++;
      sseRetryTimer = setTimeout(_connect, delay);
    },
    () => {
      sseRetryCount = 0;
      sseConnected.value = true;
    },
  );

  _startWaitTimer();
}

// ---- loadQueue ----

async function loadQueue(): Promise<void> {
  try {
    const items = await getSessionQueueApi();
    queue.value = items.map((item) => toQueueItem(item));
  } catch (error) {
    console.error('[useSessionQueueChannel] loadQueue 失败:', error);
  }
}

// ---- 导出单例 ----

export function useSessionQueueChannel(): SessionQueueChannel {
  return {
    queue,
    sseConnected,

    init(_token: string) {
      if (eventSource) return; // 幂等：已连接则不重复建连
      sseRetryCount = 0;
      _connect();
    },

    dispose() {
      _stopSse();
      _stopWaitTimer();
      queue.value = [];
      sseRetryCount = 0;
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
