import type { SessionQueueItem as ApiSessionItem } from '#/api/session';

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

function formatWaitTime(waitSince: number): string {
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
 * - 订阅 SSE 事件（ENQUEUE / ACCEPTED / CLOSED）
 * - 组件卸载时自动关闭 EventSource
 *
 * 使用方：
 *   const { queue, pagedQueue, queuePage, queueTotalPages, loadQueue } = useSessionQueue()
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

  // SSE 订阅
  let eventSource: EventSource | null = null;

  function subscribeQueue(onEnqueue?: (item: QueueItem) => void) {
    eventSource = subscribeSessionEvents((event) => {
      if (event.type === 'ENQUEUE') {
        const item = event.item;
        if (!queue.value.some((q) => q.id === item.sessionId)) {
          const qi = toQueueItem(item);
          queue.value.push(qi);
          antMessage.info(`新会话请求：${item.userName}`);
          onEnqueue?.(qi);
        }
      } else if (event.type === 'ACCEPTED' || event.type === 'CLOSED') {
        queue.value = queue.value.filter((q) => q.id !== event.item.sessionId);
      }
    });
  }

  async function acceptItem(item: QueueItem): Promise<ApiSessionItem> {
    await acceptSessionApi(item.id);
    queue.value = queue.value.filter((q) => q.id !== item.id);
    return {
      sessionId: item.id,
      userName: item.name,
      transferReason: item.reason,
      tag: item.tag,
      waitSince: 0,
      status: 'ACTIVE',
    };
  }

  onUnmounted(() => {
    eventSource?.close();
  });

  return {
    queue,
    queuePage,
    queueTotalPages,
    pagedQueue,
    loadQueue,
    subscribeQueue,
    acceptItem,
    formatWaitTime,
  };
}
