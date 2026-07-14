# Dashboard 分析页时间范围筛选 + 效率趋势折线图 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/dashboard/analysis` 页增加全局时间范围选择器（本月/本周/近7天/近30天），让会话趋势、消息量、新增效率趋势三个图表以及概览效率均值随之刷新。

**Architecture:** 后端在现有 DashboardStatsMapper 中新增带日期参数的查询方法，通过 Repository → AppService → Controller 穿透时间范围参数；前端 API 层加 `toTimeRangeParams` 转换函数，`index.vue` 用 `watch` 监听 `selectedRange` 驱动并发请求刷新，新增 3 个纯展示子组件。

**Tech Stack:**
- 后端：Spring Boot 3、MyBatis、PostgreSQL 15（`DATE_TRUNC`/`EXTRACT(EPOCH FROM ...)`）、Lombok、Java 21 records
- 前端：Vue 3 Composition API、TypeScript、ECharts（via `@vben/plugins/echarts`）、Ant Design Vue（`a-radio-group`）、Vitest

## Global Constraints

- 后端项目路径：`/Users/lycodeing/IdeaProjects/ai-customerservice-backend/ai-conversation/conversation-service/src/main/java/com/aria/conversation`
- 前端项目路径：`/Users/lycodeing/WebstormProjects/aria-frontend/apps/src`
- `ConversationTrendItemVO.month` 字段名保持不变（值从 `YYYY-MM` 扩展为 `YYYY-MM-DD`），不破坏前端现有类型
- `rangeType` 默认值为 `month`，无参调用行为不变
- 所有趋势数据按**天**聚合（不再按月），X 轴返回 `YYYY-MM-DD`
- 前端提交必须通过 pre-commit hook（typecheck + lint），使用 `git add <具体文件>` 而非 `git add .`

---

### Task 1: 后端 — 新增 EfficiencyTrendItemVO + 扩展 DashboardStatsMapper

**Files:**
- Create: `interfaces/rest/vo/EfficiencyTrendItemVO.java`
- Modify: `infrastructure/persistence/mapper/DashboardStatsMapper.java`

**Interfaces:**
- Produces: `EfficiencyTrendItemVO`（`date`/`avgWaitSeconds`/`avgHandleSeconds`/`avgFirstReplySeconds`）供 Task 2 使用
- Produces: `getConversationTrendsByRange(startDate, endDate)`、`getMessageTrendsByRange(startDate, endDate)`、`getEfficiencyTrends(startDate, endDate)` 供 Task 2 使用

- [ ] **Step 1: 创建 EfficiencyTrendItemVO**

文件：`interfaces/rest/vo/EfficiencyTrendItemVO.java`

```java
package com.aria.conversation.interfaces.rest.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 效率趋势数据项 VO（按天聚合）。
 * 用于前端效率趋势折线图，展示每天的三项响应时效均值。
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EfficiencyTrendItemVO {

    /** 日期标签，格式 YYYY-MM-DD */
    private String date;

    /** 平均等待时长（秒），accepted_at - started_at */
    private long avgWaitSeconds;

    /** 平均处理时长（秒），ended_at - accepted_at */
    private long avgHandleSeconds;

    /** 平均首次回复时长（秒），first_reply_at - accepted_at */
    private long avgFirstReplySeconds;
}
```

- [ ] **Step 2: 在 DashboardStatsMapper 中新增带日期参数的趋势方法**

在 `DashboardStatsMapper.java` 末尾追加以下 3 个方法（保留原有 `getMonthlyTrends` 和 `getMonthlyMessageTrends` 不动）：

