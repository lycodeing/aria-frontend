// apps/src/composables/useSessionQueueChannel.ts
import type { ComputedRef, Ref } from 'vue';

import type { SessionSseEvent } from '#/api/session';
import type { QueueItem } from '#/composables/useSessionQueue';

import { computed, ref } from 'vue';

import { message as antMessage } from 'ant-design-vue';

import { doReAuthenticate } from '#/api/request';
import { getAllSessionsApi, subscribeSessionEvents } from '#/api/session';
import { formatWaitTime, toQueueItem } from '#/composables/useSessionQueue';

// ---- 类型 ----

export type EnqueueHandler = (item: QueueItem) => void;
export type ClosedHandler = (sessionId: string) => void;
export type TransferHandler = (event: SessionSseEvent) => void;

export interface SessionQueueChannel {
  /** 底层 flat list（外部只读，四个切片的数据源） */
  readonly sessions: Readonly<Ref<QueueItem[]>>;

  /** 四个 Tab 直接绑定的 computed 切片 */
  readonly aiQueue: ComputedRef<QueueItem[]>;
  readonly waitingQueue: ComputedRef<QueueItem[]>;
  readonly activeQueue: ComputedRef<QueueItem[]>;
  readonly closedQueue: ComputedRef<QueueItem[]>;

  readonly sseConnected: Readonly<Ref<boolean>>;
  readonly sseStatus: Readonly<Ref<'closed' | 'connecting' | 'error' | 'open'>>;

  init(): void;
  dispose(): void;
  reconnect(): void;
  /** 从统一接口加载全量会话，替代原 loadQueue() */
  loadSessions(): Promise<void>;
  /** 从 sessions 中移除指定会话（用于 TRANSFER 乐观更新） */
  removeFromSessions(id: string): void;

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

const sessions = ref<QueueItem[]>([]);
const sseConnected = ref(false);
const sseStatus = ref<'closed' | 'connecting' | 'error' | 'open'>('closed');

// 四个 computed 切片（惰性求值）
const aiQueue = computed(() =>
  sessions.value.filter((s) => s.status === 'AI_CHAT'),
);
const waitingQueue = computed(() =>
  sessions.value.filter((s) => s.status === 'WAITING'),
);
const activeQueue = computed(() =>
  sessions.value.filter((s) => s.status === 'ACTIVE'),
);
const closedQueue = computed(() =>
  sessions.value.filter((s) => s.status === 'CLOSED'),
);

let eventSource: null | { close(): void } = null;
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
    sessions.value.forEach((item) => {
      // CLOSED 条目的等待时间不需要实时刷新
      if (item.status !== 'CLOSED') {
        item.waitMin = formatWaitTime(item.waitSince);
      }
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
        const existing = sessions.value.find((s) => s.id === item.sessionId);
        if (existing) {
          // 幂等：已存在则更新 status（防止重放）
          existing.status = item.status;
        } else {
          const qi = toQueueItem(item);
          sessions.value.push(qi);
          antMessage.info(`新会话请求：${item.userName}`);
          enqueueHandlers.forEach((h) => h(qi));
        }
      } else if (event.type === 'ACCEPTED') {
        // 原地更新 status → ACTIVE，条目保留在 flat list
        const found = sessions.value.find((s) => s.id === sid);
        if (found) found.status = 'ACTIVE';
      } else if (event.type === 'CLOSED') {
        // 原地更新 status → CLOSED，条目保留以便 CLOSED Tab 展示
        const found = sessions.value.find((s) => s.id === sid);
        if (found) found.status = 'CLOSED';
        closedHandlers.forEach((h) => h(sid));
      } else if (event.type === 'TRANSFER') {
        // 转交给其他座席，本座席不再持有该会话，直接移除
        sessions.value = sessions.value.filter((s) => s.id !== sid);
        transferHandlers.forEach((h) => h(event));
      }
    },
    () => {
      if (eventSource !== es) return;
      sseConnected.value = false;
      es.close();
      eventSource = null;
      if (sseRetryCount >= MAX_RETRIES) {
        sseStatus.value = 'error';
        return;
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
    () => {
      // SSE 握手 401：token 过期，不再重试，清 token 走 logout/modal。
      // basic.vue 的 accessToken watcher 会自动 dispose channel，
      // 用户重新登录后 token 重建会再次 init()。
      if (eventSource !== es) return;
      es.close();
      eventSource = null;
      sseConnected.value = false;
      sseStatus.value = 'closed';
      void doReAuthenticate();
    },
  );

  eventSource = es;
  _startWaitTimer();
}

// ---- loadSessions ----

async function loadSessions(): Promise<void> {
  const gen = ++_loadGen;
  try {
    const items = await getAllSessionsApi();
    if (gen !== _loadGen) return;
    sessions.value.splice(
      0,
      sessions.value.length,
      ...items.map((item) => toQueueItem(item)),
    );
  } catch (error) {
    console.error('[useSessionQueueChannel] loadSessions 失败:', error);
  }
}

// ---- 导出单例 ----

export function useSessionQueueChannel(): SessionQueueChannel {
  return {
    sessions,
    aiQueue,
    waitingQueue,
    activeQueue,
    closedQueue,
    sseConnected,
    sseStatus,

    init() {
      if (eventSource) return;
      sseRetryCount = 0;
      sseStatus.value = 'connecting';
      _connect();
    },

    dispose() {
      _stopSse();
      _stopWaitTimer();
      _loadGen++;
      sessions.value.splice(0);
      sseRetryCount = 0;
      sseStatus.value = 'closed';
      // handler Sets are intentionally NOT cleared here: page components own
      // their own offClosed / offTransfer / offEnqueue lifecycle and call them
      // in their onUnmounted hooks. Clearing here would silently break components
      // that re-init the channel after a dispose-reinit cycle.
    },

    reconnect() {
      sseRetryCount = 0;
      sseStatus.value = 'connecting';
      _connect();
    },

    loadSessions,

    removeFromSessions(id: string) {
      const idx = sessions.value.findIndex((s) => s.id === id);
      if (idx !== -1) sessions.value.splice(idx, 1);
    },

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
