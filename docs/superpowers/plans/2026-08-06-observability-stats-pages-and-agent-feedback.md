# 观测统计页 + 座席反馈按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为后端交付的三个可观测性统计接口（意图分类命中率 / RAG 质量 / LLM Token 成本）新建「观测统计」导航分组下的三个前端展示页，并在座席工作台为 AI 回复补充「反馈」弹窗（三类型 + 纠正输入）对接坐席纠错写入接口。

**Architecture:** 前端为 Vben Admin 5.x monorepo（`@vben/web-antd`），页面镜像现有 `views/session/history` 模板：`Page` 包裹 + 时间区间选择 + 概览卡片 + ECharts 图表 + 榜单表。统计接口经 `conversationClient`（`/conversation/api/v1`，带 token）调用；反馈接口经同一 client `POST /sessions/feedback`。图表复用 `@vben/plugins/echarts` 的 `EchartsUI` + `useEcharts` 组合式与 `chart-theme.ts` 色板。

**Tech Stack:** Vue 3.5 `<script setup>`、Ant Design Vue 4、ECharts 6（经 `@vben/plugins/echarts`）、TailwindCSS 4、vue-i18n 11、TypeScript（`vue-tsc` typecheck 门禁）。

## Global Constraints

- 所有统计接口走 `conversationClient`（在 `apps/src/api/session/index.ts` 中已别名 `agentClient`）；新建 `apps/src/api/stats/index.ts` 直接导入 `conversationClient`。
- 后端响应经 `R<T>` 信封，request 拦截器已解包，前端拿到的即 `data`。
- `period` **入参**用 code：`today` / `7d` / `30d`；接口**返回**里的 `period` 字段是枚举名 `TODAY` / `LAST_7D` / `LAST_30D`（大写），前端展示不要直接回显该字段做区间判断。
- 可空字段：intent 的 `avgLatencyMs.{RULE,EMBEDDING,LLM}` 为 `Long | null`；rag 的 `avgTop1Score` 为 `Long | null`。渲染需处理 null（显示「—」，图表跳过）。
- 榜单/分组行使用后端**原始 snake_case** 列名：`query_text`、`miss_count`、`model_name`、`total_tokens`、`call_count`、`call_type`。
- llm-cost 的 `byModel` / `byCallType` 忽略 `modelName` 过滤（后端行为，UI 文案需说明）。
- 路由 `meta.authority: ['super_admin', 'kf_manager']`（镜像 session/history）；侧边栏是 DB 驱动菜单，前端只建路由+视图，实际显示需后端 DB 追加菜单行（本计划范围外，末尾标注）。
- i18n：路由/菜单标题走 `$t('page.stats.*')`，需同步 `zh-CN` 与 `en-US` 的 `page.json`；页内文案沿用现有硬编码中文风格。
- 反馈接口契约：`POST /sessions/feedback`，body `{ sessionId(必填), messageId(可空), feedbackType(必填 WRONG_INTENT|WRONG_ANSWER|GOOD), originalQuery(必填), correctIntent(WRONG_INTENT 时必填), correctAnswer(WRONG_ANSWER 时必填) }`；`agentId` 由后端 Sa-Token 会话取，不传。`messageId` 传 `null`（座席端 `Msg.id` 仅客户端计数器，非后端 seq）。
- ECharts 色板从 `apps/src/views/dashboard/analytics/chart-theme.ts` 复用（`CHART_COLORS` / `CHART_PALETTE`），不要硬编码颜色。
- 验证命令：`pnpm -F @vben/web-antd typecheck`（或根 `pnpm typecheck`）必须通过；commit 前 lefthook 会跑 oxlint/eslint/typecheck，禁止 `!` 非空断言（oxlint 拦截）。

---

## File Structure