```java
import java.time.LocalDate;

// 在文件 import 区加上：
// import java.time.LocalDate;

/** 按天聚合会话趋势（支持时间范围） */
@Select("""
        SELECT
            TO_CHAR(DATE_TRUNC('day', started_at), 'YYYY-MM-DD')       AS month,
            COUNT(*) FILTER (WHERE agent_id IS NOT NULL)                AS "humanCount",
            COUNT(*) FILTER (WHERE agent_id IS NULL)                    AS "aiCount"
        FROM cs_conversation.cs_conversation
        WHERE started_at >= #{startDate}::date
          AND started_at < #{endDate}::date + INTERVAL '1 day'
        GROUP BY DATE_TRUNC('day', started_at)
        ORDER BY month
        """)
List<ConversationTrendItemVO> getConversationTrendsByRange(
        @Param("startDate") LocalDate startDate,
        @Param("endDate")   LocalDate endDate);

/** 按天聚合消息量趋势（支持时间范围） */
@Select("""
        SELECT
            TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD')  AS month,
            COUNT(*) FILTER (WHERE role = 'agent')                 AS "humanCount",
            COUNT(*) FILTER (WHERE role = 'assistant')             AS "aiCount"
        FROM cs_conversation.cs_conversation_message
        WHERE created_at >= #{startDate}::date
          AND created_at < #{endDate}::date + INTERVAL '1 day'
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY month
        """)
List<ConversationTrendItemVO> getMessageTrendsByRange(
        @Param("startDate") LocalDate startDate,
        @Param("endDate")   LocalDate endDate);

/** 按天聚合效率趋势（支持时间范围） */
@Select("""
        SELECT
            TO_CHAR(DATE_TRUNC('day', accepted_at), 'YYYY-MM-DD')                                     AS date,
            COALESCE(EXTRACT(EPOCH FROM AVG(accepted_at - started_at))::bigint,   0) AS "avgWaitSeconds",
            COALESCE(EXTRACT(EPOCH FROM AVG(ended_at - accepted_at))::bigint,     0) AS "avgHandleSeconds",
            COALESCE(EXTRACT(EPOCH FROM AVG(first_reply_at - accepted_at))::bigint, 0) AS "avgFirstReplySeconds"
        FROM cs_conversation.cs_conversation
        WHERE accepted_at IS NOT NULL
          AND accepted_at >= #{startDate}::date
          AND accepted_at < #{endDate}::date + INTERVAL '1 day'
        GROUP BY DATE_TRUNC('day', accepted_at)
        ORDER BY date
        """)
List<EfficiencyTrendItemVO> getEfficiencyTrends(
        @Param("startDate") LocalDate startDate,
        @Param("endDate")   LocalDate endDate);
```

补全 import（Mapper 文件顶部）：
```java
import com.aria.conversation.interfaces.rest.vo.EfficiencyTrendItemVO;
import java.time.LocalDate;
```

- [ ] **Step 3: 编译验证**

```bash
cd /Users/lycodeing/IdeaProjects/ai-customerservice-backend
mvn compile -pl ai-conversation/conversation-service -am -q
```

期望：`BUILD SUCCESS`，无 error。

- [ ] **Step 4: 提交**

```bash
cd /Users/lycodeing/IdeaProjects/ai-customerservice-backend
git add ai-conversation/conversation-service/src/main/java/com/aria/conversation/interfaces/rest/vo/EfficiencyTrendItemVO.java
git add ai-conversation/conversation-service/src/main/java/com/aria/conversation/infrastructure/persistence/mapper/DashboardStatsMapper.java
git commit -m "feat(dashboard): 新增 EfficiencyTrendItemVO，DashboardStatsMapper 加按天趋势查询"
```

### Task 2: 后端 — DashboardStatsRepository + DashboardAppService 扩展

**Files:**
- Modify: `infrastructure/persistence/DashboardStatsRepository.java`
- Modify: `application/service/DashboardAppService.java`

**Interfaces:**
- Consumes: `getConversationTrendsByRange(LocalDate, LocalDate)`、`getMessageTrendsByRange(LocalDate, LocalDate)`、`getEfficiencyTrends(LocalDate, LocalDate)` from Task 1
- Produces: `DashboardAppService.getConversationTrends(String rangeType, Integer days)` → `List<ConversationTrendItemVO>`
- Produces: `DashboardAppService.getMessageTrends(String rangeType, Integer days)` → `List<ConversationTrendItemVO>`
- Produces: `DashboardAppService.getEfficiencyTrends(String rangeType, Integer days)` → `List<EfficiencyTrendItemVO>`
- Produces: `DashboardAppService.getOverview(String rangeType, Integer days)` 与原签名保持兼容（新增重载）

- [ ] **Step 1: 在 DashboardStatsRepository 新增委托方法**

在 `DashboardStatsRepository.java` 中追加：

```java
import com.aria.conversation.interfaces.rest.vo.EfficiencyTrendItemVO;
import java.time.LocalDate;

// 在类体末尾追加：

public List<ConversationTrendItemVO> getConversationTrendsByRange(LocalDate startDate, LocalDate endDate) {
    return statsMapper.getConversationTrendsByRange(startDate, endDate);
}

public List<ConversationTrendItemVO> getMessageTrendsByRange(LocalDate startDate, LocalDate endDate) {
    return statsMapper.getMessageTrendsByRange(startDate, endDate);
}

public List<EfficiencyTrendItemVO> getEfficiencyTrends(LocalDate startDate, LocalDate endDate) {
    return statsMapper.getEfficiencyTrends(startDate, endDate);
}
```

- [ ] **Step 2: 在 DashboardAppService 新增 RangeResolver 私有方法**

在 `DashboardAppService.java` 中新增私有内部帮助方法 + 公开趋势方法：

