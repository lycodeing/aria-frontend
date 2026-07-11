<script lang="ts" setup>
import type { ComplexityItem } from '#/api/dashboard';

import { computed } from 'vue';

const props = defineProps<{
  /**
   * 复杂度分布（由页面用 getComplexityDistributionApi 映射后传入）。
   * 缺省或为空时使用占位数据，保证 UI 完整。
   */
  distribution?: ComplexityItem[];
}>();

const placeholder: ComplexityItem[] = [
  { label: '简单问题', percent: 68.4, color: 'bg-[#10B981]' },
  { label: '中等问题', percent: 24.1, color: 'bg-[#F59E0B]' },
  { label: '复杂问题', percent: 7.5, color: 'bg-[#EF4444]' },
];

// 优先展示真实数据；未加载 / 接口异常（空数组）时回退占位
const rows = computed<ComplexityItem[]>(() =>
  props.distribution && props.distribution.length > 0
    ? props.distribution
    : placeholder,
);
</script>

<template>
  <div class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
    <p class="mb-3 text-sm font-medium">复杂度趋势</p>
    <div class="flex flex-col gap-3">
      <div v-for="row in rows" :key="row.label">
        <div class="mb-1 flex items-center justify-between text-xs">
          <span class="text-muted-foreground">{{ row.label }}</span>
          <span class="font-medium tabular-nums"
            >{{ row.percent.toFixed(1) }}%</span
          >
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full rounded-full"
            :class="row.color"
            :style="{ width: `${row.percent}%` }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>