- `apps/src/api/stats/index.ts` — **新建**。统计接口 TS 类型 + 三个 API 函数。单一职责：观测统计数据访问层。
- `apps/src/api/session/index.ts` — **修改**。新增 `submitAgentFeedbackApi` 及 `AgentFeedbackPayload` / `FeedbackType`。
- `apps/src/views/stats/intent/index.vue` — **新建**。意图分类命中率页。
- `apps/src/views/stats/rag/index.vue` — **新建**。RAG 检索质量页。
- `apps/src/views/stats/llm-cost/index.vue` — **新建**。LLM Token 成本页。
- `apps/src/views/stats/shared/PeriodTabs.vue` — **新建**。三页共用的 `today/7d/30d` 区间切换按钮组（镜像 history 页时间快捷按钮样式）。
- `apps/src/views/stats/shared/StatCard.vue` — **新建**。三页共用的概览卡片（镜像 history 页统计卡片样式：图标块 + 数值 + 标签）。
- `apps/src/router/routes/modules/stats.ts` — **新建**。「观测统计」分组 + 三个叶子路由。
- `apps/src/locales/langs/zh-CN/page.json` — **修改**。新增 `stats` 键。
- `apps/src/locales/langs/en-US/page.json` — **修改**。新增 `stats` 键。
- `apps/src/views/session/agent/AgentChatArea.vue` — **修改**。AI 气泡 footer 增加「反馈」按钮，emit `feedback`。
- `apps/src/views/session/agent/index.vue` — **修改**。处理 `feedback` 事件，弹窗收集输入，派生 `originalQuery`，调用 API。

---

## Task 1: 统计接口数据访问层

**Files:**
- Create: `apps/src/api/stats/index.ts`

**Interfaces:**
- Produces:
  - `type StatsPeriod = 'today' | '7d' | '30d'`
  - `interface IntentStats { period: string; totalClassifications: number; tier1HitRate: number; tier2HitRate: number; tier3TriggerRate: number; avgLatencyMs: { RULE: null | number; EMBEDDING: null | number; LLM: null | number } }`
  - `interface RagMissQuery { query_text: string; miss_count: number }`
  - `interface RagStats { period: string; totalSearches: number; missCount: number; missRate: number; avgTop1Score: null | number; topMissQueries: RagMissQuery[] }`
  - `interface LlmModelRow { model_name: string; total_tokens: number; call_count: number }`
  - `interface LlmCallTypeRow { call_type: string; total_tokens: number }`
  - `interface LlmCostStats { period: string; totalInputTokens: number; totalOutputTokens: number; totalTokens: number; callCount: number; avgTokensPerCall: number; byModel: LlmModelRow[]; byCallType: LlmCallTypeRow[] }`
  - `getIntentStatsApi(period: StatsPeriod, domainCode?: string): Promise<IntentStats>`
  - `getRagStatsApi(period: StatsPeriod): Promise<RagStats>`
  - `getLlmCostStatsApi(period: StatsPeriod, modelName?: string): Promise<LlmCostStats>`

- [ ] **Step 1: 创建 API 模块文件**

创建 `apps/src/api/stats/index.ts`：

