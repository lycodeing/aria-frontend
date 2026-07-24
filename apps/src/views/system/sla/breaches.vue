<script lang="ts" setup>
import type { SlaBreachListParams, SlaBreachVO } from '#/api/sla/index';

import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  DatePicker,
  Input,
  Select,
  SelectOption,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { listSlaBreachesApi } from '#/api/sla/index';

// ===== 筛选状态 =====
const filterSessionId = ref('');
const filterBreachType = ref<string | undefined>(undefined);
const filterStage = ref<string | undefined>(undefined);
const filterDateRange = ref<[dayjs.Dayjs, dayjs.Dayjs] | undefined>(undefined);

// ===== 分页状态 =====
const page = ref(1);
const pageSize = ref(20);

// ===== 列表状态 =====
const rawList = ref<SlaBreachVO[]>([]);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const params: SlaBreachListParams = {
      page: page.value,
      pageSize: pageSize.value,
    };
    if (filterSessionId.value) params.sessionId = filterSessionId.value;
    if (filterBreachType.value) params.breachType = filterBreachType.value;
    if (filterStage.value) params.stage = filterStage.value;
    if (filterDateRange.value) {
      params.startDate = filterDateRange.value[0].format('YYYY-MM-DD');
      params.endDate = filterDateRange.value[1].format('YYYY-MM-DD');
    }
    rawList.value = await listSlaBreachesApi(params);
  } catch {
    // silent — table shows empty
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  page.value = 1;
  loadList();
}

// stage is now passed to the API — rawList is the final display list
const list = rawList;

function onPageChange(p: number, ps: number) {
  page.value = p;
  pageSize.value = ps;
  loadList();
}

// ===== 表格列定义 =====
const columns = [
  { title: '会话ID', dataIndex: 'sessionId', key: 'sessionId', ellipsis: true },
  { title: '违规类型', key: 'breachType', width: 110 },
  { title: '阶段', key: 'stage', width: 90 },
  {
    title: '目标(秒)',
    dataIndex: 'targetSec',
    key: 'targetSec',
    width: 90,
    align: 'right' as const,
  },
  {
    title: '实际(秒)',
    dataIndex: 'actualSec',
    key: 'actualSec',
    width: 90,
    align: 'right' as const,
  },
  { title: '违规时间', dataIndex: 'breachAt', key: 'breachAt', width: 170 },
  {
    title: 'SSE告警时间',
    dataIndex: 'alertedAt',
    key: 'alertedAt',
    width: 170,
  },
];

const breachTypeLabel: Record<string, string> = {
  WAIT: '等待超时',
  FRT: '首响超时',
  HANDLE: '处理超时',
};

onMounted(loadList);
</script>

<template>
  <Page>
    <!-- 筛选栏 -->
    <Space wrap style="margin-bottom: 16px">
      <Input
        v-model:value="filterSessionId"
        placeholder="会话ID"
        allow-clear
        style="width: 200px"
        @press-enter="onSearch"
      />
      <Select
        v-model:value="filterBreachType"
        placeholder="违规类型"
        allow-clear
        style="width: 130px"
      >
        <SelectOption value="WAIT">等待超时</SelectOption>
        <SelectOption value="FRT">首响超时</SelectOption>
        <SelectOption value="HANDLE">处理超时</SelectOption>
      </Select>
      <Select
        v-model:value="filterStage"
        placeholder="阶段"
        allow-clear
        style="width: 110px"
      >
        <SelectOption value="">全部阶段</SelectOption>
        <SelectOption value="WARNING">预警</SelectOption>
        <SelectOption value="BREACH">违规</SelectOption>
      </Select>
      <DatePicker.RangePicker
        v-model:value="filterDateRange"
        format="YYYY-MM-DD"
        :allow-clear="true"
        style="width: 240px"
      />
      <Button type="primary" @click="onSearch">查询</Button>
    </Space>

    <Table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      row-key="id"
      bordered
      :pagination="{
        current: page,
        pageSize,
        showSizeChanger: true,
        onChange: onPageChange,
      }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'breachType'">
          {{
            breachTypeLabel[(record as SlaBreachVO).breachType] ??
            (record as SlaBreachVO).breachType
          }}
        </template>
        <template v-else-if="column.key === 'stage'">
          <Tag
            :color="(record as SlaBreachVO).stage === 'BREACH' ? 'red' : 'gold'"
          >
            {{ (record as SlaBreachVO).stage === 'BREACH' ? '违规' : '预警' }}
          </Tag>
        </template>
      </template>
    </Table>
  </Page>
</template>
