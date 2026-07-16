<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui';
import type { TabOption } from '@vben/types';

import type {
  CsatByAgentItem,
  CsatDistributionItem,
  CsatOverviewData,
  CsatTrendItem,
} from '#/api/csat';
import type {
  ComplexityDistributionItem,
  ComplexityItem,
  ComplexityLevel,
  ConversationTrendItem,
  DashboardOverviewData,
  EfficiencyTrendItem,
  RecentSessionItem,
  StatusDistributionItem,
  TagDistributionItem,
  TimeRange,
} from '#/api/dashboard';

import { computed, markRaw, onMounted, ref, watch } from 'vue';

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

import { Icon } from '@iconify/vue';
import { message } from 'ant-design-vue';

import {
  getCsatByAgentApi,
  getCsatDistributionApi,
  getCsatOverviewApi,
  getCsatTrendApi,
} from '#/api/csat';
import {
  getComplexityDistributionApi,
  getConversationTrendsApi,
  getDashboardOverviewApi,
  getEfficiencyTrendsApi,
  getMessageTrendsApi,
  getRecentSessionsApi,
  getStatusDistributionApi,
  getTagDistributionApi,
} from '#/api/dashboard';

import AnalyticsEfficiencyTrends from './analytics-efficiency-trends.vue';
import AnalyticsTrends from './analytics-trends.vue';
import AnalyticsVisitsData from './analytics-visits-data.vue';
import AnalyticsVisitsSales from './analytics-visits-sales.vue';
import AnalyticsVisitsSource from './analytics-visits-source.vue';
import AnalyticsVisits from './analytics-visits.vue';
import AvgHandleTimeCard from './avg-handle-time-card.vue';
import ComplexityTrendCard from './complexity-trend-card.vue';
import CsatByAgentCard from './csat-by-agent-card.vue';
import CsatDistributionCard from './csat-distribution-card.vue';
import CsatStatCards from './csat-stat-cards.vue';
import CsatTrendCard from './csat-trend-card.vue';
import DashboardTimeRangeSelector from './dashboard-time-range-selector.vue';
import PendingTicketsCard from './pending-tickets-card.vue';

// ─── 时间范围 ─────────────────────────────────────────────────────────────────
const selectedRange = ref<TimeRange>('month');

