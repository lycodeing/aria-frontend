<script lang="ts" setup>
/**
 * 带 sparkline 微趋势的 KPI 卡片
 *
 * 在原 AnalysisOverview 基础上增加底部迷你柱状趋势条，
 * 让用户无需展开图表即可感知走势。趋势数据来自父组件传入的月度数组。
 */
import { computed } from 'vue';

import { VbenCountToAnimator } from '@vben-core/shadcn-ui';

interface Props {
  /** 卡片标题 */
  title: string;
  /** 主数值 */
  value: number;
  /** 副标题 */
  totalTitle: string;
  /** 副数值 */
  totalValue: number;
  /** 图标颜色主题 */
  color?: 'amber' | 'primary' | 'purple' | 'success';
  /** sparkline 数据（月度数值数组，最新在右） */
  trend?: number[];
}

const props = withDefaults(defineProps<Props>(), {
  color: 'primary',
  trend: () => [],
});

const colorMap = {
  amber: { bg: 'bg-amber-50', bar: 'bg-amber-400', text: 'text-amber-600' },
  primary: {
    bg: 'bg-blue-50',
    bar: 'bg-blue-400',
    text: 'text-blue-600',
  },
  purple: {
    bg: 'bg-violet-50',
    bar: 'bg-violet-400',
    text: 'text-violet-600',
  },
  success: {
    bg: 'bg-emerald-50',
    bar: 'bg-emerald-400',
    text: 'text-emerald-600',
  },
} as const;

const styles = computed(() => colorMap[props.color]);

/** sparkline 归一化高度（最大值映射到 100%） */
const sparkHeights = computed(() => {
  const data = props.trend;
  if (data.length === 0) return [];
  const max = Math.max(...data, 1);
  return data.map((v) => Math.max(8, Math.round((v / max) * 100)));
});
</script>

<template>
  <div
    class="flex flex-col rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
  >
    <!-- 标题 + 图标 -->
    <div class="mb-2 flex items-center justify-between">
      <span class="text-xs text-muted-foreground">{{ title }}</span>
      <div
        class="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold"
        :class="[styles.bg, styles.text]"
      >
        {{ title.charAt(0) }}
      </div>
    </div>

    <!-- 主数值 -->
    <VbenCountToAnimator
      :end-val="value"
      :start-val="0"
      class="text-2xl font-bold leading-none tabular-nums"
      prefix=""
    />

    <!-- 副标题 + 副数值 -->
    <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span>{{ totalTitle }}</span>
      <VbenCountToAnimator
        :end-val="totalValue"
        :start-val="0"
        class="font-medium tabular-nums"
        prefix=""
      />
    </div>

    <!-- sparkline 微趋势 -->
    <div v-if="sparkHeights.length > 0" class="mt-3 flex items-end gap-1">
      <div
        v-for="(h, i) in sparkHeights"
        :key="i"
        class="w-1 flex-1 rounded-sm transition-all"
        :class="styles.bar"
        :style="{
          height: `${h}%`,
          opacity: 0.3 + (i / sparkHeights.length) * 0.7,
        }"
      ></div>
    </div>
  </div>
</template>
