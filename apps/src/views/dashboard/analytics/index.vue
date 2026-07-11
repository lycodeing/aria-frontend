<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui';
import type { TabOption } from '@vben/types';

import type {
  ConversationTrendItem,
  DashboardOverviewData,
  EfficiencyTrendItem,
  StatusDistributionItem,
  TagDistributionItem,
  TimeRange,
} from '#/api/dashboard';

import { computed, onMounted, ref, watch } from 'vue';

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

import { message } from 'ant-design-vue';

import {
  getConversationTrendsApi,
  getDashboardOverviewApi,
  getEfficiencyTrendsApi,
  getMessageTrendsApi,
  getStatusDistributionApi,
  getTagDistributionApi,
} from '#/api/dashboard';

import AnalyticsEfficiencyTrends from './analytics-efficiency-trends.vue';
import AnalyticsTrends from './analytics-trends.vue';
import AnalyticsVisitsData from './analytics-visits-data.vue';
import AnalyticsVisitsSales from './analytics-visits-sales.vue';
import AnalyticsVisitsSource from './analytics-visits-source.vue';
import AnalyticsVisits from './analytics-visits.vue';
import DashboardTimeRangeSelector from './dashboard-time-range-selector.vue';
import EfficiencyStatCard from './efficiency-stat-card.vue';
import { formatSeconds } from './format-seconds';

// ─── 时间范围 ─────────────────────────────────────────────────────────────────
const selectedRange = ref<TimeRange>('month');

// ─── 概览卡片（响应式，初始空数据，API 返回后更新） ────────────────────────────
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
  { label: '会话趋势', value: 'trends' },
  { label: '月消息量', value: 'visits' },
  { label: '效率趋势', value: 'efficiency' },
];

// ─── 图表数据（响应式） ────────────────────────────────────────────────────────
const overviewData = ref<DashboardOverviewData>();
const conversationTrends = ref<ConversationTrendItem[]>([]);
const messageTrends = ref<ConversationTrendItem[]>([]);
const efficiencyTrends = ref<EfficiencyTrendItem[]>([]);
const statusDistribution = ref<StatusDistributionItem[]>([]);
const tagDistribution = ref<TagDistributionItem[]>([]);

// ─── 效率均值卡片（computed，随 overviewData 变化） ────────────────────────────
const efficiencyCards = computed(() => [
  {
    title: '平均等待时长',
    value: formatSeconds(overviewData.value?.avgWaitSeconds ?? 0),
  },
  {
    title: '平均处理时长',
    value: formatSeconds(overviewData.value?.avgHandleSeconds ?? 0),
  },
  {
    title: '首次回复时长',
    value: formatSeconds(overviewData.value?.avgFirstReplySeconds ?? 0),
  },
]);

// ─── 请求竞态保护 ──────────────────────────────────────────────────────────────
let latestRequestId = 0;

function updateOverviewItems(data: DashboardOverviewData) {
  overviewItems.value = [
    {
      icon: SvgCardIcon,
      title: '今日会话量',
      totalTitle: '总会话量',
      totalValue: data.totalConversationCount,
      value: data.todayConversationCount,
    },
    {
      icon: SvgCakeIcon,
      title: '活跃会话',
      totalTitle: '等待接入',
      totalValue: data.waitingConversationCount,
      value: data.activeConversationCount,
    },
    {
      icon: SvgDownloadIcon,
      title: '总消息数',
      totalTitle: 'AI 回复',
      totalValue: data.aiMessageCount,
      value: data.totalMessageCount,
    },
    {
      icon: SvgBellIcon,
      title: '总用户数',
      totalTitle: '人工回复',
      totalValue: data.agentMessageCount,
      value: data.totalUserCount,
    },
  ];
}

async function fetchTrendData(range: TimeRange) {
  const id = ++latestRequestId;
  try {
    const [convTrends, msgTrends, effTrends, overview] = await Promise.all([
      getConversationTrendsApi(range),
      getMessageTrendsApi(range),
      getEfficiencyTrendsApi(range),
      getDashboardOverviewApi(),
    ]);
    if (id !== latestRequestId) return; // 丢弃过期请求
    conversationTrends.value = convTrends;
    messageTrends.value = msgTrends;
    efficiencyTrends.value = effTrends;
    overviewData.value = overview;
    updateOverviewItems(overview);
  } catch {
    if (id !== latestRequestId) return;
    message.error('数据加载失败，请重试');
    conversationTrends.value = [];
    messageTrends.value = [];
    efficiencyTrends.value = [];
  }
}

// 切换时间范围时刷新趋势数据
watch(selectedRange, (range) => {
  fetchTrendData(range);
});

onMounted(async () => {
  // 快照数据只加载一次（不受时间范围影响）
  const [statusDist, tagDist] = await Promise.all([
    getStatusDistributionApi(),
    getTagDistributionApi(),
  ]);
  statusDistribution.value = statusDist;
  tagDistribution.value = tagDist;

  // 趋势数据按默认时间范围加载
  await fetchTrendData('month');
});
</script>

<template>
  <div class="p-5">
    <!-- 顶部：标题 + 时间范围选择器 -->
    <div class="mb-4 flex items-center justify-between">
      <span class="text-lg font-semibold">分析概览</span>
      <DashboardTimeRangeSelector v-model="selectedRange" />
    </div>

    <!-- 概览指标卡片 -->
    <AnalysisOverview :items="overviewItems" />

    <!-- 效率均值卡片行 -->
    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <EfficiencyStatCard
        v-for="card in efficiencyCards"
        :key="card.title"
        :title="card.title"
        :value="card.value"
      />
    </div>

    <!-- 趋势图 Tab -->
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
      <template #efficiency>
        <AnalyticsEfficiencyTrends :data="efficiencyTrends" />
      </template>
    </AnalysisChartsTabs>

    <!-- 底部三图卡片（不受时间范围影响） -->
    <div class="mt-5 w-full md:flex">
      <AnalysisChartCard class="mt-5 md:mr-4 md:mt-0 md:w-1/3" title="指标雷达">
        <AnalyticsVisitsData :data="overviewData" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mr-4 md:mt-0 md:w-1/3" title="会话状态">
        <AnalyticsVisitsSource :data="statusDistribution" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:w-1/3" title="问题标签">
        <AnalyticsVisitsSales :data="tagDistribution" />
      </AnalysisChartCard>
    </div>
  </div>
</template>