```java
import com.aria.conversation.interfaces.rest.vo.EfficiencyTrendItemVO;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;

// ---- 追加到类体 ----

/**
 * 将前端 rangeType/days 参数解析为 [startDate, endDate]（含两端）。
 * rangeType=month  → 本月第一天 ~ 今天
 * rangeType=week   → 本周一 ~ 今天
 * rangeType=custom → 今天-days+1 ~ 今天（days 默认 7）
 */
private LocalDate[] resolveRange(String rangeType, Integer days) {
    LocalDate today = LocalDate.now();
    LocalDate start = switch (rangeType == null ? "month" : rangeType) {
        case "week"   -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        case "custom" -> today.minusDays(Math.max(1, days == null ? 7 : days) - 1);
        default       -> today.withDayOfMonth(1); // month
    };
    return new LocalDate[]{start, today};
}

public List<ConversationTrendItemVO> getConversationTrends(String rangeType, Integer days) {
    LocalDate[] range = resolveRange(rangeType, days);
    return statsRepository.getConversationTrendsByRange(range[0], range[1]);
}

public List<ConversationTrendItemVO> getMessageTrends(String rangeType, Integer days) {
    LocalDate[] range = resolveRange(rangeType, days);
    return statsRepository.getMessageTrendsByRange(range[0], range[1]);
}

public List<EfficiencyTrendItemVO> getEfficiencyTrends(String rangeType, Integer days) {
    LocalDate[] range = resolveRange(rangeType, days);
    return statsRepository.getEfficiencyTrends(range[0], range[1]);
}
```

> 原有无参 `getConversationTrends()` / `getMessageTrends()` 保留，但实现改为调用带参版本：
```java
public List<ConversationTrendItemVO> getConversationTrends() {
    return getConversationTrends("month", null);
}

public List<ConversationTrendItemVO> getMessageTrends() {
    return getMessageTrends("month", null);
}
```

- [ ] **Step 3: 编译验证**

```bash
cd /Users/lycodeing/IdeaProjects/ai-customerservice-backend
mvn compile -pl ai-conversation/conversation-service -am -q
```

期望：`BUILD SUCCESS`

- [ ] **Step 4: 提交**

```bash
cd /Users/lycodeing/IdeaProjects/ai-customerservice-backend
git add ai-conversation/conversation-service/src/main/java/com/aria/conversation/infrastructure/persistence/DashboardStatsRepository.java
git add ai-conversation/conversation-service/src/main/java/com/aria/conversation/application/service/DashboardAppService.java
git commit -m "feat(dashboard): Repository/AppService 扩展时间范围参数，新增 getEfficiencyTrends"
```

### Task 3: 后端 — DashboardController 扩展时间范围参数 + 新增效率趋势端点

**Files:**
- Modify: `interfaces/rest/DashboardController.java`

**Interfaces:**
- Consumes: `DashboardAppService.getConversationTrends(String, Integer)` from Task 2
- Consumes: `DashboardAppService.getMessageTrends(String, Integer)` from Task 2
- Consumes: `DashboardAppService.getEfficiencyTrends(String, Integer)` from Task 2
- Produces: `GET /api/v1/dashboard/conversation-trends?rangeType=month&days=7`
- Produces: `GET /api/v1/dashboard/message-trends?rangeType=week`
- Produces: `GET /api/v1/dashboard/efficiency-trends?rangeType=custom&days=30`

- [ ] **Step 1: 修改 DashboardController**

将 `DashboardController.java` 中的三个方法替换为带参版本，并新增 `/efficiency-trends` 端点：

```java
import com.aria.conversation.interfaces.rest.vo.EfficiencyTrendItemVO;

// 替换原有 getConversationTrends()：
@GetMapping("/conversation-trends")
public R<List<ConversationTrendItemVO>> getConversationTrends(
        @RequestParam(name = "rangeType", defaultValue = "month") String rangeType,
        @RequestParam(name = "days",      required = false)        Integer days) {
    return R.ok(dashboardAppService.getConversationTrends(rangeType, days));
}

// 替换原有 getMessageTrends()：
@GetMapping("/message-trends")
public R<List<ConversationTrendItemVO>> getMessageTrends(
        @RequestParam(name = "rangeType", defaultValue = "month") String rangeType,
        @RequestParam(name = "days",      required = false)        Integer days) {
    return R.ok(dashboardAppService.getMessageTrends(rangeType, days));
}

// 新增：
@GetMapping("/efficiency-trends")
public R<List<EfficiencyTrendItemVO>> getEfficiencyTrends(
        @RequestParam(name = "rangeType", defaultValue = "month") String rangeType,
        @RequestParam(name = "days",      required = false)        Integer days) {
    return R.ok(dashboardAppService.getEfficiencyTrends(rangeType, days));
}
```

> `getOverview()` 和其余端点保持不变（overview 的效率均值是全量统计，不随时间范围变化，符合非目标约定）。

- [ ] **Step 2: 编译验证**

```bash
cd /Users/lycodeing/IdeaProjects/ai-customerservice-backend
mvn compile -pl ai-conversation/conversation-service -am -q
```

期望：`BUILD SUCCESS`

- [ ] **Step 3: 手动冒烟测试（需后端服务运行）**

如果后端服务在运行，用 curl 验证三个场景：

