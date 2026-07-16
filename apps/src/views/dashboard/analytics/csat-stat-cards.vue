<script lang="ts" setup>
/**
 * CsatStatCards — 满意度评价（CSAT）概览指标卡。
 *
 * 三块指标：平均评分、评价响应率、评价总数。
 * 数据来自 GET /dashboard/csat-overview。
 */
import { computed } from 'vue';

import { Icon } from '@iconify/vue';

const props = defineProps<{
  /** 平均评分（0–5，0 表示无数据） */
  avgScore: number;
  /** 评价总数 */
  ratedCount: number;
  /** 评价响应率（0–1） */
  responseRate: number;
}>();

const hasData = computed(() => props.ratedCount > 0);

function scoreColor(score: number): string {
  if (score >= 4.5) return '#10B981';
  if (score >= 3.5) return '#3B82F6';
  if (score >= 2.5) return '#F59E0B';
  return '#EF4444';
}
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
    <!-- 平均评分 -->
    <div
      class="flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
    >
      <div
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        style="background: #eef2ff"
      >
        <Icon icon="lucide:star" class="text-xl" style="color: #4f46e5" />
      </div>
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">平均评分</p>
        <p class="text-2xl font-semibold leading-none tabular-nums">
          <span :style="{ color: scoreColor(avgScore) }">
            {{ hasData ? avgScore.toFixed(2) : '—' }}
          </span>
          <span class="ml-1 text-sm font-normal text-muted-foreground"
            >/ 5</span
          >
        </p>
      </div>
    </div>

    <!-- 评价响应率 -->
    <div
      class="flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
    >
      <div
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        style="background: #ecfdf5"
      >
        <Icon icon="lucide:percent" class="text-xl" style="color: #10b981" />
      </div>
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">评价响应率</p>
        <p class="text-2xl font-semibold leading-none tabular-nums">
          {{ hasData ? (responseRate * 100).toFixed(1) : '—' }}
          <span class="ml-1 text-sm font-normal text-muted-foreground">%</span>
        </p>
      </div>
    </div>

    <!-- 评价总数 -->
    <div
      class="flex items-center gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
    >
      <div
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        style="background: #fef2f2"
      >
        <Icon
          icon="lucide:message-square-heart"
          class="text-xl"
          style="color: #ef4444"
        />
      </div>
      <div class="min-w-0">
        <p class="text-xs text-muted-foreground">评价总数</p>
        <p class="text-2xl font-semibold leading-none tabular-nums">
          {{ ratedCount }}
        </p>
      </div>
    </div>
  </div>
</template>
