<script lang="ts" setup>
import type {
  AgentOption,
  SessionQueryParams,
  SessionRecord,
} from '#/api/session/index';

import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
  DatePicker,
  message,
  Select,
  SelectOption,
  Table,
  Tag,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { listAgentOptionsApi, querySessionsApi } from '#/api/session/index';

import SessionDetailDrawer from './components/SessionDetailDrawer.vue';
import {
  CLOSED_BY_MAP,
  durationTagColor,
  formatDuration,
  formatTime,
  STATUS_MAP,
  tagColor,
} from './constants';

// ===== 筛选状态 =====
const keyword = ref('');
const statusFilter = ref<string | undefined>(undefined);
const closedByFilter = ref<string | undefined>(undefined);
const dateRange = ref<[dayjs.Dayjs, dayjs.Dayjs] | undefined>(undefined);
const agentIds = ref<string[]>([]); // 客服多选

// ===== 客服选项 =====
const agentOptions = ref<AgentOption[]>([]);
const agentSearchLoading = ref(false);
let agentSearchTimer: null | ReturnType<typeof setTimeout> = null;

async function loadAgentOptions(keyword2 = '') {
  agentSearchLoading.value = true;
  try {
    agentOptions.value = await listAgentOptionsApi(keyword2);
  } catch {
    message.error('客服列表加载失败，请重试');
  } finally {
    agentSearchLoading.value = false;
  }
}

function onAgentSearch(val: string) {
  if (agentSearchTimer) clearTimeout(agentSearchTimer);
  agentSearchTimer = setTimeout(() => loadAgentOptions(val), 300);
}

// 时间快捷按钮
type TimePreset = '7d' | '30d' | '' | 'today' | 'yesterday';
const timePreset = ref<TimePreset>('7d');

function applyTimePreset(preset: TimePreset) {
  timePreset.value = preset;
  const now = dayjs();
  switch (preset) {
    case '7d': {
      dateRange.value = [
        now.subtract(6, 'day').startOf('day'),
        now.endOf('day'),
      ];
      break;
    }
    case '30d': {
      dateRange.value = [
        now.subtract(29, 'day').startOf('day'),
        now.endOf('day'),
      ];
      break;
    }
    case 'today': {
      dateRange.value = [now.startOf('day'), now.endOf('day')];
      break;
    }
    case 'yesterday': {
      const y = now.subtract(1, 'day');
      dateRange.value = [y.startOf('day'), y.endOf('day')];
      break;
    }
    default: {
      dateRange.value = undefined;
    }
  }
}

// ===== 分页状态 =====
const page = ref(0); // 0-based
const pageSize = ref(20);
const total = ref(0);

// ===== 列表状态 =====
const list = ref<SessionRecord[]>([]);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const params: SessionQueryParams = {
      page: page.value,
      size: pageSize.value,
    };
    if (keyword.value.trim()) params.keyword = keyword.value.trim();
    if (statusFilter.value) params.status = statusFilter.value;
    if (closedByFilter.value) params.closedBy = closedByFilter.value;
    if (agentIds.value.length > 0) params.agentIds = agentIds.value.join(',');
    if (dateRange.value) {
      params.startDate = dateRange.value[0].format('YYYY-MM-DD');
      params.endDate = dateRange.value[1].format('YYYY-MM-DD');
    }
    const res = await querySessionsApi(params);
    list.value = res.items;
    total.value = Number(res.total);
  } catch {
    message.error('会话查询失败，请重试');
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  page.value = 0;
  loadList();
}

function onPageChange(p: number, ps: number) {
  page.value = p - 1; // antd 1-based → API 0-based
  pageSize.value = ps;
  loadList();
}

// ===== 统计概览 =====
const stats = computed(() => {
  const items = list.value;
  const closedItems = items.filter(
    (i) => i.status === 'CLOSED' && i.durationSec,
  );
  const avgDur =
    closedItems.length > 0
      ? closedItems.reduce((s, i) => s + (i.durationSec ?? 0), 0) /
        closedItems.length
      : 0;
  const aiCount = items.filter(
    (i) => i.agentId === null || i.agentId === '',
  ).length;
  return {
    total: total.value,
    avgDuration: avgDur,
    aiRate: items.length > 0 ? Math.round((aiCount / items.length) * 100) : 0,
  };
});

// ===== 详情抽屉 =====
const drawerVisible = ref(false);
const drawerSessionId = ref('');
const drawerRecord = ref<null | SessionRecord>(null);

