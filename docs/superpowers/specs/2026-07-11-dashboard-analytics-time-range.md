# Dashboard 分析页时间范围筛选 + 效率趋势折线图 设计文档

## 一、背景与目标

### 背景

后端会话表新增了三个时间字段（`accepted_at`、`first_reply_at`、`closed_by`），并在 `/api/v1/dashboard/overview` 中补充了三项效率指标：

| 字段 | 含义 |
|---|---|
| `avgWaitSeconds` | 平均等待时长（`accepted_at - started_at`） |
| `avgHandleSeconds` | 平均处理时长（`ended_at - accepted_at`） |
| `avgFirstReplySeconds` | 平均首次回复时长（`first_reply_at - accepted_at`） |

但前端目前：
1. `DashboardOverviewData` 类型未声明这三个字段
2. 页面没有展示这三项指标
3. 所有趋势图硬编码为"过去 12 个月按月聚合"，无法按周/天查看
4. 没有效率随时间变化的趋势视图

### 目标

1. 在 `/dashboard/analysis` 页面顶部增加全局**时间范围选择器**（本月 / 本周 / 最近 7 天 / 最近 N 天）
2. 所有图表（会话趋势、消息量、效率趋势）均响应该选择器
3. 新增**效率趋势折线图**，展示 3 条指标线随时间的变化
4. 概览卡片新增 3 项效率指标展示

### 非目标

- 不修改状态分布、标签分布、指标雷达图（它们展示的是当前快照，与时间范围无关）
- 不支持自定义日期区间（只做枚举范围选项，降低交互复杂度）
- 不修改后端座席工作量接口

## 二、时间范围选择器交互设计

### 选项定义

| 选项 | value | 后端参数 | X 轴粒度 |
|---|---|---|---|
| 本月 | `month` | `rangeType=month` | 按天 |
| 本周 | `week` | `rangeType=week` | 按天 |
| 最近 7 天 | `days7` | `rangeType=custom&days=7` | 按天 |
| 最近 30 天 | `days30` | `rangeType=custom&days=30` | 按天 |

默认选中：**本月**。

### 页面位置

```
┌─────────────────────────────────────────────────────────────────┐
│  分析概览                          [本月] [本周] [近7天] [近30天] │  ← 右上角 Radio Group
├─────────────────────────────────────────────────────────────────┤
│  [今日会话量]  [活跃会话]  [总消息数]  [总用户数]                 │  ← 概览卡片（不变）
│  [平均等待]    [平均处理]  [平均首次回复]                         │  ← 新增效率卡片行
├─────────────────────────────────────────────────────────────────┤
│  Tab: [会话趋势] [消息量] [效率趋势]                              │  ← 新增第三个 Tab
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   折线图 / 柱状图（响应时间选择器）                         │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  [指标雷达]  [会话状态]  [问题标签]                               │  ← 不变
└─────────────────────────────────────────────────────────────────┘
```

### 交互行为

- 切换选项后，**立即**（不需要确认）重新请求以下 3 个接口：
  - `/api/v1/dashboard/conversation-trends`
  - `/api/v1/dashboard/message-trends`
  - `/api/v1/dashboard/efficiency-trends`（新增）
- 请求期间图表显示 loading 态（ECharts 遮罩或骨架屏）
- 概览指标卡片（`/overview`）**也**随时间范围刷新，但效率均值会随范围变化
- 状态分布 / 标签分布 / 指标雷达不刷新（快照数据）

### 组件封装

新增 `DashboardTimeRangeSelector` 组件，对外暴露：
```ts
// props
modelValue: TimeRange  // 双向绑定当前选中值

// emits
update:modelValue: (val: TimeRange) => void

// 类型
type TimeRange = 'month' | 'week' | 'days7' | 'days30'
```

使用 Ant Design Vue 的 `<a-radio-group button-style="solid">` 实现样式。

## 三、后端接口改动设计

### 3.1 公共时间范围参数

所有趋势接口统一接收相同的查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `rangeType` | `String` | 否，默认 `month` | `month` / `week` / `custom` |
| `days` | `Integer` | 仅 `rangeType=custom` 时必填 | 往前推 N 天，如 7、30 |

后端根据参数计算 `startDate` / `endDate`：
```java
// rangeType=month  → 本月第一天 00:00:00 ~ 今天 23:59:59
// rangeType=week   → 本周一 00:00:00 ~ 今天 23:59:59
// rangeType=custom → 今天 - days 天 00:00:00 ~ 今天 23:59:59
```

