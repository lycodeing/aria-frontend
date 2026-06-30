import type {
  SessionQueueItem as ApiSessionItem,
  SessionSseEvent,
} from '#/api/session';

import { computed, onUnmounted, ref, watch } from 'vue';

import { message as antMessage } from 'ant-design-vue';

import {
  acceptSessionApi,
  getSessionQueueApi,
  subscribeSessionEvents,
} from '#/api/session';

// 标签颜色映射，消除内联三目运算符
const TAG_COLOR_MAP: Record<string, string> = {
  投诉: 'red',
  退款: 'orange',
  订单: 'blue',
  账单: 'blue',
};

function resolveTagColor(tag: string): string {
  return TAG_COLOR_MAP[tag] ?? 'blue';
}

export function formatWaitTime(waitSince: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - waitSince));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface QueueItem {
  id: string;
  name: string;
  color: string;
  waitMin: string;
  waitSince: number; // 保留原始时间戳供定时刷新使用
  reason: string;
  tag: string;
  tagColor: string;
}

/**
 * useSessionQueue — 等待队列 + SSE 实时通知 Composable。
 *
 * 职责：
 * - 维护 queue ref（QueueItem[]）
 * - 分页计算属性（pagedQueue / totalPages）
 * - loadQueue() 从 API 加载初始队列
 * - subscribeQueue() 订阅 SSE 事件，内置指数退避重连（最大 30s）
 * - 每秒定时刷新队列中所有项的等待时间显示
 * - 组件卸载时自动关闭 EventSource 和定时器
 */
export function useSessionQueue(pageSize = 5) {
  const queue = ref<QueueItem[]>([]);
  const queuePage = ref(1);

  const queueTotalPages = computed(() =>
    Math.max(1, Math.ceil(queue.value.length / pageSize)),
  );

  const pagedQueue = computed(() => {
    const start = (queuePage.value - 1) * pageSize;
    return queue.value.slice(start, start + pageSize);
  });

  // 新会话入队时自动回到第一页
  watch(
    () => queue.value.length,
    () => {
      queuePage.value = 1;
    },
  );

  function toQueueItem(item: ApiSessionItem): QueueItem {
    return {
      id: item.sessionId,
      name: item.userName,
      color: '#f87171',
      waitMin: formatWaitTime(item.waitSince),
      waitSince: item.waitSince,
      reason: item.transferReason,
      tag: item.tag,
      tagColor: resolveTagColor(item.tag),
    };
  }

  async function loadQueue() {
    try {
      const items = await getSessionQueueApi();
      queue.value = items.map((item) => toQueueItem(item));
    } catch {
      // 加载失败时保持空队列，不阻断主流程
    }
  }

  // ---- 等待时间定时刷新 ----
  let waitTimer: ReturnType<typeof setInterval> | null = null;

  function startWaitTimer() {
    stopWaitTimer();
    // 每秒更新所有队列项的 waitMin 显示
    waitTimer = setInterval(() => {
      queue.value.forEach((item) => {
        item.waitMin = formatWaitTime(item.waitSince);
      });
    }, 1000);
  }

  function stopWaitTimer() {
    if (waitTimer !== null) {
      clearInterval(waitTimer);
      waitTimer = null;
    }
  }

  // ---- SSE 订阅（含指数退避重连） ----
  let eventSource: EventSource | null = null;
  let sseRetryCount = 0;
  let sseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const sseConnected = ref(false); // SSE 连接状态（供模板显示状态点使用）

  function subscribeQueue(
    onEnqueue?: (item: QueueItem) => void,
    onClosed?: (sessionId: string) => void,
    onTransfer?: (event: SessionSseEvent) => void,
  ) {
    // 防止多次调用时 EventSource 泄漏：先关闭旧连接
    eventSource?.close();
    eventSource = null;
    if (sseRetryTimer !== null) {
      clearTimeout(sseRetryTimer);
      sseRetryTimer = null;
    }

    eventSource = subscribeSessionEvents(
      (event) => {
        sseRetryCount = 0; // 成功收到消息，重置重试计数
        const sid = event.item?.sessionId;
        if (!sid) return;

        if (event.type === 'ENQUEUE') {
          const item = event.item;
          if (!queue.value.some((q) => q.id === item.sessionId)) {
            const qi = toQueueItem(item);
            queue.value.push(qi);
            antMessage.info(`新会话请求：${item.userName}`);
            onEnqueue?.(qi);
          }
        } else if (event.type === 'ACCEPTED' || event.type === 'CLOSED') {
          queue.value = queue.value.filter((q) => q.id !== sid);
          if (event.type === 'CLOSED') {
            onClosed?.(sid);
          }
        } else if (event.type === 'TRANSFER') {
          // 转交事件：从等待队列移除，通知调用方（含 fromAgentId / toAgentId）
          queue.value = queue.value.filter((q) => q.id !== sid);
          onTransfer?.(event);
        }
      },
      () => {
        // SSE 断线：必须先 close 旧连接，防止浏览器自动重连与 setTimeout 重连并存（双重连接）
        sseConnected.value = false;
        eventSource?.close();
        eventSource = null;
        const delay = Math.min(1000 * 2 ** sseRetryCount, 30_000);
        sseRetryCount++;
        sseRetryTimer = setTimeout(
          () => subscribeQueue(onEnqueue, onClosed, onTransfer),
          delay,
        );
      },
      () => {
        sseRetryCount = 0; // 连接成功，重置重试计数
        sseConnected.value = true;
      },
    );

    // 启动等待时间定时刷新
    startWaitTimer();
  }

  async function acceptItem(item: QueueItem): Promise<ApiSessionItem> {
    await acceptSessionApi(item.id);
    queue.value = queue.value.filter((q) => q.id !== item.id);
    return {
      sessionId: item.id,
      userName: item.name,
      transferReason: item.reason,
      tag: item.tag,
      waitSince: item.waitSince,
      status: 'ACTIVE',
    };
  }

  onUnmounted(() => {
    eventSource?.close();
    stopWaitTimer();
    if (sseRetryTimer !== null) clearTimeout(sseRetryTimer);
  });

  return {
    queue,
    queuePage,
    queueTotalPages,
    pagedQueue,
    sseConnected,
    loadQueue,
    subscribeQueue,
    acceptItem,
    formatWaitTime,
  };
}