```bash
# 本月（默认）
curl -s "http://localhost:8082/api/v1/dashboard/conversation-trends" | jq '.[0].month'
# 期望：YYYY-MM-DD 格式，如 "2026-07-01"

# 本周
curl -s "http://localhost:8082/api/v1/dashboard/conversation-trends?rangeType=week" | jq 'length'
# 期望：1-7 之间的数字

# 效率趋势 近7天
curl -s "http://localhost:8082/api/v1/dashboard/efficiency-trends?rangeType=custom&days=7" | jq '.[0]'
# 期望：包含 date / avgWaitSeconds / avgHandleSeconds / avgFirstReplySeconds 字段
```

如果后端服务未运行，跳过此步，在联调阶段验证。

- [ ] **Step 4: 提交**

```bash
cd /Users/lycodeing/IdeaProjects/ai-customerservice-backend
git add ai-conversation/conversation-service/src/main/java/com/aria/conversation/interfaces/rest/DashboardController.java
git commit -m "feat(dashboard): Controller 加时间范围参数，新增 /efficiency-trends 端点"
```

### Task 4: 前端 — API 层扩展（类型 + 工具函数 + 接口函数）

**Files:**
- Modify: `api/dashboard/index.ts`

**Interfaces:**
- Produces: `type TimeRange = 'month' | 'week' | 'days7' | 'days30'`
- Produces: `toTimeRangeParams(range: TimeRange): TimeRangeParams`
- Produces: `getConversationTrendsApi(range?: TimeRange): Promise<ConversationTrendItem[]>`
- Produces: `getMessageTrendsApi(range?: TimeRange): Promise<ConversationTrendItem[]>`
- Produces: `getDashboardOverviewApi(range?: TimeRange): Promise<DashboardOverviewData>`（签名兼容原有无参调用）
- Produces: `getEfficiencyTrendsApi(range?: TimeRange): Promise<EfficiencyTrendItem[]>`
- Produces: `interface EfficiencyTrendItem` 供 Task 7 使用

- [ ] **Step 1: 修改 `apps/src/api/dashboard/index.ts`**

用以下完整内容替换该文件（保留所有原有类型和函数，只做增量改动）：

```ts
/**
 * Dashboard 统计 API。
 *
 * 所有接口走 vite proxy 的 /api/v1/dashboard/** 路径，
 * 由 conversation-service (8082) 提供服务，需 Sa-Token 登录。
 */
import { rawRequestClient } from '#/api/request';

// ─── 时间范围 ────────────────────────────────────────────────────────────────

/** 前端时间范围枚举 */
export type TimeRange = 'month' | 'week' | 'days7' | 'days30';

/** 后端时间范围请求参数 */
export interface TimeRangeParams {
  rangeType: 'custom' | 'month' | 'week';
  days?: number;
}

/** 将前端 TimeRange 枚举转换为后端 API 参数 */
export function toTimeRangeParams(range: TimeRange): TimeRangeParams {
  switch (range) {
    case 'month': {
      return { rangeType: 'month' };
    }
    case 'week': {
      return { rangeType: 'week' };
    }
    case 'days7': {
      return { rangeType: 'custom', days: 7 };
    }
    case 'days30': {
      return { rangeType: 'custom', days: 30 };
    }
  }
}

// ─── 数据类型 ────────────────────────────────────────────────────────────────

/** 概览指标 */
export interface DashboardOverviewData {
  /** 今日会话量 */
  todayConversationCount: number;
  /** 总会话量 */
  totalConversationCount: number;
  /** 当前进行中会话数（ACTIVE） */
  activeConversationCount: number;
  /** 当前等待接入会话数（WAITING） */
  waitingConversationCount: number;
  /** 总用户数 */
  totalUserCount: number;
  /** 总消息数 */
  totalMessageCount: number;
  /** AI 回复消息数 */
  aiMessageCount: number;
  /** 人工座席回复消息数 */
  agentMessageCount: number;
  /** 平均等待时长（秒），accepted_at - started_at */
  avgWaitSeconds: number;
  /** 平均处理时长（秒），ended_at - accepted_at */
  avgHandleSeconds: number;
  /** 平均首次回复时长（秒），first_reply_at - accepted_at */
  avgFirstReplySeconds: number;
}

/** 会话趋势数据项（month 字段值为 YYYY-MM-DD 日期标签） */
export interface ConversationTrendItem {
  /** 时间标签，如 "2026-07-01" */
  month: string;
  /** 人工会话数 */
  humanCount: number;
  /** AI 会话数 */
  aiCount: number;
}

/** 效率趋势数据项（按天聚合） */
export interface EfficiencyTrendItem {
  /** 日期标签，YYYY-MM-DD */
  date: string;
  /** 平均等待时长（秒） */
  avgWaitSeconds: number;
  /** 平均处理时长（秒） */
  avgHandleSeconds: number;
  /** 平均首次回复时长（秒） */
  avgFirstReplySeconds: number;
}

/** 状态分布数据项 */
export interface StatusDistributionItem {
  status: string;
  count: number;
}

/** 标签分布数据项 */
export interface TagDistributionItem {
  tag: string;
  count: number;
}

/** 最近会话项 */
export interface RecentSessionItem {
  sessionId: string;
  visitorName: string;
  tag: null | string;
  transferReason: null | string;
  status: string;
  agentId: null | string;
  startedAt: string;
  endedAt: null | string;
  messageCount: number;
}

/** 座席工作量项 */
export interface AgentWorkloadItem {
  agentId: string;
  totalSessions: number;
  activeSessions: number;
}

// ─── API 函数 ─────────────────────────────────────────────────────────────────

/** 获取概览指标 */
export function getDashboardOverviewApi(): Promise<DashboardOverviewData> {
  return rawRequestClient.get('/api/v1/dashboard/overview');
}

/** 获取会话趋势（按天，支持时间范围） */
export function getConversationTrendsApi(
  range: TimeRange = 'month',
): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/conversation-trends', {
    params: toTimeRangeParams(range),
  });
}

/** 获取消息量趋势（按天，支持时间范围） */
export function getMessageTrendsApi(
  range: TimeRange = 'month',
): Promise<ConversationTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/message-trends', {
    params: toTimeRangeParams(range),
  });
}

/** 获取效率趋势（按天，支持时间范围） */
export function getEfficiencyTrendsApi(
  range: TimeRange = 'month',
): Promise<EfficiencyTrendItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/efficiency-trends', {
    params: toTimeRangeParams(range),
  });
}

/** 获取会话状态分布 */
export function getStatusDistributionApi(): Promise<StatusDistributionItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/status-distribution');
}

/** 获取问题标签分布 */
export function getTagDistributionApi(): Promise<TagDistributionItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/tag-distribution');
}

/** 获取最近会话列表 */
export function getRecentSessionsApi(limit = 10): Promise<RecentSessionItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/recent-sessions', {
    params: { limit },
  });
}

/** 获取座席工作量统计 */
export function getAgentWorkloadApi(): Promise<AgentWorkloadItem[]> {
  return rawRequestClient.get('/api/v1/dashboard/agent-workload');
}
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
pnpm --filter @vben/web-antd typecheck 2>&1 | tail -20
```

