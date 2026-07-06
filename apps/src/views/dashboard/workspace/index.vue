<script lang="ts" setup>
import type {
  WorkbenchProjectItem,
  WorkbenchQuickNavItem,
  WorkbenchTodoItem,
  WorkbenchTrendItem,
} from '@vben/common-ui';

import type {
  AgentWorkloadItem,
  RecentSessionItem,
  StatusDistributionItem,
} from '#/api/dashboard';

import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  AnalysisChartCard,
  WorkbenchHeader,
  WorkbenchProject,
  WorkbenchQuickNav,
  WorkbenchTodo,
  WorkbenchTrends,
} from '@vben/common-ui';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';
import { openWindow } from '@vben/utils';

import {
  getAgentWorkloadApi,
  getRecentSessionsApi,
  getStatusDistributionApi,
} from '#/api/dashboard';

import AnalyticsVisitsSource from '../analytics/analytics-visits-source.vue';

const userStore = useUserStore();

// 座席工作量 → 项目卡片（动态加载）
const projectItems = ref<WorkbenchProjectItem[]>([]);

// 快捷导航（静态）
const quickNavItems: WorkbenchQuickNavItem[] = [
  {
    color: '#1fdaca',
    icon: 'ion:home-outline',
    title: '首页',
    url: '/',
  },
  {
    color: '#bf0c2c',
    icon: 'ion:grid-outline',
    title: '仪表盘',
    url: '/dashboard',
  },
  {
    color: '#e18525',
    icon: 'ion:layers-outline',
    title: '组件',
    url: '/demos/features/icons',
  },
  {
    color: '#3fb27f',
    icon: 'ion:settings-outline',
    title: '系统管理',
    url: '/demos/features/login-expired',
  },
  {
    color: '#4daf1bc9',
    icon: 'ion:key-outline',
    title: '权限管理',
    url: '/demos/access/page-control',
  },
  {
    color: '#00d8ff',
    icon: 'ion:bar-chart-outline',
    title: '图表',
    url: '/analytics',
  },
];

// 待办事项 → 等待接入的会话（动态加载）
const todoItems = ref<WorkbenchTodoItem[]>([]);

// 最新动态 → 最近会话（动态加载）
const trendItems = ref<WorkbenchTrendItem[]>([]);

// 会话状态分布
const statusDistribution = ref<StatusDistributionItem[]>([]);

// 座席卡片颜色与图标循环
const agentColors = [
  '#1fdaca',
  '#bf0c2c',
  '#e18525',
  '#3fb27f',
  '#00d8ff',
  '#EBD94E',
];
const agentIcons = [
  'ion:person-outline',
  'ion:headset-outline',
  'ion:people-outline',
  'ion:contact-outline',
  'ion:ribbon-outline',
  'ion:star-outline',
];

/** 格式化相对时间 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return dateStr.slice(0, 16).replace('T', ' ');
}

onMounted(async () => {
  // 并行获取 Dashboard 数据
  const [workload, recentSessions, statusDist] = await Promise.all([
    getAgentWorkloadApi(),
    getRecentSessionsApi(10),
    getStatusDistributionApi(),
  ]);

  // 座席工作量 → 项目卡片
  projectItems.value = workload.map(
    (item: AgentWorkloadItem, index: number) => ({
      color: agentColors[index % agentColors.length] ?? '',
      content: `总会话 ${item.totalSessions} 场，活跃 ${item.activeSessions} 场`,
      date: '实时统计',
      group: '座席工作量',
      icon: agentIcons[index % agentIcons.length] ?? 'ion:person-outline',
      title: `座席 ${item.agentId}`,
    }),
  );

  // 最近会话 → 最新动态
  trendItems.value = recentSessions.map((item: RecentSessionItem) => ({
    avatar: 'svg:avatar-1',
    content: `发起了会话，标签：<a>${item.tag ?? '未标记'}</a>，消息数 ${item.messageCount}`,
    date: formatRelativeTime(item.startedAt),
    title: item.visitorName || '匿名访客',
  }));

  // 等待接入的会话 → 待办事项
  todoItems.value = recentSessions
    .filter((item) => item.status === 'WAITING')
    .map((item) => ({
      completed: false,
      content: `访客 ${item.visitorName || '匿名'} 等待接入，标签：${item.tag ?? '未标记'}`,
      date: formatRelativeTime(item.startedAt),
      title: '等待接入',
    }));

  statusDistribution.value = statusDist;
});

const router = useRouter();

function navTo(nav: WorkbenchProjectItem | WorkbenchQuickNavItem) {
  if (nav.url?.startsWith('http')) {
    openWindow(nav.url);
    return;
  }
  if (nav.url?.startsWith('/')) {
    router.push(nav.url).catch((error) => {
      console.error('Navigation failed:', error);
    });
  } else {
    console.warn(`Unknown URL for navigation item: ${nav.title} -> ${nav.url}`);
  }
}
</script>

<template>
  <div class="p-5">
    <WorkbenchHeader
      :avatar="userStore.userInfo?.avatar || preferences.app.defaultAvatar"
    >
      <template #title>
        早安, {{ userStore.userInfo?.realName }}, 开始您一天的工作吧！
      </template>
      <template #description> 今日晴，20℃ - 32℃！ </template>
    </WorkbenchHeader>

    <div class="flex flex-col lg:flex-row">
      <div class="mr-4 w-full lg:w-3/5">
        <WorkbenchProject
          :items="projectItems"
          title="座席工作量"
          @click="navTo"
        />
        <WorkbenchTrends :items="trendItems" class="mt-5" title="最近会话" />
      </div>
      <div class="w-full lg:w-2/5">
        <WorkbenchQuickNav
          :items="quickNavItems"
          class="lg:mt-0"
          title="快捷导航"
          @click="navTo"
        />
        <WorkbenchTodo :items="todoItems" class="mt-5" title="待办事项" />
        <AnalysisChartCard class="mt-5" title="会话状态分布">
          <AnalyticsVisitsSource :data="statusDistribution" />
        </AnalysisChartCard>
      </div>
    </div>
  </div>
</template>
