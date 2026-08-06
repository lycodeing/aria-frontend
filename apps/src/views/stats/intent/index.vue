<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { IntentStats, StatsPeriod } from '#/api/stats';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { Button, Input, message } from 'ant-design-vue';

import { getIntentStatsApi } from '#/api/stats';
import { CHART_COLORS } from '#/views/dashboard/analytics/chart-theme';

import PeriodTabs from '../shared/PeriodTabs.vue';
import StatCard from '../shared/StatCard.vue';

const period = ref<StatsPeriod>('today');
const domainCode = ref('');
const loading = ref(false);
const data = ref<IntentStats | null>(null);

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

/** 0-1 → 百分比字符串 */
function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function renderLatency(d: IntentStats) {
  const rows: { name: string; value: number }[] = [];
  const src = d.avgLatencyMs;
  if (src.RULE !== null) rows.push({ name: 'RULE', value: src.RULE });
  if (src.EMBEDDING !== null)
    rows.push({ name: 'EMBEDDING', value: src.EMBEDDING });
  if (src.LLM !== null) rows.push({ name: 'LLM', value: src.LLM });

  renderEcharts({
    grid: {
      bottom: 20,
      containLabel: true,
      left: '2%',
      right: '3%',
      top: '8%',
    },
    series: [
      {
        barWidth: 36,
        data: rows.map((r) => r.value),
        itemStyle: { borderRadius: [4, 4, 0, 0], color: CHART_COLORS.primary },
        type: 'bar',
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v} ms` },
    xAxis: { data: rows.map((r) => r.name), type: 'category' },
    yAxis: { name: '平均延迟 (ms)', type: 'value' },
  });
}

async function load() {
  loading.value = true;
  try {
    const res = await getIntentStatsApi(
      period.value,
      domainCode.value.trim() || undefined,
    );
    data.value = res;
    renderLatency(res);
  } catch {
    message.error('意图分类统计加载失败，请重试');
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
    <!-- 筛选栏 -->
    <div
      class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
    >
      <PeriodTabs :value="period" @update:value="onPeriodChange" />
      <div class="h-6 w-px bg-slate-200 dark:bg-slate-600"></div>
      <Input
        v-model:value="domainCode"
        placeholder="领域编码（可选）"
        allow-clear
        style="width: 200px"
        @press-enter="load"
      />
      <Button type="primary" :loading="loading" @click="load">查询</Button>
    </div>

    <!-- 概览卡片 -->
    <div class="mb-3 grid grid-cols-4 gap-3">
      <StatCard
        icon="lucide:list-checks"
        label="总分类数"
        tone="blue"
        :value="data?.totalClassifications ?? 0"
      />
      <StatCard
        icon="lucide:filter"
        label="Tier1 规则命中率"
        tone="emerald"
        :value="data ? pct(data.tier1HitRate) : '—'"
      />
      <StatCard
        icon="lucide:sparkles"
        label="Tier2 向量命中率"
        tone="violet"
        :value="data ? pct(data.tier2HitRate) : '—'"
      />
      <StatCard
        icon="lucide:brain"
        label="Tier3 大模型触发率"
        tone="amber"
        :value="data ? pct(data.tier3TriggerRate) : '—'"
      />
    </div>

    <!-- 延迟图表 -->
    <div
      class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
    >
      <div
        class="mb-2 text-[13px] font-medium text-slate-700 dark:text-slate-200"
      >
        各层平均延迟
      </div>
      <EchartsUI ref="chartRef" style="height: 320px" />
    </div>
  </Page>
</template>