```typescript
/**
 * 观测统计接口（管理端，/stats/* 页面）。
 *
 * 对接 conversation-service AdminStatsController：
 *   GET /admin/stats/intent-classification
 *   GET /admin/stats/rag-quality
 *   GET /admin/stats/llm-cost
 * 均需 token（system:session:query），故走 conversationClient。
 *
 * 注意：入参 period 用 code（today/7d/30d），返回体里的 period 字段是枚举名
 * （TODAY/LAST_7D/LAST_30D），前端只用于展示，不用它反推区间。
 */
import { conversationClient } from '#/api/request';

const statsClient = conversationClient;

/** 统计区间 code（接口入参） */
export type StatsPeriod = '7d' | '30d' | 'today';

/** 意图分类三层命中率（P0-A） */
export interface IntentStats {
  /** 枚举名回显：TODAY / LAST_7D / LAST_30D */
  period: string;
  totalClassifications: number;
  /** 0-1，4 位小数；总数为 0 时为 0 */
  tier1HitRate: number;
  tier2HitRate: number;
  tier3TriggerRate: number;
  /** 各层平均延迟 ms，无数据为 null */
  avgLatencyMs: {
    EMBEDDING: null | number;
    LLM: null | number;
    RULE: null | number;
  };
}

/** RAG 未命中查询榜单项（后端原始 snake_case 列名） */
export interface RagMissQuery {
  miss_count: number;
  query_text: string;
}

/** RAG 检索质量（P0-B） */
export interface RagStats {
  period: string;
  totalSearches: number;
  missCount: number;
  /** 0-1，4 位小数 */
  missRate: number;
  /** top1 平均分，取整；无数据为 null */
  avgTop1Score: null | number;
  /** 未命中榜，最多 20 条 */
  topMissQueries: RagMissQuery[];
}

/** LLM 成本按模型分组行（后端原始 snake_case） */
export interface LlmModelRow {
  call_count: number;
  model_name: string;
  total_tokens: number;
}

/** LLM 成本按调用类型分组行 */
export interface LlmCallTypeRow {
  call_type: string;
  total_tokens: number;
}

/** LLM Token 成本（P0-D） */
export interface LlmCostStats {
  period: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  callCount: number;
  avgTokensPerCall: number;
  /** 注意：byModel / byCallType 忽略 modelName 过滤，始终为区间内全量 */
  byModel: LlmModelRow[];
  byCallType: LlmCallTypeRow[];
}

/** 意图分类命中率统计 */
export async function getIntentStatsApi(
  period: StatsPeriod,
  domainCode?: string,
): Promise<IntentStats> {
  return statsClient.get('/admin/stats/intent-classification', {
    params: { period, domainCode },
  });
}

/** RAG 检索质量统计 */
export async function getRagStatsApi(
  period: StatsPeriod,
): Promise<RagStats> {
  return statsClient.get('/admin/stats/rag-quality', { params: { period } });
}

/** LLM Token 成本统计 */
export async function getLlmCostStatsApi(
  period: StatsPeriod,
  modelName?: string,
): Promise<LlmCostStats> {
  return statsClient.get('/admin/stats/llm-cost', {
    params: { period, modelName },
  });
}
```

- [ ] **Step 2: 验证导入路径与类型编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS（`#/api/request` 导出 `conversationClient`，无类型错误）

- [ ] **Step 3: Commit**

```bash
git add apps/src/api/stats/index.ts
git commit -m "feat(stats): 新增观测统计接口数据访问层"
```

---

## Task 2: 共用组件 StatCard 与 PeriodTabs

**Files:**
- Create: `apps/src/views/stats/shared/StatCard.vue`
- Create: `apps/src/views/stats/shared/PeriodTabs.vue`

**Interfaces:**
- Produces:
  - `StatCard` props: `{ icon: string; label: string; value: string | number; tone?: 'blue' | 'emerald' | 'violet' | 'amber' | 'red' }`（tone 默认 `blue`）
  - `PeriodTabs`: `v-model:value` 绑定 `StatsPeriod`，change 时触发 `update:value`

- [ ] **Step 1: 创建 StatCard.vue**

镜像 `views/session/history/index.vue` 概览卡片结构（图标块 + 数值 + 标签）。创建 `apps/src/views/stats/shared/StatCard.vue`：

```vue
<script lang="ts" setup>
import { computed } from 'vue';

import { Icon } from '@iconify/vue';

const props = withDefaults(
  defineProps<{
    icon: string;
    label: string;
    tone?: 'amber' | 'blue' | 'emerald' | 'red' | 'violet';
    value: number | string;
  }>(),
  { tone: 'blue' },
);

/** 图标底色 + 图标色，按 tone 取 tailwind 类 */
const toneClass = computed(() => {
  const map: Record<string, { bg: string; text: string }> = {
    amber: { bg: 'bg-amber-50 dark:bg-amber-500/15', text: 'text-amber-500' },
    blue: { bg: 'bg-blue-50 dark:bg-blue-500/15', text: 'text-blue-500' },
    emerald: {
      bg: 'bg-emerald-50 dark:bg-emerald-500/15',
      text: 'text-emerald-500',
    },
    red: { bg: 'bg-red-50 dark:bg-red-500/15', text: 'text-red-500' },
    violet: {
      bg: 'bg-violet-50 dark:bg-violet-500/15',
      text: 'text-violet-500',
    },
  };
  return map[props.tone] ?? map.blue;
});
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
  >
    <div
      class="flex h-10 w-10 items-center justify-center rounded-lg"
      :class="toneClass.bg"
    >
      <Icon :icon="icon" class="text-[18px]" :class="toneClass.text" />
    </div>
    <div>
      <div
        class="text-[20px] font-bold leading-tight text-slate-800 dark:text-slate-100"
      >
        {{ value }}
      </div>
      <div class="text-[12px] text-slate-500 dark:text-slate-400">
        {{ label }}
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 创建 PeriodTabs.vue**

镜像 history 页时间快捷按钮样式。创建 `apps/src/views/stats/shared/PeriodTabs.vue`：

```vue
<script lang="ts" setup>
import type { StatsPeriod } from '#/api/stats';

