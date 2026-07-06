<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  /** 每月消息量 */
  counts?: number[];
  /** 月份标签 */
  months?: string[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render(months: string[] = [], counts: number[] = []) {
  const maxVal = Math.max(1, ...counts);

  renderEcharts({
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: '2 %',
    },
    series: [
      {
        barMaxWidth: 80,
        data: counts,
        type: 'bar',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: {
          width: 1,
        },
      },
      trigger: 'axis',
    },
    xAxis: {
      data: months,
      type: 'category',
    },
    yAxis: {
      max: Math.ceil(maxVal * 1.2),
      splitNumber: 4,
      type: 'value',
    },
  });
}

watch(
  () => [props.months, props.counts] as const,
  ([m, c]) => render(m ?? [], c ?? []),
  { immediate: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