function openDetail(record: SessionRecord) {
  drawerRecord.value = record;
  drawerSessionId.value = record.sessionId;
  drawerVisible.value = true;
}

// ===== 表格列定义 =====
const columns = [
  { title: '访客', key: 'visitorName', width: 130 },
  { title: '接待客服', key: 'agentName', width: 100 },
  { title: '状态', key: 'status', width: 100 },
  { title: '标签', key: 'tag', width: 90 },
  { title: '开始时间', key: 'startedAt', width: 130 },
  { title: '结束时间', key: 'endedAt', width: 130 },
  { title: '时长', key: 'durationSec', width: 90 },
  {
    title: '消息数',
    dataIndex: 'msgCount',
    key: 'msgCount',
    width: 70,
    align: 'right' as const,
  },
  { title: '结束方', key: 'closedBy', width: 80 },
  { title: '操作', key: 'action', width: 90, fixed: 'right' as const },
];

const timePresets: { key: TimePreset; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
];

onMounted(() => {
  applyTimePreset('7d');
  loadAgentOptions();
  loadList();
});
</script>

<template>
  <Page>
    <!-- 筛选栏 -->
    <div
      class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
    >
      <!-- 时间快捷选择 -->
      <div class="flex items-center gap-1">
        <button
          v-for="p in timePresets"
          :key="p.key"
          type="button"
          class="h-7 rounded-md px-3 text-[12px] font-medium transition-colors"
          :class="
            timePreset === p.key
              ? 'bg-blue-500 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
          "
          @click="
            applyTimePreset(p.key);
            onSearch();
          "
        >
          {{ p.label }}
        </button>
      </div>

      <div class="h-6 w-px bg-slate-200 dark:bg-slate-600"></div>

      <!-- 关键词搜索 -->
      <div
        class="flex h-8 min-w-[100px] flex-1 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 dark:border-slate-600 dark:bg-slate-900"
      >
        <Icon
          icon="lucide:search"
          class="shrink-0 text-[14px] text-slate-400"
        />
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索访客名称"
          class="h-full w-full bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
          @keydown.enter="onSearch"
        />
      </div>

      <!-- 状态筛选 -->
      <Select
        v-model:value="statusFilter"
        placeholder="全部状态"
        allow-clear
        style="width: 200px"
        @change="onSearch"
      >
        <SelectOption value="CLOSED">已关闭</SelectOption>
        <SelectOption value="ACTIVE">人工接待</SelectOption>
        <SelectOption value="AI_CHAT">AI对话</SelectOption>
        <SelectOption value="WAITING">排队中</SelectOption>
      </Select>

      <!-- 结束方筛选 -->
      <Select
        v-model:value="closedByFilter"
        placeholder="全部结束方"
        allow-clear
        style="width: 200px"
        @change="onSearch"
      >
        <SelectOption value="AGENT">客服结束</SelectOption>
        <SelectOption value="VISITOR">访客结束</SelectOption>
        <SelectOption value="SYSTEM">系统结束</SelectOption>
      </Select>

      <!-- 客服多选筛选 -->
      <Select
        v-model:value="agentIds"
        mode="multiple"
        placeholder="接待客服"
        allow-clear
        :max-tag-count="1"
        :filter-option="false"
        :loading="agentSearchLoading"
        style="min-width: 360px; max-width: 400px"
        @search="onAgentSearch"
        @change="onSearch"
        @dropdown-visible-change="
          (open: boolean) => open && !agentOptions.length && loadAgentOptions()
        "
      >
        <SelectOption v-for="opt in agentOptions" :key="opt.id" :value="opt.id">
          {{ opt.name }}
        </SelectOption>
      </Select>

      <!-- 日期范围 -->
      <DatePicker.RangePicker
        v-model:value="dateRange"
        format="YYYY-MM-DD"
        :allow-clear="true"
        style="width: 400px"
        @change="onSearch"
      />

      <Button type="primary" @click="onSearch">
        <template #icon><Icon icon="lucide:search" /></template>
        查询
      </Button>
    </div>

    <!-- 统计概览 -->
    <div class="mb-3 grid grid-cols-3 gap-3">
      <div
        class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/15"
        >
          <Icon icon="lucide:list" class="text-[18px] text-blue-500" />
        </div>
        <div>
          <div
            class="text-[20px] font-bold leading-tight text-slate-800 dark:text-slate-100"
          >
            {{ stats.total }}
          </div>
          <div class="text-[12px] text-slate-500 dark:text-slate-400">
            会话总数
          </div>
        </div>
      </div>
      <div
        class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/15"
        >
          <Icon icon="lucide:clock" class="text-[18px] text-emerald-500" />
        </div>
        <div>
          <div
            class="text-[20px] font-bold leading-tight text-slate-800 dark:text-slate-100"
          >
            {{ formatDuration(stats.avgDuration) }}
          </div>
          <div class="text-[12px] text-slate-500 dark:text-slate-400">
            平均时长（当前页）
          </div>
        </div>
      </div>
      <div
        class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-500/15"
        >
          <Icon icon="lucide:bot" class="text-[18px] text-violet-500" />
        </div>
        <div>
          <div
            class="text-[20px] font-bold leading-tight text-slate-800 dark:text-slate-100"
          >
            {{ stats.aiRate }}%
          </div>
          <div class="text-[12px] text-slate-500 dark:text-slate-400">
            AI 处理率（当前页）
          </div>
        </div>
      </div>
    </div>

    <!-- 表格 -->
    <div
      class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    >
      <Table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        row-key="sessionId"
        size="small"
        :pagination="{
          current: page + 1,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t: number) => `共 ${t} 条`,
          onChange: onPageChange,
        }"
        :scroll="{ x: 1100 }"
        @row-click="(record: SessionRecord) => openDetail(record)"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'visitorName'">
            <div class="flex items-center gap-2">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-medium text-white"
                :style="{
                  background: `hsl(${((record as SessionRecord).sessionId.charCodeAt(0) * 7) % 360}, 60%, 55%)`,
                }"
              >
                {{ (record as SessionRecord).visitorName?.charAt(0) ?? '?' }}
              </div>
              <span class="truncate text-[13px] font-medium">{{
                (record as SessionRecord).visitorName
              }}</span>
            </div>
          </template>
          <template v-else-if="column.key === 'agentName'">
            <span
              v-if="(record as SessionRecord).agentName"
              class="text-[13px]"
              >{{ (record as SessionRecord).agentName }}</span
            >
            <Tag v-else color="blue" class="!text-[11px]">AI</Tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag
              :color="
                STATUS_MAP[(record as SessionRecord).status]?.color ?? 'default'
              "
              class="!text-[11px]"
            >
              {{
                STATUS_MAP[(record as SessionRecord).status]?.label ??
                (record as SessionRecord).status
              }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'tag'">
            <Tag
              v-if="(record as SessionRecord).tag"
              :color="tagColor((record as SessionRecord).tag)"
              class="!text-[11px]"
            >
              {{ (record as SessionRecord).tag }}
            </Tag>
            <span v-else class="text-[12px] text-slate-400">—</span>
          </template>
          <template v-else-if="column.key === 'startedAt'">
            <span class="text-[12px] text-slate-500">{{
              formatTime((record as SessionRecord).startedAt)
            }}</span>
          </template>
          <template v-else-if="column.key === 'endedAt'">
            <span class="text-[12px] text-slate-500">{{
              formatTime((record as SessionRecord).endedAt)
            }}</span>
          </template>
          <template v-else-if="column.key === 'durationSec'">
            <Tag
              v-if="
                (record as SessionRecord).durationSec !== null &&
                (record as SessionRecord).durationSec! >= 0
              "
              :color="durationTagColor((record as SessionRecord).durationSec)"
              class="!text-[11px]"
            >
              {{ formatDuration((record as SessionRecord).durationSec) }}
            </Tag>
            <span v-else class="text-[12px] text-slate-400">—</span>
          </template>
          <template v-else-if="column.key === 'closedBy'">
            <Tag
              v-if="(record as SessionRecord).closedBy"
              :color="
                CLOSED_BY_MAP[(record as SessionRecord).closedBy!]?.color ??
                'default'
              "
              class="!text-[11px]"
            >
              {{
                CLOSED_BY_MAP[(record as SessionRecord).closedBy!]?.label ??
                (record as SessionRecord).closedBy
              }}
            </Tag>
            <span v-else class="text-[12px] text-slate-400">—</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <Button
              size="small"
              type="link"
              @click.stop="openDetail(record as SessionRecord)"
            >
              查看详情
            </Button>
          </template>
        </template>
      </Table>
    </div>

    <!-- 详情抽屉 -->
    <SessionDetailDrawer
      v-model:open="drawerVisible"
      :record="drawerRecord"
      :session-id="drawerSessionId"
    />
  </Page>
</template>