const props = defineProps<{ value: StatsPeriod }>();
const emit = defineEmits<{ 'update:value': [StatsPeriod] }>();

const presets: { key: StatsPeriod; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
];

function pick(key: StatsPeriod) {
  if (key !== props.value) emit('update:value', key);
}
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      v-for="p in presets"
      :key="p.key"
      type="button"
      class="h-7 rounded-md px-3 text-[12px] font-medium transition-colors"
      :class="
        value === p.key
          ? 'bg-blue-500 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
      "
      @click="pick(p.key)"
    >
      {{ p.label }}
    </button>
  </div>
</template>
```

- [ ] **Step 3: 验证编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/src/views/stats/shared/StatCard.vue apps/src/views/stats/shared/PeriodTabs.vue
git commit -m "feat(stats): 新增统计页共用卡片与区间切换组件"
```

---

## Task 3: 意图分类命中率页

**Files:**
- Create: `apps/src/views/stats/intent/index.vue`

**Interfaces:**
- Consumes: `getIntentStatsApi`（Task 1）、`StatCard` / `PeriodTabs`（Task 2）、`EchartsUI` + `useEcharts`（`@vben/plugins/echarts`）、`CHART_COLORS`（`views/dashboard/analytics/chart-theme.ts`）

- [ ] **Step 1: 创建页面**

创建 `apps/src/views/stats/intent/index.vue`。概览卡片（总分类数、Tier1/Tier2 命中率、Tier3 触发率）+ 三层平均延迟柱状图（null 层跳过）+ 可选 `domainCode` 输入。命中率 `*100` 显示百分比。

```vue
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
    grid: { bottom: 20, containLabel: true, left: '2%', right: '3%', top: '8%' },
    series: [
      {
        barWidth: 36,
        data: rows.map((r) => r.value),
        itemStyle: { borderRadius: [4, 4, 0, 0], color: CHART_COLORS.primary },
        type: 'bar',
      },
    ],
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v} ms` },
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
      <div class="mb-2 text-[13px] font-medium text-slate-700 dark:text-slate-200">
        各层平均延迟
      </div>
      <EchartsUI ref="chartRef" style="height: 320px" />
    </div>
  </Page>
</template>
```

- [ ] **Step 2: 验证编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/src/views/stats/intent/index.vue
git commit -m "feat(stats): 新增意图分类命中率统计页"
```

---

## Task 4: RAG 检索质量页

**Files:**
- Create: `apps/src/views/stats/rag/index.vue`

**Interfaces:**
- Consumes: `getRagStatsApi`（Task 1）、`StatCard` / `PeriodTabs`（Task 2）、Ant Design Vue `Table`

- [ ] **Step 1: 创建页面**

创建 `apps/src/views/stats/rag/index.vue`。默认 `7d`。概览卡片（总检索、未命中数、未命中率、top1 平均分）+ `topMissQueries` 榜单表（`query_text` / `miss_count`）。

```vue
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
const data = ref<RagStats | null>(null);

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
```

- [ ] **Step 2: 验证编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/src/views/stats/rag/index.vue
git commit -m "feat(stats): 新增 RAG 检索质量统计页"
```

---

## Task 5: LLM Token 成本页

**Files:**
- Create: `apps/src/views/stats/llm-cost/index.vue`

**Interfaces:**
- Consumes: `getLlmCostStatsApi`（Task 1）、`StatCard` / `PeriodTabs`（Task 2）、`EchartsUI` + `useEcharts`、`CHART_PALETTE`、Ant Design Vue `Table` / `Input`

- [ ] **Step 1: 创建页面**

创建 `apps/src/views/stats/llm-cost/index.vue`。默认 `today`。概览卡片（输入/输出/总 Token、调用数）+ `byModel` 柱状图 + `byCallType` 表。`modelName` 可选输入，UI 注明 byModel/byCallType 不受该过滤影响。

```vue
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
    grid: { bottom: 20, containLabel: true, left: '2%', right: '3%', top: '8%' },
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
```

- [ ] **Step 2: 验证编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/src/views/stats/llm-cost/index.vue
git commit -m "feat(stats): 新增 LLM Token 成本统计页"
```