所有趋势数据按**天**聚合（`DATE_TRUNC('day', ...)`），X 轴返回 `YYYY-MM-DD` 格式。

> 原来的 12 个月按月聚合逻辑保留为默认行为（`rangeType` 未传时等价于传 `month`），不破坏现有调用。

---

### 3.2 需改动的现有接口

#### `GET /api/v1/dashboard/conversation-trends`

**改动前：** 无参数，固定返回 12 个月数据，字段 `month`（`YYYY-MM`）  
**改动后：** 接收 `rangeType` + `days`，按天聚合，字段改为 `date`（`YYYY-MM-DD`）

响应结构（不变，只是 `month` 字段语义扩展为日期标签）：
```json
[
  { "month": "2026-07-01", "humanCount": 5, "aiCount": 12 },
  { "month": "2026-07-02", "humanCount": 3, "aiCount": 8 }
]
```

> 字段名仍用 `month` 以兼容前端现有类型定义，含义扩展为"时间标签"。

#### `GET /api/v1/dashboard/message-trends`

同上，相同改动逻辑。

#### `GET /api/v1/dashboard/overview`

**改动前：** 无参数，统计全量数据  
**改动后：** 接收 `rangeType` + `days`，三项效率均值限定在指定时间范围内计算

响应新增三个字段：
```json
{
  "avgWaitSeconds": 45,
  "avgHandleSeconds": 320,
  "avgFirstReplySeconds": 28
}
```

---

### 3.3 新增接口

#### `GET /api/v1/dashboard/efficiency-trends`

返回指定时间范围内，每天的三项效率均值：

**请求参数：** `rangeType`（默认 `month`）、`days`（`rangeType=custom` 时必填）

**响应：**
```json
[
  {
    "date": "2026-07-01",
    "avgWaitSeconds": 40,
    "avgHandleSeconds": 310,
    "avgFirstReplySeconds": 25
  }
]
```

**SQL 参考：**
```sql
SELECT
  DATE_TRUNC('day', accepted_at)::date AS date,
  COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at - started_at))), 0)   AS avg_wait_seconds,
  COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at - accepted_at))), 0)     AS avg_handle_seconds,
  COALESCE(AVG(EXTRACT(EPOCH FROM (first_reply_at - accepted_at))), 0) AS avg_first_reply_seconds
FROM conversation
WHERE accepted_at IS NOT NULL
  AND accepted_at >= :startDate
  AND accepted_at < :endDate
GROUP BY DATE_TRUNC('day', accepted_at)
ORDER BY date ASC
```

---

### 3.4 DashboardOverviewVO 新增字段（Java）

```java
/** 平均等待时长（秒），started_at → accepted_at */
private long avgWaitSeconds;

/** 平均处理时长（秒），accepted_at → ended_at */
private long avgHandleSeconds;

/** 平均首次回复时长（秒），accepted_at → first_reply_at */
private long avgFirstReplySeconds;
```

## 四、前端 API 层改动

文件：`apps/src/api/dashboard/index.ts`

### 4.1 新增类型

```ts
/** 时间范围选项 */
export type TimeRange = 'month' | 'week' | 'days7' | 'days30'

/** 时间范围请求参数 */
export interface TimeRangeParams {
  rangeType: 'month' | 'week' | 'custom'
  days?: number
}

/** 效率趋势数据项 */
export interface EfficiencyTrendItem {
  /** 日期标签，YYYY-MM-DD */
  date: string
  /** 平均等待时长（秒） */
  avgWaitSeconds: number
  /** 平均处理时长（秒） */
  avgHandleSeconds: number
  /** 平均首次回复时长（秒） */
  avgFirstReplySeconds: number
}
```

### 4.2 扩展 DashboardOverviewData

在现有接口类型中补充三个效率字段：

```ts
export interface DashboardOverviewData {
  // ... 现有字段不变 ...

  /** 平均等待时长（秒），范围内 accepted_at - started_at 均值 */
  avgWaitSeconds: number
  /** 平均处理时长（秒），范围内 ended_at - accepted_at 均值 */
  avgHandleSeconds: number
  /** 平均首次回复时长（秒），范围内 first_reply_at - accepted_at 均值 */
  avgFirstReplySeconds: number
}
```

### 4.3 工具函数：TimeRange → 后端参数转换