期望：无新增类型错误（若有来自其他文件的旧错误可忽略，只关注 `api/dashboard/index.ts`）。

- [ ] **Step 3: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/api/dashboard/index.ts
git commit -m "feat(dashboard): API 层加 TimeRange 类型、toTimeRangeParams、EfficiencyTrendItem 及新接口函数"
```

### Task 5: 前端 — DashboardTimeRangeSelector 组件

**Files:**
- Create: `views/dashboard/analytics/dashboard-time-range-selector.vue`

**Interfaces:**
- Consumes: `type TimeRange` from `#/api/dashboard`
- Produces: `<DashboardTimeRangeSelector v-model="selectedRange" />` 供 Task 8 使用

- [ ] **Step 1: 创建组件文件**

文件：`apps/src/views/dashboard/analytics/dashboard-time-range-selector.vue`

```vue
<script lang="ts" setup>
import type { TimeRange } from '#/api/dashboard';

defineProps<{ modelValue: TimeRange }>();
defineEmits<{ 'update:modelValue': [val: TimeRange] }>();

const options = [
  { label: '本月', value: 'month' },
  { label: '本周', value: 'week' },
  { label: '近7天', value: 'days7' },
  { label: '近30天', value: 'days30' },
] as const satisfies ReadonlyArray<{ label: string; value: TimeRange }>;
</script>

<template>
  <a-radio-group
    :value="modelValue"
    button-style="solid"
    size="small"
    @change="$emit('update:modelValue', ($event.target as HTMLInputElement).value as TimeRange)"
  >
    <a-radio-button v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </a-radio-button>
  </a-radio-group>
</template>
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
pnpm --filter @vben/web-antd typecheck 2>&1 | grep -E "error|dashboard-time-range" | head -20
```

期望：无新增类型错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/dashboard/analytics/dashboard-time-range-selector.vue
git commit -m "feat(dashboard): 新增 DashboardTimeRangeSelector 时间范围选择器组件"
```

### Task 6: 前端 — EfficiencyStatCard 组件 + formatSeconds 工具函数

**Files:**
- Create: `views/dashboard/analytics/efficiency-stat-card.vue`
- Create: `views/dashboard/analytics/format-seconds.ts`

**Interfaces:**
- Produces: `formatSeconds(seconds: number): string` 供 Task 7、Task 8 使用
- Produces: `<EfficiencyStatCard title="平均等待" :value="45" />` 供 Task 8 使用

- [ ] **Step 1: 创建 formatSeconds 工具函数**

文件：`apps/src/views/dashboard/analytics/format-seconds.ts`

```ts
/**
 * 将秒数格式化为人类可读字符串。
 * - 0 或负数 → '--'
 * - < 60 秒  → '45秒'
 * - ≥ 60 秒  → '1分32秒'
 */
