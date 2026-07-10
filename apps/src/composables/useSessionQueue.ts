// apps/src/composables/useSessionQueue.ts
import type { SessionQueueItem as ApiSessionItem } from '#/api/session';

// 标签颜色映射
const TAG_COLOR_MAP: Record<string, string> = {
  投诉: 'red',
  退款: 'orange',
  订单: 'blue',
  账单: 'blue',
};

export function resolveTagColor(tag: string): string {
  return TAG_COLOR_MAP[tag] ?? 'blue';
}

export function formatWaitTime(waitSince: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - waitSince));
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}小时${m}分钟`;
  }
  if (sec < 60) {
    return `${sec}秒`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分钟${String(s).padStart(2, '0')}秒`;
}

export interface QueueItem {
  id: string;
  name: string;
  color: string;
  waitMin: string;
  waitSince: number;
  reason: string;
  tag: string;
  tagColor: string;
}

/** 头像色常量，供 channel 和页面一致使用 */
export const QUEUE_AVATAR_COLOR = '#f87171';

export function toQueueItem(item: ApiSessionItem): QueueItem {
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