```ts
/** 将前端 TimeRange 枚举转换为后端 API 参数 */
export function toTimeRangeParams(range: TimeRange): TimeRangeParams {
  switch (range) {
    case 'month':  return { rangeType: 'month' }
    case 'week':   return { rangeType: 'week' }
    case 'days7':  return { rangeType: 'custom', days: 7 }
    case 'days30': return { rangeType: 'custom', days: 30 }
  }
}
```

### 4.4 改动现有 API 函数签名

```ts
/** 获取会话趋势（支持时间范围） */
export function getConversationTrendsApi(
  range: TimeRange = 'month',
): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/conversation-trends', {
    params: toTimeRangeParams(range),
  })
}

/** 获取消息量趋势（支持时间范围） */
export function getMessageTrendsApi(
  range: TimeRange = 'month',
): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/message-trends', {
    params: toTimeRangeParams(range),
  })
}

/** 获取概览指标（支持时间范围） */
export function getDashboardOverviewApi(
  range: TimeRange = 'month',
): Promise<DashboardOverviewData> {
  return rawRequestClient.get('/api/v1/dashboard/overview', {
    params: toTimeRangeParams(range),
  })
}
```

### 4.5 新增效率趋势 API 函数

```ts
/** 获取效率趋势（按天，支持时间范围） */
export function getEfficiencyTrendsApi(
  range: TimeRange = 'month',
): Promise<EfficiencyTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/efficiency-trends', {
    params: toTimeRangeParams(range),
  })
}
```

## 五、前端组件改动

### 5.1 新增：DashboardTimeRangeSelector 组件

**文件：** `apps/src/views/dashboard/analytics/dashboard-time-range-selector.vue`

```vue
<script lang="ts" setup>
import type { TimeRange } from '#/api/dashboard'

defineProps<{ modelValue: TimeRange }>()
defineEmits<{ 'update:modelValue': [val: TimeRange] }>()

const options = [
  { label: '本月', value: 'month' },
  { label: '本周', value: 'week' },
  { label: '近7天', value: 'days7' },
  { label: '近30天', value: 'days30' },
] as const
</script>

<template>
  <a-radio-group
    :value="modelValue"
    button-style="solid"
    size="small"
    @change="$emit('update:modelValue', $event.target.value)"
  >
    <a-radio-button v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </a-radio-button>
  </a-radio-group>
</template>
```

---

### 5.2 新增：AnalyticsEfficiencyTrends 组件

**文件：** `apps/src/views/dashboard/analytics/analytics-efficiency-trends.vue`

展示 3 条折线：平均等待时长（秒）/ 平均处理时长（秒）/ 平均首次回复时长（秒）

关键设计点：
- Y 轴单位为秒，tooltip 显示时格式化为"X 秒" 或"X 分 Y 秒"（≥60 秒时）
- 数据为空时显示"暂无数据"的空状态提示（通过 ECharts 的 `graphic` 配置实现）
- 使用与现有 `analytics-trends.vue` 一致的颜色风格和 grid 配置

颜色分配：
| 指标 | 颜色 |
|---|---|
| 平均等待时长 | `#5ab1ef` |
| 平均处理时长 | `#019680` |
| 平均首次回复 | `#b6a2de` |

---

### 5.3 修改：analytics-trends.vue

仅改动 props，接收父组件传入的数据（原有图表配置不变）：

**无需修改组件本身**，`analytics-trends.vue` 已通过 `watch(props.data)` 响应式渲染，父组件换新数据传入即可自动刷新。

---

### 5.4 修改：analytics-visits.vue（月消息量柱状图）

同上，已通过 `watch([props.months, props.counts])` 响应式。父组件传新数据即可，**无需修改**。

---

### 5.5 修改：index.vue（页面主文件）

**主要改动：**

1. **新增时间选择器状态和响应逻辑：**
```ts
import type { TimeRange } from '#/api/dashboard'
import { ref, watch } from 'vue'

const selectedRange = ref<TimeRange>('month')

// 监听时间范围变化，重新拉取所有趋势数据
watch(selectedRange, (range) => {
  fetchTrendData(range)
}, { immediate: false })

async function fetchTrendData(range: TimeRange) {
  const [convTrends, msgTrends, effTrends, overview] = await Promise.all([
    getConversationTrendsApi(range),
    getMessageTrendsApi(range),
    getEfficiencyTrendsApi(range),
    getDashboardOverviewApi(range),
  ])
  conversationTrends.value = convTrends
  messageTrends.value = msgTrends
  efficiencyTrends.value = effTrends
  // 刷新概览卡片（含效率均值）
  updateOverviewItems(overview)
}
```