export function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
```

- [ ] **Step 2: 创建 EfficiencyStatCard 组件**

文件：`apps/src/views/dashboard/analytics/efficiency-stat-card.vue`

```vue
<script lang="ts" setup>
defineProps<{
  /** 指标名称，如"平均等待" */
  title: string;
  /** 已格式化的值字符串，如"45秒"或"--" */
  value: string;
}>();
</script>

<template>
  <div class="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
    <p class="text-muted-foreground text-sm">{{ title }}</p>
    <p class="mt-1 text-2xl font-semibold tabular-nums">{{ value }}</p>
  </div>
</template>
```

- [ ] **Step 3: TypeScript 类型检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
pnpm --filter @vben/web-antd typecheck 2>&1 | grep -E "error|efficiency-stat" | head -20
```

期望：无新增类型错误。

- [ ] **Step 4: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/dashboard/analytics/format-seconds.ts
git add apps/src/views/dashboard/analytics/efficiency-stat-card.vue
git commit -m "feat(dashboard): 新增 EfficiencyStatCard 组件和 formatSeconds 工具函数"
```

### Task 7: 前端 — AnalyticsEfficiencyTrends 效率趋势折线图组件

**Files:**
- Create: `views/dashboard/analytics/analytics-efficiency-trends.vue`

**Interfaces:**
- Consumes: `interface EfficiencyTrendItem` from `#/api/dashboard`
- Consumes: `formatSeconds(seconds: number): string` from `./format-seconds`
- Produces: `<AnalyticsEfficiencyTrends :data="efficiencyTrends" />` 供 Task 8 使用

- [ ] **Step 1: 创建效率趋势折线图组件**

文件：`apps/src/views/dashboard/analytics/analytics-efficiency-trends.vue`

```vue
<script lang="ts" setup>
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { EfficiencyTrendItem } from '#/api/dashboard';

import { ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { formatSeconds } from './format-seconds';

const props = defineProps<{
  /** 效率趋势数据（按天，区分三项指标） */
  data?: EfficiencyTrendItem[];
}>();

const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);

function render(data: EfficiencyTrendItem[] = []) {
  const dates = data.map((item) => item.date.slice(5)); // MM-DD
  const waitData = data.map((item) => item.avgWaitSeconds || null);
  const handleData = data.map((item) => item.avgHandleSeconds || null);
  const replyData = data.map((item) => item.avgFirstReplySeconds || null);
  const allVals = [...waitData, ...handleData, ...replyData].filter(
    (v): v is number => v !== null,
  );
  const maxVal = Math.max(1, ...allVals);

  renderEcharts({
    grid: {
      bottom: 0,
      containLabel: true,
      left: '1%',
      right: '1%',
      top: '2%',
    },
    legend: {
      bottom: 0,
      data: ['平均等待', '平均处理', '首次回复'],
    },
    series: [
      {
        areaStyle: { opacity: 0.1 },
        connectNulls: false,
        data: waitData,
        itemStyle: { color: '#5ab1ef' },
        name: '平均等待',
        smooth: true,
        type: 'line',
      },
      {
        areaStyle: { opacity: 0.1 },
        connectNulls: false,
        data: handleData,
        itemStyle: { color: '#019680' },
        name: '平均处理',
        smooth: true,
        type: 'line',
      },
      {
        areaStyle: { opacity: 0.1 },
        connectNulls: false,
        data: replyData,
        itemStyle: { color: '#b6a2de' },
        name: '首次回复',
        smooth: true,
        type: 'line',
      },
    ],
    tooltip: {
      axisPointer: {
        lineStyle: { color: '#019680', width: 1 },
      },
      formatter(params: any) {
        const lines = (Array.isArray(params) ? params : [params])
          .filter((p: any) => p.value !== null)
          .map((p: any) => `${p.marker}${p.seriesName}: ${formatSeconds(p.value as number)}`);
        return lines.length > 0
          ? `${(params as any[])[0]?.axisValue ?? ''}<br/>${lines.join('<br/>')}`
          : '';
      },
      trigger: 'axis',
    },
    xAxis: {
      axisTick: { show: false },
      boundaryGap: false,
      data: dates,
      splitLine: {
        lineStyle: { type: 'solid', width: 1 },
        show: true,
      },
      type: 'category',
    },
    yAxis: [
      {
        axisTick: { show: false },
        axisLabel: {
          formatter: (val: number) => formatSeconds(val),
        },
        max: Math.ceil(maxVal * 1.2),
        splitArea: { show: true },
        splitNumber: 4,
        type: 'value',
      },
    ],
  });
}

watch(
  () => props.data,
  (val) => render(val ?? []),
  { immediate: true },
);
</script>

<template>
  <EchartsUI ref="chartRef" />
</template>
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
pnpm --filter @vben/web-antd typecheck 2>&1 | grep -E "error|efficiency-trends" | head -20
```

