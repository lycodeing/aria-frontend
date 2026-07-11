<script lang="ts" setup>
import type { RecentSessionItem } from '#/api/dashboard';

const props = defineProps<{
  /** 最近会话列表（来自 getRecentSessionsApi） */
  items?: RecentSessionItem[];
}>();

/** 会话状态 → 色点（与设计稿优先级色保持一致） */
const statusDotMap: Record<string, string> = {
  WAITING: 'bg-amber-500',
  ACTIVE: 'bg-blue-500',
  CLOSED: 'bg-zinc-300',
};

/** 相对时间：ISO 字符串 → “x分钟前 / x小时前 / x天前” */
function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min}分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}
</script>

<template>
  <div class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
    <div class="mb-3 flex items-center justify-between">
      <span class="text-sm font-medium">待处理列表</span>
      <span class="cursor-pointer text-xs text-primary">查看全部 →</span>
    </div>
    <div class="flex flex-col gap-2">
      <div
        v-for="item in (items ?? [])
          .filter((i) => i.status !== 'CLOSED')
          .slice(0, 4)"
        :key="item.sessionId"
        class="flex items-center justify-between rounded-md bg-muted px-3 py-2"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :class="statusDotMap[item.status] ?? 'bg-blue-500'"
          ></span>
          <div class="min-w-0">
            <p class="truncate text-xs font-medium">
              {{ item.visitorName || '访客' }}
              <span v-if="item.tag" class="text-muted-foreground"
                >· {{ item.tag }}</span
              >
            </p>
            <p
              v-if="item.transferReason"
              class="truncate text-[11px] text-muted-foreground"
            >
              {{ item.transferReason }}
            </p>
          </div>
        </div>
        <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {{ relativeTime(item.startedAt) }}
        </span>
      </div>
      <p
        v-if="!items || items.filter((i) => i.status !== 'CLOSED').length === 0"
        class="py-2 text-center text-xs text-muted-foreground"
      >
        暂无待处理会话
      </p>
    </div>
  </div>
</template>