2. **chartTabs 新增效率趋势 Tab：**
```ts
const chartTabs: TabOption[] = [
  { label: '会话趋势', value: 'trends' },
  { label: '月消息量', value: 'visits' },
  { label: '效率趋势', value: 'efficiency' }, // 新增
]
```

3. **概览卡片新增效率行（第二行 3 个卡片）：**
```ts
const efficiencyItems = computed(() => [
  {
    icon: SvgClockIcon,
    title: '平均等待',
    value: formatSeconds(overviewData.value?.avgWaitSeconds ?? 0),
  },
  {
    icon: SvgClockIcon,
    title: '平均处理',
    value: formatSeconds(overviewData.value?.avgHandleSeconds ?? 0),
  },
  {
    icon: SvgClockIcon,
    title: '首次回复',
    value: formatSeconds(overviewData.value?.avgFirstReplySeconds ?? 0),
  },
])
```

4. **模板中插入时间选择器和效率 Tab slot：**
```html
<template>
  <div class="p-5">
    <!-- 顶部：标题 + 时间选择器 -->
    <div class="flex items-center justify-between mb-4">
      <span class="text-lg font-semibold">分析概览</span>
      <DashboardTimeRangeSelector v-model="selectedRange" />
    </div>

    <AnalysisOverview :items="overviewItems" />

    <!-- 效率指标行 -->
    <div class="mt-4 grid grid-cols-3 gap-4">
      <EfficiencyStatCard v-for="item in efficiencyItems" :key="item.title" v-bind="item" />
    </div>

    <AnalysisChartsTabs :tabs="chartTabs" class="mt-5">
      <template #trends>
        <AnalyticsTrends :data="conversationTrends" />
      </template>
      <template #visits>
        <AnalyticsVisits
          :counts="messageTrends.map(i => i.aiCount + i.humanCount)"
          :months="messageTrends.map(i => i.month)"
        />
      </template>
      <template #efficiency>
        <AnalyticsEfficiencyTrends :data="efficiencyTrends" />
      </template>
    </AnalysisChartsTabs>

    <!-- 底部三卡片（不变） -->
    ...
  </div>
</template>
```

---

### 5.6 新增：EfficiencyStatCard 组件

**文件：** `apps/src/views/dashboard/analytics/efficiency-stat-card.vue`

轻量展示卡片，显示单个效率指标的均值，复用 Ant Design Vue 的 `<a-statistic>` 或自定义样式。

**辅助函数：**
```ts
/** 将秒数格式化为可读字符串，如 "1分32秒" 或 "45秒" */
export function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '--'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}
```

## 六、数据流与状态管理

### 6.1 整体数据流

```
用户切换时间选择器
        │
        ▼
selectedRange (ref<TimeRange>)  ← v-model 双向绑定
        │
        │ watch 触发
        ▼
fetchTrendData(range)
        │
        ├── getConversationTrendsApi(range)  ──► conversationTrends.value
        ├── getMessageTrendsApi(range)        ──► messageTrends.value
        ├── getEfficiencyTrendsApi(range)     ──► efficiencyTrends.value
        └── getDashboardOverviewApi(range)    ──► overviewData.value
                                                       │
                                              updateOverviewItems(overview)
                                                       │
                                              overviewItems.value（含效率均值卡片）
```

### 6.2 初始加载

页面 `onMounted` 时同时加载：
1. 趋势数据（调用 `fetchTrendData('month')`）
2. 快照数据（状态分布 / 标签分布 / 概览基础指标，这些不受时间范围影响）

```ts
onMounted(async () => {
  // 快照数据只加载一次
  const [statusDist, tagDist] = await Promise.all([
    getStatusDistributionApi(),
    getTagDistributionApi(),
  ])
  statusDistribution.value = statusDist
  tagDistribution.value = tagDist

  // 趋势数据根据默认时间范围加载
  await fetchTrendData('month')
})
```

### 6.3 请求竞态处理

用户快速切换时间范围时，可能出现旧请求比新请求晚返回的情况。  
处理方式：使用一个 `requestId` 计数器，只接受最新一次请求的结果：