// ─── 概览卡片（响应式，初始空数据，API 返回后更新） ────────────────────────────
// icon 用 markRaw 避免 Vue 深度代理 Component 对象，防止 "reactive Component" 警告
const overviewItems = ref<AnalysisOverviewItem[]>([
  {
    icon: markRaw(SvgCardIcon),
    title: '今日会话量',
    totalTitle: '总会话量',
    totalValue: 0,
    value: 0,
  },
  {
    icon: markRaw(SvgCakeIcon),
    title: '活跃会话',
    totalTitle: '等待接入',
    totalValue: 0,
    value: 0,
  },
  {
    icon: markRaw(SvgDownloadIcon),
    title: '总消息数',
    totalTitle: 'AI 回复',
    totalValue: 0,
    value: 0,
  },
  {
    icon: markRaw(SvgBellIcon),
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
const recentSessions = ref<RecentSessionItem[]>([]);

// ─── 复杂度分布（快照数据，独立加载） ──────────────────────────────────────────
const complexityData = ref<ComplexityDistributionItem[]>([]);

// 复杂度等级 → 中文标签 + 语义色（与设计稿一致）
const COMPLEXITY_META: Record<
  ComplexityLevel,
  { color: string; label: string }
> = {
  SIMPLE: { label: '简单问题', color: 'bg-[#10B981]' },
  MEDIUM: { label: '中等问题', color: 'bg-[#F59E0B]' },
  COMPLEX: { label: '复杂问题', color: 'bg-[#EF4444]' },
};

// 后端 level 映射为卡片需要的 { label, color, percent }
const complexityRows = computed<ComplexityItem[]>(() =>
  complexityData.value.map((item) => ({
    label: COMPLEXITY_META[item.level].label,
    color: COMPLEXITY_META[item.level].color,
    percent: item.percent,
  })),
);

// ─── CSAT 满意度评价数据 ───────────────────────────────────────────────────────
const csatOverview = ref<CsatOverviewData>({
  csatAvgScore: 0,
  csatResponseRate: 0,
  csatRatedCount: 0,
});
const csatTrend = ref<CsatTrendItem[]>([]);
const csatDistribution = ref<CsatDistributionItem[]>([]);
const csatByAgent = ref<CsatByAgentItem[]>([]);

// ─── 请求竞态保护 ──────────────────────────────────────────────────────────────
let latestRequestId = 0;

function updateOverviewItems(data: DashboardOverviewData) {
  // Number() 强制转换，防止 API 返回字符串数字（如 "64"）传入 VbenCountToAnimator；
  // ?? 0 兜底 undefined/null，useTransition 要求 endVal 必须是 number。
  // markRaw 防止 Vue 深度代理 Component 对象，避免 "reactive Component" 警告。
  overviewItems.value = [
    {
      icon: markRaw(SvgCardIcon),
      title: '今日会话量',
      totalTitle: '总会话量',
      totalValue: Number(data.totalConversationCount ?? 0),
      value: Number(data.todayConversationCount ?? 0),
    },
    {
      icon: markRaw(SvgCakeIcon),
      title: '活跃会话',
      totalTitle: '等待接入',
      totalValue: Number(data.waitingConversationCount ?? 0),
      value: Number(data.activeConversationCount ?? 0),
    },
    {
      icon: markRaw(SvgDownloadIcon),
      title: '总消息数',
      totalTitle: 'AI 回复',
      totalValue: Number(data.aiMessageCount ?? 0),
      value: Number(data.totalMessageCount ?? 0),
    },
    {
      icon: markRaw(SvgBellIcon),
      title: '总用户数',
      totalTitle: '人工回复',
      totalValue: Number(data.agentMessageCount ?? 0),
      value: Number(data.totalUserCount ?? 0),
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
    // CSAT 趋势随同一时间范围刷新
    csatTrend.value = await getCsatTrendApi(range);
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
  const [statusDist, tagDist, recent] = await Promise.all([
    getStatusDistributionApi(),
    getTagDistributionApi(),
    getRecentSessionsApi(),
  ]);
  statusDistribution.value = statusDist;
  tagDistribution.value = tagDist;
  recentSessions.value = recent;

  // 复杂度分布：独立加载，失败不影响其他快照（卡片回退占位数据）
  try {
    complexityData.value = await getComplexityDistributionApi();
  } catch {
    complexityData.value = [];
  }

  // CSAT 满意度评价快照数据（不受时间范围影响），失败不影响其他卡片
  try {
    const [overview, distribution, byAgent] = await Promise.all([
      getCsatOverviewApi(),
      getCsatDistributionApi(),
      getCsatByAgentApi(),
    ]);
    csatOverview.value = overview;
    csatDistribution.value = distribution;
    csatByAgent.value = byAgent;
  } catch {
    /* 保留默认值，卡片显示空态 */
  }

  // 趋势数据按默认时间范围加载
  await fetchTrendData('month');
});
</script>

<template>
  <div class="p-6">
    <!-- 顶部：标题 + 时间范围选择器 -->
    <div class="mb-4 flex items-center justify-between">
      <span class="text-lg font-semibold">分析概览</span>
      <DashboardTimeRangeSelector v-model="selectedRange" />
    </div>

    <!-- 概览指标卡片 -->
    <AnalysisOverview :items="overviewItems" />

    <!-- CSAT 满意度评价区块 -->
    <div class="mt-5">
      <div class="mb-3 flex items-center gap-2">
        <Icon icon="lucide:star" class="text-lg" style="color: #4f46e5" />
        <span class="text-base font-semibold">满意度评价 (CSAT)</span>
      </div>

      <!-- 概览指标卡 -->
      <CsatStatCards
        :avg-score="csatOverview.csatAvgScore"
        :rated-count="csatOverview.csatRatedCount"
        :response-rate="csatOverview.csatResponseRate"
      />

      <!-- 趋势 + 分布 + 分坐席 -->
      <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <AnalysisChartCard class="shadow-sm" title="评分趋势">
          <CsatTrendCard :data="csatTrend" />
        </AnalysisChartCard>
        <AnalysisChartCard class="shadow-sm" title="星级分布">
          <CsatDistributionCard :data="csatDistribution" />
        </AnalysisChartCard>
        <AnalysisChartCard class="shadow-sm" title="分坐席评分">
          <CsatByAgentCard :data="csatByAgent" />
        </AnalysisChartCard>
      </div>
    </div>

    <!-- 中间行：待处理列表 + 平均处理时长 + 复杂度趋势（设计稿版） -->
    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <PendingTicketsCard :items="recentSessions" />
      <AvgHandleTimeCard
        :seconds="Number(overviewData?.avgHandleSeconds ?? 0)"
      />
      <ComplexityTrendCard :distribution="complexityRows" />
    </div>

    <!-- 趋势图 Tab -->
    <AnalysisChartsTabs :tabs="chartTabs" class="mt-5 shadow-sm">
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
    <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
      <AnalysisChartCard class="shadow-sm" title="指标雷达">
        <AnalyticsVisitsData :data="overviewData" />
      </AnalysisChartCard>
      <AnalysisChartCard class="shadow-sm" title="会话状态">
        <AnalyticsVisitsSource :data="statusDistribution" />
      </AnalysisChartCard>
      <AnalysisChartCard class="shadow-sm" title="问题标签">
        <AnalyticsVisitsSales :data="tagDistribution" />
      </AnalysisChartCard>
    </div>
  </div>
</template>