---

## Task 6: 路由与 i18n

**Files:**
- Create: `apps/src/router/routes/modules/stats.ts`
- Modify: `apps/src/locales/langs/zh-CN/page.json`
- Modify: `apps/src/locales/langs/en-US/page.json`

**Interfaces:**
- Consumes: 三个页面视图（Task 3/4/5）、`$t` from `#/locales`

- [ ] **Step 1: 新增 i18n 键（zh-CN）**

在 `apps/src/locales/langs/zh-CN/page.json` 的 `customerservice` 块之后（顶层对象内）新增：

```json
  "stats": {
    "title": "观测统计",
    "intent": "意图分类命中率",
    "rag": "RAG 检索质量",
    "llmCost": "LLM Token 成本"
  }
```

（注意：追加到 `customerservice` 对象之后，需在其前一个对象末尾补逗号，保持 JSON 合法。）

- [ ] **Step 2: 新增 i18n 键（en-US）**

在 `apps/src/locales/langs/en-US/page.json` 顶层对象内新增：

```json
  "stats": {
    "title": "Observability",
    "intent": "Intent Hit Rate",
    "rag": "RAG Quality",
    "llmCost": "LLM Token Cost"
  }
```

- [ ] **Step 3: 创建路由模块**

创建 `apps/src/router/routes/modules/stats.ts`（镜像 `session.ts` 结构）：

```typescript
import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

/**
 * 观测统计模块路由。
 *   - super_admin / kf_manager 可访问
 *
 * 注意：菜单为后端 DB 驱动，侧边栏显示还需在后端补充对应菜单行，
 * 其 component 路径需与此处视图路径一致。
 */
const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:activity',
      order: 25,
      title: $t('page.stats.title'),
    },
    name: 'Stats',
    path: '/stats',
    children: [
      {
        name: 'StatsIntent',
        path: '/stats/intent',
        component: () => import('#/views/stats/intent/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:git-branch',
          title: $t('page.stats.intent'),
        },
      },
      {
        name: 'StatsRag',
        path: '/stats/rag',
        component: () => import('#/views/stats/rag/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:database',
          title: $t('page.stats.rag'),
        },
      },
      {
        name: 'StatsLlmCost',
        path: '/stats/llm-cost',
        component: () => import('#/views/stats/llm-cost/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:coins',
          title: $t('page.stats.llmCost'),
        },
      },
    ],
  },
];

export default routes;
```

- [ ] **Step 4: 验证编译 + JSON 合法性**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS（`routes/index.ts` 自动 glob `./modules/**/*.ts`，无需手动注册；`$t('page.stats.*')` 键存在）

- [ ] **Step 5: Commit**

```bash
git add apps/src/router/routes/modules/stats.ts apps/src/locales/langs/zh-CN/page.json apps/src/locales/langs/en-US/page.json
git commit -m "feat(stats): 新增观测统计分组路由与 i18n 标题"
```

---

## Task 7: 座席反馈接口函数

**Files:**
- Modify: `apps/src/api/session/index.ts`

**Interfaces:**
- Produces:
  - `type FeedbackType = 'GOOD' | 'WRONG_ANSWER' | 'WRONG_INTENT'`
  - `interface AgentFeedbackPayload { sessionId: string; messageId?: null | string; feedbackType: FeedbackType; originalQuery: string; correctIntent?: string; correctAnswer?: string }`
  - `submitAgentFeedbackApi(payload: AgentFeedbackPayload): Promise<void>`

- [ ] **Step 1: 在 session/index.ts 末尾追加反馈 API**

在 `apps/src/api/session/index.ts` 文件末尾追加（`agentClient` 已在文件顶部定义）：

