<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { LlmCostStats, StatsPeriod } from '#/api/stats';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { Button, Input, message, Table } from 'ant-design-vue';

import { getLlmCostStatsApi } from '#/api/stats';
import { CHART_PALETTE } from '#/views/dashboard/analytics/chart-theme';

import PeriodTabs from '../shared/PeriodTabs.vue';
import StatCard from '../shared/StatCard.vue';

const period = ref<StatsPeriod>('today');
const modelName = ref('');
const loading = ref(false);
const data = ref<LlmCostStats | null>(null);

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

const callTypeColumns = [
  { title: '调用类型', dataIndex: 'call_type', key: 'call_type' },
  {
    title: 'Token 总数',
    dataIndex: 'total_tokens',
    key: 'total_tokens',
    align: 'right' as const,
  },
];

function renderByModel(d: LlmCostStats) {
  renderEcharts({
    color: CHART_PALETTE,
    grid: {
      bottom: 20,
      containLabel: true,
      left: '2%',
      right: '3%',
      top: '8%',
    },
    series: [
      {
        barWidth: 32,
        data: d.byModel.map((m) => m.total_tokens),
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        type: 'bar',
      },
    ],
    tooltip: { trigger: 'axis' },
    xAxis: { data: d.byModel.map((m) => m.model_name), type: 'category' },
    yAxis: { name: 'Token 总数', type: 'value' },
  });
}

async function load() {
  loading.value = true;
  try {
    const res = await getLlmCostStatsApi(
      period.value,
      modelName.value.trim() || undefined,
    );
    data.value = res;
    renderByModel(res);
  } catch {
    message.error('LLM 成本统计加载失败，请重试');
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
      <div class="h-6 w-px bg-slate-200 dark:bg-slate-600"></div>
      <Input
        v-model:value="modelName"
        placeholder="模型名（可选，仅过滤总量）"
        allow-clear
        style="width: 240px"
        @press-enter="load"
      />
      <Button type="primary" :loading="loading" @click="load">查询</Button>
    </div>

    <div class="mb-3 grid grid-cols-4 gap-3">
      <StatCard
        icon="lucide:arrow-down-to-line"
        label="输入 Token"
        tone="blue"
        :value="data?.totalInputTokens ?? 0"
      />
      <StatCard
        icon="lucide:arrow-up-from-line"
        label="输出 Token"
        tone="violet"
        :value="data?.totalOutputTokens ?? 0"
      />
      <StatCard
        icon="lucide:coins"
        label="总 Token"
        tone="amber"
        :value="data?.totalTokens ?? 0"
      />
      <StatCard
        icon="lucide:phone-call"
        label="调用数 / 均值"
        tone="emerald"
        :value="`${data?.callCount ?? 0} / ${data?.avgTokensPerCall ?? 0}`"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div
        class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
      >
        <div
          class="mb-2 text-[13px] font-medium text-slate-700 dark:text-slate-200"
        >
          按模型 Token 消耗（全量，不受模型名过滤影响）
        </div>
        <EchartsUI ref="chartRef" style="height: 320px" />
      </div>
      <div
        class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      >
        <div
          class="border-b border-slate-100 px-4 py-2.5 text-[13px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          按调用类型 Token 消耗（全量）
        </div>
        <Table
          :columns="callTypeColumns"
          :data-source="data?.byCallType ?? []"
          :loading="loading"
          row-key="call_type"
          size="small"
          :pagination="false"
        />
      </div>
    </div>
  </Page>
</template>
