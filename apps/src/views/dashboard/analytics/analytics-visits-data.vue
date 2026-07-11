<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { DashboardOverviewData } from '#/api/dashboard';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { CHART_COLORS } from './chart-theme';

const props = defineProps<{
  /** 概览指标数据 */
  data?: DashboardOverviewData;
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render(data: DashboardOverviewData | undefined) {
  if (!data) return;

  // 将各指标归一化到 0-100 区间，用于雷达图展示
  const total = Math.max(1, data.totalConversationCount);
  const todayConv = Math.round((data.todayConversationCount / total) * 100);
  const activeConv = Math.round((data.activeConversationCount / total) * 100);
  const waitingConv = Math.round((data.waitingConversationCount / total) * 100);
  const totalMsg = Math.max(1, data.totalMessageCount);
  const aiMsg = Math.round((data.aiMessageCount / totalMsg) * 100);
  const agentMsg = Math.round((data.agentMessageCount / totalMsg) * 100);

  renderEcharts({
    legend: {
      bottom: 0,
      data: ['占比'],
    },
    radar: {
      indicator: [
        { max: 100, name: '今日会话' },
        { max: 100, name: '活跃会话' },
        { max: 100, name: '等待会话' },
        { max: 100, name: 'AI回复' },
        { max: 100, name: '人工回复' },
        { max: 100, name: '总用户' },
      ],
      radius: '60%',
      splitNumber: 5,
    },
    series: [
      {
        areaStyle: {
          opacity: 1,
          shadowBlur: 0,
          shadowColor: 'rgba(0,0,0,.2)',
          shadowOffsetX: 0,
          shadowOffsetY: 10,
        },
        data: [
          {
            itemStyle: {
              color: CHART_COLORS.primary,
            },
            name: '占比',
            value: [todayConv, activeConv, waitingConv, aiMsg, agentMsg, 100],
          },
        ],
        itemStyle: {
          borderRadius: 10,
          borderWidth: 2,
        },
        symbolSize: 0,
        type: 'radar',
      },
    ],
    tooltip: {},
  });
}

watch(
  () => props.data,
  (val) => render(val),
  { immediate: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