```ts
let latestRequestId = 0

async function fetchTrendData(range: TimeRange) {
  const id = ++latestRequestId
  loading.value = true
  try {
    const [convTrends, msgTrends, effTrends, overview] = await Promise.all([...])
    if (id !== latestRequestId) return  // 丢弃过期请求结果
    // 更新数据...
  } finally {
    if (id === latestRequestId) loading.value = false
  }
}
```

### 6.4 loading 状态

- `loading` ref 控制图表区域的加载态
- 图表组件收到空数据时渲染空状态，收到真实数据后渲染图表
- 概览卡片在 loading 时显示 skeleton 效果（Ant Design Vue `<a-skeleton>` 或直接展示上一次数据）

### 6.5 错误处理

- API 请求失败时，通过 `message.error('数据加载失败，请重试')` 提示用户
- 图表数据清空为 `[]`，显示空状态
- loading 状态重置为 false，允许用户重新切换触发重试

## 七、实现注意事项

### 7.1 后端兼容性

- 新增参数均有默认值（`rangeType` 默认 `month`），现有前端调用无参数时行为不变
- 原有按月聚合 SQL 可保留作为 `rangeType=month` 时的逻辑分支，避免改动影响到数据一致性
- `ConversationTrendItem.month` 字段名保持不变（语义扩展为"时间标签"），不需要前端类型变更

### 7.2 X 轴时间标签格式

| rangeType | 返回格式 | 前端建议展示 |
|---|---|---|
| `month` | `YYYY-MM-DD` | `MM-DD`（去掉年份） |
| `week` | `YYYY-MM-DD` | `MM-DD`（7 个点） |
| `days7` | `YYYY-MM-DD` | `MM-DD` |
| `days30` | `YYYY-MM-DD` | `MM-DD` |

前端 ECharts 的 `xAxis.axisLabel.formatter` 统一处理：
```ts
axisLabel: {
  formatter: (val: string) => val.slice(5) // 取 MM-DD
}
```

### 7.3 效率指标的空数据情况

存量历史数据中 `accepted_at` / `first_reply_at` 为 NULL，效率均值接口会用 `IS NOT NULL` 过滤，可能导致某些日期没有数据点。

前端折线图需要处理稀疏数据（某天没有值）：
- ECharts `series.connectNulls: false` — 断开，不连接空值点（推荐，语义更准确）
- 或后端对缺失日期补 0（不推荐，会误导数据）

### 7.4 时间格式统一

效率趋势接口返回的 `date` 字段与趋势接口返回的 `month` 字段格式相同（`YYYY-MM-DD`），前端统一用 `.slice(5)` 截取 `MM-DD` 展示即可。

### 7.5 秒数显示精度

后端返回的均值是整数秒（`COALESCE(AVG(...), 0)` 四舍五入）。前端 `formatSeconds` 函数在展示时：
- `< 60 秒`：显示"X 秒"
- `≥ 60 秒`：显示"X 分 Y 秒"
- `= 0`：显示"--"（表示无数据）

### 7.6 文件改动汇总

**前端（本项目）需新增/修改的文件：**

| 文件 | 类型 |
|---|---|
| `apps/src/api/dashboard/index.ts` | 修改 |
| `apps/src/views/dashboard/analytics/index.vue` | 修改 |
| `apps/src/views/dashboard/analytics/dashboard-time-range-selector.vue` | 新增 |
| `apps/src/views/dashboard/analytics/analytics-efficiency-trends.vue` | 新增 |
| `apps/src/views/dashboard/analytics/efficiency-stat-card.vue` | 新增 |

**后端（`ai-customerservice-backend`）需修改的文件：**

| 文件 | 类型 |
|---|---|
| `DashboardController.java` | 修改（加 @RequestParam） |
| `DashboardAppService.java` | 修改（传递时间范围参数） |
| `DashboardStatsMapper.java` | 修改（改 SQL，新增效率趋势查询） |
| `DashboardStatsRepository.java` | 修改（封装新方法） |
| `DashboardOverviewVO.java` | 修改（补 3 个字段） |
| `EfficiencyTrendVO.java` | 新增 |

### 7.7 实现顺序建议

1. 后端先完成接口扩展并自测（可用 Postman 验证各 rangeType 返回数据正确）
2. 前端 API 层和类型定义（`index.ts` 改动）
3. `DashboardTimeRangeSelector` 组件（纯 UI，可独立开发）
4. `analytics-efficiency-trends.vue` 组件（可用 mock 数据开发）
5. `index.vue` 集成，联调
