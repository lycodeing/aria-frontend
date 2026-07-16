<script lang="ts" setup>
/**
 * CsatTrendCard — CSAT 平均评分趋势（按天折线图）。
 *
 * 数据来自 GET /dashboard/csat-trend。无数据时显示空态。
 */
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { CsatTrendItem } from '#/api/csat/types';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { CHART_COLORS } from './chart-theme';

const props = defineProps<{
  /** 趋势数据（按日期升序） */
  data?: CsatTrendItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render(items: CsatTrendItem[] = []) {
  const dates = items.map((i) => i.date);
  const scores = items.map((i) => Number(i.avgScore?.toFixed(2) ?? 0));

  renderEcharts({
    grid: { containLabel: true, left: 8, right: 16, top: 24, bottom: 8 },
    legend: { bottom: 0 },
    tooltip: {
      axisPointer: { type: 'shadow' },
      trigger: 'axis',
    },
    xAxis: {
      axisLabel: { formatter: (v: string) => v?.slice(5) },
      boundaryGap: false,
      data: dates,
      type: 'category',
    },
    yAxis: {
      max: 5,
      min: 0,
      name: '评分',
      splitLine: { lineStyle: { type: 'dashed' } },
      type: 'value',
    },
    series: [
      {
        areaStyle: { opacity: 0.15 },
        color: CHART_COLORS.primary,
        data: scores,
        name: '平均评分',
        smooth: true,
        type: 'line',
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