```typescript
// -------------------------------------------------------
// 座席纠错反馈（座席工作台 AI 回复「反馈」按钮）
// -------------------------------------------------------

/** 反馈类型：意图错误 / 回答错误 / 好评 */
export type FeedbackType = 'GOOD' | 'WRONG_ANSWER' | 'WRONG_INTENT';

/**
 * 座席纠错反馈请求体。
 * agentId 由后端 Sa-Token 会话解析，前端不传。
 * messageId 座席端无后端 seq 可用，传 null。
 */
export interface AgentFeedbackPayload {
  sessionId: string;
  /** 座席端无后端消息 seq，恒为 null */
  messageId?: null | string;
  feedbackType: FeedbackType;
  /** 触发该 AI 回复的访客原始问题 */
  originalQuery: string;
  /** feedbackType=WRONG_INTENT 时必填 */
  correctIntent?: string;
  /** feedbackType=WRONG_ANSWER 时必填 */
  correctAnswer?: string;
}

/**
 * 提交座席纠错反馈（需 token）。
 * 对接 conversation-service：POST /sessions/feedback（@SaCheckLogin）。
 */
export async function submitAgentFeedbackApi(
  payload: AgentFeedbackPayload,
): Promise<void> {
  return agentClient.post('/sessions/feedback', payload);
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/src/api/session/index.ts
git commit -m "feat(session): 新增座席纠错反馈接口函数"
```

---

## Task 8: AI 气泡「反馈」按钮

**Files:**
- Modify: `apps/src/views/session/agent/AgentChatArea.vue`

**Interfaces:**
- Consumes: 现有 `emit`（`defineEmits`，含 `copyMsg`）、`Msg` 类型
- Produces: 新 emit 事件 `feedback: [m: Msg]`

- [ ] **Step 1: 在 defineEmits 增加 feedback 事件**

打开 `apps/src/views/session/agent/AgentChatArea.vue`，找到 `defineEmits`（约 line 38，含 `copyMsg`）。在其类型字面量中追加 `feedback` 事件（保持既有事件不变）。例如既有为：

```typescript
const emit = defineEmits<{
  copyMsg: [text: string];
  // ...其余事件保持不变
}>();
```

改为在同一对象内追加一行：

```typescript
  feedback: [m: Msg];
```

（`Msg` 类型该文件已从 `./types` 导入；若未导入则补 `import type { Msg } from './types';`。执行时先确认导入存在。）

- [ ] **Step 2: 在 AI 气泡 footer 增加反馈按钮**

找到活动会话 AI 气泡的时间戳 + 复制按钮 footer 行（约 line 566-581，`<div v-if="m.time" class="mt-0.5 flex items-center gap-1.5" ...>` 内，复制按钮 `@click.stop="emit('copyMsg', m.text)"` 之后）。在复制按钮之后追加一个仅 AI 消息可见的反馈按钮：

```vue
        <button
          v-if="m.role === 'ai' && m.text"
          class="text-[#d4d8e3] transition hover:text-[#9ca3af]"
          title="反馈"
          @click.stop="emit('feedback', m)"
        >
          <Icon icon="lucide:flag" class="h-3 w-3" />
        </button>
```

（`Icon` 该文件已使用，无需新增导入。执行时确认该 footer 位于 AI/agent 右对齐气泡内。）

- [ ] **Step 3: 验证编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/src/views/session/agent/AgentChatArea.vue
git commit -m "feat(agent): AI 回复气泡新增反馈按钮"
```

---

## Task 9: 反馈弹窗与提交逻辑

**Files:**
- Modify: `apps/src/views/session/agent/index.vue`

**Interfaces:**
- Consumes: `submitAgentFeedbackApi` / `AgentFeedbackPayload` / `FeedbackType`（Task 7）、`AgentChatArea` 的 `feedback` emit（Task 8）、`activeSession`（现有 computed）、`Msg` 类型
- Produces: 无（终端消费者）

- [ ] **Step 1: 导入 API 与新增弹窗状态**

在 `apps/src/views/session/agent/index.vue` 的 `<script setup>` 中：

(a) 从 `#/api/session` 导入（合并进现有 import）：

```typescript
import { submitAgentFeedbackApi } from '#/api/session';
import type { AgentFeedbackPayload, FeedbackType } from '#/api/session';
```

