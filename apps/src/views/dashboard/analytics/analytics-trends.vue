<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { ConversationTrendItem } from '#/api/dashboard';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { CHART_COLORS } from './chart-theme';

const props = defineProps<{
  /** 会话趋势数据（按月，区分人工/AI） */
  data?: ConversationTrendItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render(data: ConversationTrendItem[] = []) {
  const months = data.map((item) => item.month);
  const humanCounts = data.map((item) => item.humanCount);
  const aiCounts = data.map((item) => item.aiCount);
  const maxVal = Math.max(1, ...humanCounts, ...aiCounts);

  renderEcharts({
    grid: {
      bottom: 30,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: '2%',
    },
    legend: {
      bottom: 0,
      data: ['人工会话', 'AI 会话'],
    },
    series: [
      {
        areaStyle: {},
        data: humanCounts,
        itemStyle: {
          color: CHART_COLORS.primary,
        },
        name: '人工会话',
        smooth: true,
        type: 'line',
      },
      {
        areaStyle: {},
        data: aiCounts,
        itemStyle: {
          color: CHART_COLORS.success,
        },
        name: 'AI 会话',
        smooth: true,
        type: 'line',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: {
          color: CHART_COLORS.success,
          width: 1,
        },
      },
      trigger: 'axis',
    },
    xAxis: {
      axisTick: {
        show: false,
      },
      boundaryGap: false,
      data: months,
      splitLine: {
        lineStyle: {
          type: 'solid',
          width: 1,
        },
        show: true,
      },
      type: 'category',
    },
    yAxis: [
      {
        axisTick: {
          show: false,
        },
        max: Math.ceil(maxVal * 1.2),
        splitArea: {
          show: true,
        },
        splitNumber: 4,
        type: 'value',
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
