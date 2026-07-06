<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { StatusDistributionItem } from '#/api/dashboard';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  /** 会话状态分布数据 */
  data?: StatusDistributionItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

/** 状态中文映射 */
const statusLabelMap: Record<string, string> = {
  WAITING: '等待中',
  ACTIVE: '接待中',
  CLOSED: '已结束',
};

function render(data: StatusDistributionItem[] = []) {
  const pieData = data.map((item) => ({
    name: statusLabelMap[item.status] ?? item.status,
    value: item.count,
  }));

  renderEcharts({
    legend: {
      bottom: '2%',
      left: 'center',
    },
    series: [
      {
        animationDelay() {
          return Math.random() * 100;
        },
        animationEasing: 'exponentialInOut',
        animationType: 'scale',
        avoidLabelOverlap: false,
        color: ['#5ab1ef', '#b6a2de', '#67e0e3', '#2ec7c9'],
        data: pieData,
        emphasis: {
          label: {
            fontSize: '12',
            fontWeight: 'bold',
            show: true,
          },
        },
        itemStyle: {
          borderRadius: 10,
          borderWidth: 2,
        },
        label: {
          position: 'center',
          show: false,
        },
        labelLine: {
          show: false,
        },
        name: '会话状态',
        radius: ['40%', '65%'],
        type: 'pie',
      },
    ],
    tooltip: {
      trigger: 'item',
    },
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
