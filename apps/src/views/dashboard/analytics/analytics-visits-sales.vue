<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { TagDistributionItem } from '#/api/dashboard';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

const props = defineProps<{
  /** 问题标签分布数据 */
  data?: TagDistributionItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render(data: TagDistributionItem[] = []) {
  const roseData = data
    .map((item) => ({ name: item.tag, value: item.count }))
    .toSorted((a, b) => a.value - b.value);

  renderEcharts({
    series: [
      {
        animationDelay() {
          return Math.random() * 400;
        },
        animationEasing: 'exponentialInOut',
        animationType: 'scale',
        center: ['50%', '50%'],
        color: ['#5ab1ef', '#b6a2de', '#67e0e3', '#2ec7c9', '#e18525'],
        data: roseData,
        label: {
          formatter: '{b}: {d}%',
        },
        name: '问题标签',
        radius: '80%',
        roseType: 'radius',
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
