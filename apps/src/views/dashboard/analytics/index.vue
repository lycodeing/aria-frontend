<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui';
import type { TabOption } from '@vben/types';

import type {
  ConversationTrendItem,
  DashboardOverviewData,
  StatusDistributionItem,
  TagDistributionItem,
} from '#/api/dashboard';

import { onMounted, ref } from 'vue';

import {
  AnalysisChartCard,
  AnalysisChartsTabs,
  AnalysisOverview,
} from '@vben/common-ui';
import {
  SvgBellIcon,
  SvgCakeIcon,
  SvgCardIcon,
  SvgDownloadIcon,
} from '@vben/icons';

import {
  getConversationTrendsApi,
  getDashboardOverviewApi,
  getMessageTrendsApi,
  getStatusDistributionApi,
  getTagDistributionApi,
} from '#/api/dashboard';

import AnalyticsTrends from './analytics-trends.vue';
import AnalyticsVisitsData from './analytics-visits-data.vue';
import AnalyticsVisitsSales from './analytics-visits-sales.vue';
import AnalyticsVisitsSource from './analytics-visits-source.vue';
import AnalyticsVisits from './analytics-visits.vue';

// 概览指标（响应式，初始空数据，API 返回后更新）
const overviewItems = ref<AnalysisOverviewItem[]>([
  {
    icon: SvgCardIcon,
    title: '今日会话量',
    totalTitle: '总会话量',
    totalValue: 0,
    value: 0,
  },
  {
    icon: SvgCakeIcon,
    title: '活跃会话',
    totalTitle: '等待接入',
    totalValue: 0,
    value: 0,
  },
  {
    icon: SvgDownloadIcon,
    title: '总消息数',
    totalTitle: 'AI 回复',
    totalValue: 0,
    value: 0,
  },
  {
    icon: SvgBellIcon,
    title: '总用户数',
    totalTitle: '人工回复',
    totalValue: 0,
    value: 0,
  },
]);

const chartTabs: TabOption[] = [
  {
    label: '会话趋势',
    value: 'trends',
  },
  {
    label: '月消息量',
    value: 'visits',
  },
];

// 图表数据（响应式）
const overviewData = ref<DashboardOverviewData>();
const conversationTrends = ref<ConversationTrendItem[]>([]);
const messageTrends = ref<ConversationTrendItem[]>([]);
const statusDistribution = ref<StatusDistributionItem[]>([]);
const tagDistribution = ref<TagDistributionItem[]>([]);

onMounted(async () => {
  // 并行获取所有 Dashboard 数据
  const [overview, convTrends, msgTrends, statusDist, tagDist] =
    await Promise.all([
      getDashboardOverviewApi(),
      getConversationTrendsApi(),
      getMessageTrendsApi(),
      getStatusDistributionApi(),
      getTagDistributionApi(),
    ]);

  // 更新概览卡片
  overviewData.value = overview;
  overviewItems.value = [
    {
      icon: SvgCardIcon,
      title: '今日会话量',
      totalTitle: '总会话量',
      totalValue: overview.totalConversationCount,
      value: overview.todayConversationCount,
    },
    {
      icon: SvgCakeIcon,
      title: '活跃会话',
      totalTitle: '等待接入',
      totalValue: overview.waitingConversationCount,
      value: overview.activeConversationCount,
    },
    {
      icon: SvgDownloadIcon,
      title: '总消息数',
      totalTitle: 'AI 回复',
      totalValue: overview.aiMessageCount,
      value: overview.totalMessageCount,
    },
    {
      icon: SvgBellIcon,
      title: '总用户数',
      totalTitle: '人工回复',
      totalValue: overview.agentMessageCount,
      value: overview.totalUserCount,
    },
  ];

  // 更新图表数据
  conversationTrends.value = convTrends;
  messageTrends.value = msgTrends;
  statusDistribution.value = statusDist;
  tagDistribution.value = tagDist;
});
</script>

<template>
  <div class="p-5">
    <AnalysisOverview :items="overviewItems" />
    <AnalysisChartsTabs :tabs="chartTabs" class="mt-5">
      <template #trends>
        <AnalyticsTrends :data="conversationTrends" />
      </template>
      <template #visits>
        <AnalyticsVisits
          :counts="messageTrends.map((item) => item.aiCount + item.humanCount)"
          :months="messageTrends.map((item) => item.month)"
        />
      </template>
    </AnalysisChartsTabs>

    <div class="mt-5 w-full md:flex">
      <AnalysisChartCard class="mt-5 md:mt-0 md:mr-4 md:w-1/3" title="指标雷达">
        <AnalyticsVisitsData :data="overviewData" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:mr-4 md:w-1/3" title="会话状态">
        <AnalyticsVisitsSource :data="statusDistribution" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:w-1/3" title="问题标签">
        <AnalyticsVisitsSales :data="tagDistribution" />
      </AnalysisChartCard>
    </div>
  </div>
</template>
