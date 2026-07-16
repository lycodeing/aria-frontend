<script lang="ts" setup>
/**
 * CsatDistributionCard — CSAT 星级分布（1–5 星柱状图）。
 *
 * 数据来自 GET /dashboard/csat-distribution。颜色随评分高低语义化
 * （1 星红 → 5 星绿），与 csat-stat-cards 的评分色阶一致。
 */
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { CsatDistributionItem } from '#/api/csat/types';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  /** 星级分布（score 1–5） */
  data?: CsatDistributionItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

/** 星级 → 语义色（与 csat-stat-cards 评分色阶对齐） */
const STAR_COLORS: Record<number, string> = {
  1: '#EF4444',
  2: '#F59E0B',
  3: '#F59E0B',
  4: '#3B82F6',
  5: '#10B981',
};

function render(items: CsatDistributionItem[] = []) {
  // 保证 1–5 星顺序展示，缺失星级补 0
  const byScore = new Map(items.map((i) => [i.score, i]));
  const scores = [1, 2, 3, 4, 5];
  const counts = scores.map((s) => byScore.get(s)?.count ?? 0);
  const colors = scores.map((s) => STAR_COLORS[s]);

  renderEcharts({
    grid: { containLabel: true, left: 8, right: 16, top: 16, bottom: 8 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      data: scores.map((s) => `${s}星`),
      type: 'category',
    },
    yAxis: {
      minInterval: 1,
      name: '评价数',
      splitLine: { lineStyle: { type: 'dashed' } },
      type: 'value',
    },
    series: [
      {
        barWidth: '48%',
        data: counts.map((v, idx) => ({
          itemStyle: { color: colors[idx] },
          value: v,
        })),
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        name: '评价数',
        type: 'bar',
      },
    ],
  });
}

watch(
  () => props.data,
  (val) => render(val ?? []),
  { immediate: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