期望：无新增类型错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/dashboard/analytics/analytics-efficiency-trends.vue
git commit -m "feat(dashboard): 新增 AnalyticsEfficiencyTrends 效率趋势折线图组件"
```

### Task 8: 前端 — index.vue 集成（时间选择器 + 效率卡片 + 效率 Tab）

**Files:**
- Modify: `views/dashboard/analytics/index.vue`

**Interfaces:**
- Consumes: `DashboardTimeRangeSelector` from Task 5
- Consumes: `EfficiencyStatCard` from Task 6
- Consumes: `formatSeconds` from Task 6
- Consumes: `AnalyticsEfficiencyTrends` from Task 7
- Consumes: `getConversationTrendsApi`, `getMessageTrendsApi`, `getEfficiencyTrendsApi`, `getDashboardOverviewApi`, `type TimeRange`, `type EfficiencyTrendItem` from Task 4

- [ ] **Step 1: 用以下完整内容替换 `apps/src/views/dashboard/analytics/index.vue`**

```vue
<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui';
import type { TabOption } from '@vben/types';

import type {
  ConversationTrendItem,
  DashboardOverviewData,
  EfficiencyTrendItem,
  StatusDistributionItem,
  TagDistributionItem,
  TimeRange,
} from '#/api/dashboard';

import { computed, onMounted, ref, watch } from 'vue';

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
import { message } from 'ant-design-vue';

import {
  getConversationTrendsApi,
  getDashboardOverviewApi,
  getEfficiencyTrendsApi,
  getMessageTrendsApi,
  getStatusDistributionApi,
  getTagDistributionApi,
} from '#/api/dashboard';

import AnalyticsEfficiencyTrends from './analytics-efficiency-trends.vue';
import AnalyticsTrends from './analytics-trends.vue';
import AnalyticsVisitsData from './analytics-visits-data.vue';
import AnalyticsVisitsSales from './analytics-visits-sales.vue';
import AnalyticsVisitsSource from './analytics-visits-source.vue';
import AnalyticsVisits from './analytics-visits.vue';
import DashboardTimeRangeSelector from './dashboard-time-range-selector.vue';
import EfficiencyStatCard from './efficiency-stat-card.vue';
import { formatSeconds } from './format-seconds';

// ─── 时间范围 ─────────────────────────────────────────────────────────────────
const selectedRange = ref<TimeRange>('month');