(b) 确认已从 `ant-design-vue` 导入 `Modal`、`Input`、`Select`、`SelectOption`、`message`、`RadioGroup`、`Radio`（缺哪个补哪个；`message` 大概率已导入）。

(c) 新增弹窗状态（放在其他 ref 声明附近）：

```typescript
// ===== 座席反馈弹窗 =====
const feedbackOpen = ref(false);
const feedbackSubmitting = ref(false);
const feedbackType = ref<FeedbackType>('WRONG_INTENT');
const feedbackOriginalQuery = ref('');
const feedbackAnswerText = ref(''); // 被反馈的 AI 回复原文
const feedbackCorrectIntent = ref('');
const feedbackCorrectAnswer = ref('');
```

- [ ] **Step 2: 增加打开弹窗 handler（派生 originalQuery）**

在 `<script setup>` 中新增。`originalQuery` 从 `activeSession.value.msgs` 全量数组里，反向查找该 AI 消息之前最近的 `role === 'user'` 消息（注意用全量 `msgs`，不要用 `filteredMsgs`）：

```typescript
/** 打开反馈弹窗：派生该 AI 回复对应的访客原始问题 */
function openFeedback(m: Msg) {
  const s = activeSession.value;
  if (!s) {
    message.warning('请先选择会话');
    return;
  }
  const msgs = s.msgs;
  const idx = msgs.findIndex((x) => x.id === m.id);
  let query = '';
  for (let i = idx - 1; i >= 0; i--) {
    if (msgs[i]?.role === 'user') {
      query = msgs[i]?.text ?? '';
      break;
    }
  }
  feedbackType.value = 'WRONG_INTENT';
  feedbackOriginalQuery.value = query;
  feedbackAnswerText.value = m.text;
  feedbackCorrectIntent.value = '';
  feedbackCorrectAnswer.value = '';
  feedbackOpen.value = true;
}
```

（`Msg` 类型该文件已导入自 `./types`；若无则补 `import type { Msg } from './types';`。）

- [ ] **Step 3: 增加提交 handler（条件必填校验）**

```typescript
/** 提交反馈：按类型做条件必填校验 */
async function submitFeedback() {
  const s = activeSession.value;
  if (!s) return;
  if (!feedbackOriginalQuery.value.trim()) {
    message.warning('未能识别原始问题，请补充');
    return;
  }
  if (
    feedbackType.value === 'WRONG_INTENT' &&
    !feedbackCorrectIntent.value.trim()
  ) {
    message.warning('请填写正确意图');
    return;
  }
  if (
    feedbackType.value === 'WRONG_ANSWER' &&
    !feedbackCorrectAnswer.value.trim()
  ) {
    message.warning('请填写正确答案');
    return;
  }

  const payload: AgentFeedbackPayload = {
    sessionId: s.id,
    messageId: null,
    feedbackType: feedbackType.value,
    originalQuery: feedbackOriginalQuery.value.trim(),
  };
  if (feedbackType.value === 'WRONG_INTENT') {
    payload.correctIntent = feedbackCorrectIntent.value.trim();
  }
  if (feedbackType.value === 'WRONG_ANSWER') {
    payload.correctAnswer = feedbackCorrectAnswer.value.trim();
  }

  feedbackSubmitting.value = true;
  try {
    await submitAgentFeedbackApi(payload);
    message.success('反馈已提交，感谢你的纠错');
    feedbackOpen.value = false;
  } catch {
    message.error('反馈提交失败，请重试');
  } finally {
    feedbackSubmitting.value = false;
  }
}
```

- [ ] **Step 4: 在模板绑定 AgentChatArea 的 feedback 事件**

找到模板中 `<AgentChatArea ... @copy-msg="copyMsgText" ... />`，在其上追加：

```vue
        @feedback="openFeedback"
```

- [ ] **Step 5: 在模板末尾新增反馈弹窗**

在 `<template>` 内合适位置（与其他 Modal/Drawer 并列，例如根容器末尾）新增：

