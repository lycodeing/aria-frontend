<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { EfficiencyTrendItem } from '#/api/dashboard';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { CHART_COLORS } from './chart-theme';
import { formatSeconds } from './format-seconds';

const props = defineProps<{
  /** 效率趋势数据（按天，区分三项指标） */
  data?: EfficiencyTrendItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render(data: EfficiencyTrendItem[] = []) {
  const dates = data.map((item) => item.date.slice(5)); // MM-DD
  const waitData = data.map((item) =>
    item.avgWaitSeconds > 0 ? item.avgWaitSeconds : null,
  );
  const handleData = data.map((item) =>
    item.avgHandleSeconds > 0 ? item.avgHandleSeconds : null,
  );
  const replyData = data.map((item) =>
    item.avgFirstReplySeconds > 0 ? item.avgFirstReplySeconds : null,
  );
  const allVals = [...waitData, ...handleData, ...replyData].filter(
    (v): v is number => v !== null,
  );
  const maxVal = Math.max(1, ...allVals);

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
      data: ['平均等待', '平均处理', '首次回复'],
    },
    series: [
      {
        areaStyle: { opacity: 0.1 },
        connectNulls: false,
        data: waitData,
        itemStyle: { color: CHART_COLORS.primary },
        name: '平均等待',
        smooth: true,
        type: 'line',
      },
      {
        areaStyle: { opacity: 0.1 },
        connectNulls: false,
        data: handleData,
        itemStyle: { color: CHART_COLORS.success },
        name: '平均处理',
        smooth: true,
        type: 'line',
      },
      {
        areaStyle: { opacity: 0.1 },
        connectNulls: false,
        data: replyData,
        itemStyle: { color: CHART_COLORS.purple },
        name: '首次回复',
        smooth: true,
        type: 'line',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: { color: CHART_COLORS.success, width: 1 },
      },
      formatter(params: any) {
        const items = Array.isArray(params) ? params : [params];
        const lines = items
          .filter((p: any) => p.value !== null && p.value !== undefined)
          .map(
            (p: any) =>
              `${p.marker}${p.seriesName}: ${formatSeconds(p.value as number)}`,
          );
        const axisValue = items[0]?.axisValue ?? '';
        return lines.length > 0
          ? `${axisValue}<br/>${lines.join('<br/>')}`
          : '';
      },
      trigger: 'axis',
    },
    xAxis: {
      axisTick: { show: false },
      boundaryGap: false,
      data: dates,
      splitLine: {
        lineStyle: { type: 'solid', width: 1 },
        show: true,
      },
      type: 'category',
    },
    yAxis: [
      {
        axisTick: { show: false },
        axisLabel: {
          formatter: (val: number) => formatSeconds(val),
        },
        max: Math.ceil(maxVal * 1.2),
        splitArea: { show: true },
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