// ─── 概览卡片（响应式，初始空数据，API 返回后更新） ────────────────────────────
const overviewItems = ref<AnalysisOverviewItem[]>([
  {
    icon: SvgCardIcon,
    title: '今日会话量',
    totalTitle: '总会话量',
    totalValue: 0,
    value: 0,
  },
  {
    icon: SvgCakeIcon,
    title: '活跃会话',
    totalTitle: '等待接入',
    totalValue: 0,
    value: 0,
  },
  {
    icon: SvgDownloadIcon,
    title: '总消息数',
    totalTitle: 'AI 回复',
    totalValue: 0,
    value: 0,
  },
  {
    icon: SvgBellIcon,
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

// ─── 效率均值卡片（computed，随 overviewData 变化） ────────────────────────────
const efficiencyCards = computed(() => [
  {
    title: '平均等待时长',
    value: formatSeconds(overviewData.value?.avgWaitSeconds ?? 0),
  },
  {
    title: '平均处理时长',
    value: formatSeconds(overviewData.value?.avgHandleSeconds ?? 0),
  },
  {
    title: '首次回复时长',
    value: formatSeconds(overviewData.value?.avgFirstReplySeconds ?? 0),
  },
]);

// ─── 请求竞态保护 ──────────────────────────────────────────────────────────────
let latestRequestId = 0;
const trendsLoading = ref(false);

function updateOverviewItems(data: DashboardOverviewData) {
  overviewItems.value = [
    {
      icon: SvgCardIcon,
      title: '今日会话量',
      totalTitle: '总会话量',
      totalValue: data.totalConversationCount,
      value: data.todayConversationCount,
    },
    {
      icon: SvgCakeIcon,
      title: '活跃会话',
      totalTitle: '等待接入',
      totalValue: data.waitingConversationCount,
      value: data.activeConversationCount,
    },
    {
      icon: SvgDownloadIcon,
      title: '总消息数',
      totalTitle: 'AI 回复',
      totalValue: data.aiMessageCount,
      value: data.totalMessageCount,
    },
    {
      icon: SvgBellIcon,
      title: '总用户数',
      totalTitle: '人工回复',
      totalValue: data.agentMessageCount,
      value: data.totalUserCount,
    },
  ];
}

async function fetchTrendData(range: TimeRange) {
  const id = ++latestRequestId;
  trendsLoading.value = true;
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
  } catch {
    if (id !== latestRequestId) return;
    message.error('数据加载失败，请重试');
    conversationTrends.value = [];
    messageTrends.value = [];
    efficiencyTrends.value = [];
  } finally {
    if (id === latestRequestId) trendsLoading.value = false;
  }
}

// 切换时间范围时刷新趋势数据
watch(selectedRange, (range) => {
  fetchTrendData(range);
});

onMounted(async () => {
  // 快照数据只加载一次（不受时间范围影响）
  const [statusDist, tagDist] = await Promise.all([
    getStatusDistributionApi(),
    getTagDistributionApi(),
  ]);
  statusDistribution.value = statusDist;
  tagDistribution.value = tagDist;

  // 趋势数据按默认时间范围加载
  await fetchTrendData('month');
});
</script>

<template>
  <div class="p-5">
    <!-- 顶部：标题 + 时间范围选择器 -->
    <div class="mb-4 flex items-center justify-between">
      <span class="text-lg font-semibold">分析概览</span>
      <DashboardTimeRangeSelector v-model="selectedRange" />
    </div>

    <!-- 概览指标卡片 -->
    <AnalysisOverview :items="overviewItems" />

    <!-- 效率均值卡片行 -->
    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
      <EfficiencyStatCard
        v-for="card in efficiencyCards"
        :key="card.title"
        :title="card.title"
        :value="card.value"
      />
    </div>

    <!-- 趋势图 Tab -->
    <AnalysisChartsTabs :tabs="chartTabs" class="mt-5">
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
    <div class="mt-5 w-full md:flex">
      <AnalysisChartCard class="mt-5 md:mt-0 md:mr-4 md:w-1/3" title="指标雷达">
        <AnalyticsVisitsData :data="overviewData" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:mr-4 md:w-1/3" title="会话状态">
        <AnalyticsVisitsSource :data="statusDistribution" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:w-1/3" title="问题标签">
        <AnalyticsVisitsSales :data="tagDistribution" />
      </AnalysisChartCard>
    </div>
  </div>
</template>
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
pnpm --filter @vben/web-antd typecheck 2>&1 | tail -30
```

期望：`Found 0 errors.` 或只有与本次改动无关的预存错误。

- [ ] **Step 3: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/dashboard/analytics/index.vue
git commit -m "feat(dashboard): analytics 页集成时间范围选择器、效率卡片和效率趋势 Tab"
```

---

## 自检清单（Spec Coverage）

| 设计文档要求 | 对应 Task | 状态 |
|---|---|---|
| 后端 `EfficiencyTrendItemVO` 新增 | Task 1 | ✓ |
| `DashboardStatsMapper` 新增按天趋势查询 | Task 1 | ✓ |
| `DashboardStatsRepository` 委托新方法 | Task 2 | ✓ |
| `DashboardAppService` 时间范围解析 + 新增 `getEfficiencyTrends` | Task 2 | ✓ |
| `DashboardController` 加 `rangeType/days` 参数 + `/efficiency-trends` 端点 | Task 3 | ✓ |
| 前端 `TimeRange` 类型 + `toTimeRangeParams` + `EfficiencyTrendItem` | Task 4 | ✓ |
| `DashboardOverviewData` 补 3 个效率字段 | Task 4 | ✓ |
| 现有 API 函数加 `range` 参数（默认 `'month'`，向后兼容） | Task 4 | ✓ |
| `DashboardTimeRangeSelector` 组件 | Task 5 | ✓ |
| `EfficiencyStatCard` + `formatSeconds` | Task 6 | ✓ |
| `AnalyticsEfficiencyTrends` 折线图（3 条线，connectNulls=false） | Task 7 | ✓ |
| `index.vue` 集成选择器、效率卡片、效率 Tab、竞态保护 | Task 8 | ✓ |
| 状态分布 / 标签分布 / 指标雷达不受时间范围影响 | Task 8 | ✓ |
| 错误处理（`message.error` + 清空图表数据） | Task 8 | ✓ |
| X 轴 `MM-DD` 格式（slice(5)） | Task 7 | ✓ |
| `formatSeconds` 精度规则（`--` / `X秒` / `X分Y秒`） | Task 6 | ✓ |

## 执行顺序依赖图

```
Task 1 (后端 Mapper)
  └─► Task 2 (后端 Service/Repository)
        └─► Task 3 (后端 Controller)  ← 可与 Task 4-7 并行

Task 4 (前端 API 层)
  └─► Task 5 (TimeRangeSelector)      ← 独立，可与 6/7 并行
  └─► Task 6 (StatCard + formatSeconds) ← 独立
        └─► Task 7 (EfficiencyTrends 图)
  └─► Task 7
  └─► Task 8 (index.vue 集成) ← 依赖 4/5/6/7 全部完成
```

后端 Task 1-3 可以独立进行；前端 Task 4-8 按顺序执行（4 完成后 5/6/7 可并行，8 最后）。
