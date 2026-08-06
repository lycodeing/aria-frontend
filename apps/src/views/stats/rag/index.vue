<script lang="ts" setup>
import type { RagStats, StatsPeriod } from '#/api/stats';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { message, Table } from 'ant-design-vue';

import { getRagStatsApi } from '#/api/stats';

import PeriodTabs from '../shared/PeriodTabs.vue';
import StatCard from '../shared/StatCard.vue';

const period = ref<StatsPeriod>('7d');
const loading = ref(false);
const data = ref<null | RagStats>(null);

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

const columns = [
  { title: '排名', key: 'rank', width: 70 },
  { title: '未命中查询', dataIndex: 'query_text', key: 'query_text' },
  {
    title: '未命中次数',
    dataIndex: 'miss_count',
    key: 'miss_count',
    width: 120,
    align: 'right' as const,
  },
];

async function load() {
  loading.value = true;
  try {
    data.value = await getRagStatsApi(period.value);
  } catch {
    message.error('RAG 质量统计加载失败，请重试');
  } finally {
    loading.value = false;
  }
}

function onPeriodChange(p: StatsPeriod) {
  period.value = p;
  load();
}

onMounted(load);
</script>

<template>
  <Page>
    <div
      class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
    >
      <PeriodTabs :value="period" @update:value="onPeriodChange" />
    </div>

    <div class="mb-3 grid grid-cols-4 gap-3">
      <StatCard
        icon="lucide:search"
        label="总检索数"
        tone="blue"
        :value="data?.totalSearches ?? 0"
      />
      <StatCard
        icon="lucide:search-x"
        label="未命中数"
        tone="red"
        :value="data?.missCount ?? 0"
      />
      <StatCard
        icon="lucide:percent"
        label="未命中率"
        tone="amber"
        :value="data ? pct(data.missRate) : '—'"
      />
      <StatCard
        icon="lucide:target"
        label="Top1 平均分"
        tone="emerald"
        :value="data?.avgTop1Score ?? '—'"
      />
    </div>

    <div
      class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    >
      <div
        class="border-b border-slate-100 px-4 py-2.5 text-[13px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
      >
        未命中查询榜（Top 20）
      </div>
      <Table
        :columns="columns"
        :data-source="data?.topMissQueries ?? []"
        :loading="loading"
        row-key="query_text"
        size="small"
        :pagination="false"
      >
        <template #bodyCell="{ column, index }">
          <template v-if="column.key === 'rank'">
            <span class="text-[13px] font-medium text-slate-500">{{
              index + 1
            }}</span>
          </template>
        </template>
      </Table>
    </div>
  </Page>
</template>
