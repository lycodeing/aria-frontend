<script lang="ts" setup>
/**
 * CsatByAgentCard — 分坐席满意度评分表。
 *
 * 数据来自 GET /dashboard/csat-by-agent。按平均评分倒序（后端已排序）。
 */
import type { CsatByAgentItem } from '#/api/csat/types';

import { computed, h } from 'vue';

import { Table } from 'ant-design-vue';

const props = defineProps<{
  data?: CsatByAgentItem[];
}>();

interface Row {
  key: number;
  agentName: string;
  avgScore: number;
  ratedCount: number;
  color: string;
}

const rows = computed<Row[]>(() =>
  (props.data ?? []).map((i, idx) => {
    const score = Number(i.avgScore ?? 0);
    return {
      agentName: i.agentName || `坐席#${i.agentId ?? idx}`,
      avgScore: score,
      color: scoreColor(score),
      key: i.agentId ?? idx,
      ratedCount: i.ratedCount,
    };
  }),
);

const columns = [
  { dataIndex: 'agentName', key: 'agentName', title: '坐席' },
  {
    dataIndex: 'avgScore',
    key: 'avgScore',
    title: '平均评分',
    customRender: ({ text }: { text: number }) =>
      h(
        'span',
        { style: { color: scoreColor(text), fontWeight: 600 } },
        text.toFixed(2),
      ),
  },
  { dataIndex: 'ratedCount', key: 'ratedCount', title: '评价数' },
];

function scoreColor(score: number): string {
  if (score >= 4.5) return '#10B981';
  if (score >= 3.5) return '#3B82F6';
  if (score >= 2.5) return '#F59E0B';
  return '#EF4444';
}
</script>

<template>
  <Table
    :columns="columns"
    :data-source="rows"
    :pagination="false"
    size="small"
  />
</template>