```vue
    <Modal
      v-model:open="feedbackOpen"
      title="回答反馈"
      :confirm-loading="feedbackSubmitting"
      ok-text="提交"
      cancel-text="取消"
      @ok="submitFeedback"
    >
      <div class="flex flex-col gap-3 py-1">
        <div>
          <div class="mb-1 text-[13px] text-slate-500">反馈类型</div>
          <RadioGroup v-model:value="feedbackType">
            <Radio value="WRONG_INTENT">意图错误</Radio>
            <Radio value="WRONG_ANSWER">回答错误</Radio>
            <Radio value="GOOD">好评</Radio>
          </RadioGroup>
        </div>

        <div>
          <div class="mb-1 text-[13px] text-slate-500">访客原始问题</div>
          <Input.TextArea
            v-model:value="feedbackOriginalQuery"
            :rows="2"
            placeholder="访客的原始问题"
          />
        </div>

        <div v-if="feedbackAnswerText">
          <div class="mb-1 text-[13px] text-slate-500">被反馈的 AI 回复</div>
          <div
            class="max-h-24 overflow-auto rounded-md bg-slate-50 p-2 text-[12px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {{ feedbackAnswerText }}
          </div>
        </div>

        <div v-if="feedbackType === 'WRONG_INTENT'">
          <div class="mb-1 text-[13px] text-slate-500">正确意图</div>
          <Input
            v-model:value="feedbackCorrectIntent"
            placeholder="应识别为的意图"
          />
        </div>

        <div v-if="feedbackType === 'WRONG_ANSWER'">
          <div class="mb-1 text-[13px] text-slate-500">正确答案</div>
          <Input.TextArea
            v-model:value="feedbackCorrectAnswer"
            :rows="3"
            placeholder="应回复的正确内容"
          />
        </div>
      </div>
    </Modal>
```

- [ ] **Step 6: 验证编译**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/src/views/session/agent/index.vue
git commit -m "feat(agent): 新增座席纠错反馈弹窗与提交逻辑"
```

---

## Task 10: 全量验证与收尾

**Files:** 无新增

- [ ] **Step 1: 全量 typecheck**

Run: `pnpm -F @vben/web-antd typecheck`
Expected: PASS

- [ ] **Step 2: lint 校验（提交门禁预检）**

Run: `pnpm -F @vben/web-antd lint`（若存在该 script；否则依赖 lefthook 在 commit 时执行）
Expected: 无 error（特别注意 oxlint 禁止 `!` 非空断言）

- [ ] **Step 3: 确认无遗留临时文件**

检查工作区无本任务产生的临时文件，`git status` 干净（除计划内改动）。

- [ ] **Step 4: 标注后端 DB 菜单待办**

在最终交付说明中提醒：三个统计页要在侧边栏显示，需后端在菜单表补充 `/stats`、`/stats/intent`、`/stats/rag`、`/stats/llm-cost` 菜单行，`component` 路径与视图一致，授予 `super_admin` / `kf_manager` 角色。前端无法直接改 DB。

---

## Self-Review

**Spec coverage:**
- 三个统计页（intent/rag/llm-cost）→ Task 3/4/5 ✓
- 概览卡片 + 图表 + 榜单表 → StatCard（Task 2）+ 各页 ECharts/Table（Task 3/4/5）✓
- 新建「观测统计」分组 → Task 6 路由 order 25 + i18n ✓
- 完整反馈弹窗（三类型 + 纠正输入）→ Task 9 ✓
- 反馈接口对接 → Task 7 ✓
- AI 气泡按钮 → Task 8 ✓
- DB 菜单待办标注 → Task 10 Step 4 ✓

**Placeholder scan:** 无 TBD/TODO；所有步骤含完整代码。Task 8/9 对既有文件的锚点（defineEmits 行、footer 行、Modal import）标注了「执行时确认」，因这些是既有代码需现场核对的插入点，非占位符。

**Type consistency:** `StatsPeriod`（Task 1）在 Task 2/3/4/5 一致使用；`FeedbackType` / `AgentFeedbackPayload`（Task 7）在 Task 9 一致；snake_case 列名（`query_text`/`miss_count`/`model_name`/`total_tokens`/`call_count`/`call_type`）在类型定义与表格 dataIndex 一致；`getIntentStatsApi`/`getRagStatsApi`/`getLlmCostStatsApi`/`submitAgentFeedbackApi` 命名前后一致。
