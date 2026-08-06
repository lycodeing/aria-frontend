# 观测统计页 + 座席端反馈按钮 — 设计文档

日期：2026-08-06
分支：`feat/session-query-page`（沿用）
关联后端分支：`feat/p0-observability`（aria-server）

## 背景

后端本次交付了四个接口：

- 三个只读统计查询接口（`GET /api/v1/admin/stats/*`）：意图分类命中率、RAG 检索质量、LLM Token 成本。
- 一个座席纠错写入接口（`POST /api/v1/sessions/feedback`）。

前端需要覆盖全部四个：三个统计展示页（概览卡片 + 图表 + 榜单表）＋ 座席工作台 AI 气泡上的反馈按钮（完整弹窗）。

本文所有接口返回体均指标准 `R<T>` 信封里的 `data` 字段（前端 `request.ts` 响应拦截器已解包 `{ code, data, msg }`，业务代码直接拿到 `data`）。

## 接口契约（来自后端源码核对，非推测）

统一走 `conversationClient`（baseURL `/conversation/api/v1`，带 token）。

### 关键约定

- `period` 请求值只接受三种 code：`today` / `7d` / `30d`（大小写不敏感），非法值后端返回 HTTP 400。
- 返回体里回显的 `period` 是**枚举名**：`TODAY` / `LAST_7D` / `LAST_30D`（大写），不是请求用的 code。前端展示不依赖这个回显值，用本地选中的 code 即可。
- 可空字段：`avgLatencyMs.{RULE,EMBEDDING,LLM}`（Long|null）、`avgTop1Score`（Long|null）。渲染时 null → 显示「—」，图表跳过。
- 榜单/分组数组用的是原始 SQL 列名（snake_case）：`query_text` / `miss_count` / `model_name` / `total_tokens` / `call_count` / `call_type`。

### 1. GET /admin/stats/intent-classification

请求：`period`（默认 `today`）、`domainCode`（可选）。

返回 `data`：
- `period: string`（枚举名）
- `totalClassifications: number`
- `tier1HitRate / tier2HitRate / tier3TriggerRate: number`（0~1，4 位小数）
- `avgLatencyMs: { RULE: number|null, EMBEDDING: number|null, LLM: number|null }`

### 2. GET /admin/stats/rag-quality

请求：`period`（默认 `7d`）。

返回 `data`：
- `period: string`
- `totalSearches: number`
- `missCount: number`
- `missRate: number`（0~1，4 位小数）
- `avgTop1Score: number|null`（已四舍五入为整数）
- `topMissQueries: Array<{ query_text: string; miss_count: number }>`（最多 20 条）

### 3. GET /admin/stats/llm-cost

请求：`period`（默认 `today`）、`modelName`（可选）。

返回 `data`：
- `period: string`
- `totalInputTokens / totalOutputTokens / totalTokens: number`
- `callCount: number`
- `avgTokensPerCall: number`
- `byModel: Array<{ model_name: string; total_tokens: number; call_count: number }>`
- `byCallType: Array<{ call_type: string; total_tokens: number }>`

注意：`byModel` / `byCallType` **忽略** `modelName` 过滤，始终聚合整个周期全部行。UI 文案需提示这一点。

### 4. POST /sessions/feedback

鉴权：`@SaCheckLogin`（仅需登录，agentId 从登录态取，不在 body）。

请求体 `SessionFeedbackRequest`：
- `sessionId: string` — 必填
- `messageId: string|null` — 可选（前端暂送 null，见下）
- `feedbackType: 'WRONG_INTENT' | 'WRONG_ANSWER' | 'GOOD'` — 必填
- `originalQuery: string` — 必填（AI 回复对应的访客问题）
- `correctIntent: string` — `WRONG_INTENT` 时业务层要求必填
- `correctAnswer: string` — `WRONG_ANSWER` 时业务层要求必填

返回 `data`：`R.ok()`，null。

## Part A — 三个统计页

### 导航与路由

新建**「观测统计」分组**（独立于「会话管理」）。新增路由模块 `apps/src/router/routes/modules/stats.ts`：

```
分组 Stats  path=/stats  icon=lucide:bar-chart-3  order=25  title=$t('page.stats.title')
├─ StatsIntent    /stats/intent     #/views/stats/intent/index.vue      title=page.stats.intent
├─ StatsRag       /stats/rag        #/views/stats/rag/index.vue         title=page.stats.rag
└─ StatsLlmCost   /stats/llmCost    #/views/stats/llm-cost/index.vue    title=page.stats.llmCost
```

各叶子 `meta.authority: ['super_admin', 'kf_manager']`（对齐 session/history；后端另有 `@SaCheckPermission("system:session:query")` 做数据级鉴权）。

i18n：在 `apps/src/locales/langs/{zh-CN,en-US}/page.json` 增加 `stats` 键（title / intent / rag / llmCost）。

**侧边栏可见性依赖后端 DB 菜单行**：因菜单是 backend 驱动，前端只能建路由+视图，侧边栏显示还需在后端 DB 增加对应 menu 行（`component` 路径与视图文件对应）。本设计仅交付前端部分，DB 菜单行作为手动/后端步骤，会在交付说明中标出所需 `component` 路径。

### API 模块

新建 `apps/src/api/stats/index.ts`：
- 复用 `conversationClient`（在 `#/api/request` 已导出）。
- 定义 3 组 TS 接口（严格对齐上面契约，含可空与 snake_case 字段）。
- 导出 `getIntentStatsApi(period, domainCode?)`、`getRagStatsApi(period)`、`getLlmCostStatsApi(period, modelName?)`。
- `StatsPeriod = 'today' | '7d' | '30d'`。

### 视图结构（三页共用骨架）

每页 `Page` 包裹，顶部一行工具栏：period 快捷按钮组（今天/近7天/近30天，样式复用 session/history 的按钮组 Tailwind class）＋ 该页特有的可选筛选输入（intent 的 `domainCode`、llm-cost 的 `modelName`），右侧刷新按钮。下面依次：概览卡片网格 → 图表卡片 → 榜单/明细表。

卡片、边框、暗色适配的 Tailwind class 全部复用 session/history 已有风格（`rounded-xl border border-slate-200 bg-white dark:...`）。

图表用现有 `@vben/plugins/echarts` 的 `EchartsUI` + `useEcharts` 组合式（对齐 dashboard/analytics），不直接引 echarts。

#### 意图分类页 `/stats/intent`

- period 默认 `today`；可选 `domainCode` 文本输入（回车/失焦触发查询）。
- 卡片 ×4：总分类数、Tier1 命中率、Tier2 命中率、Tier3 触发率（率显示为百分比）。
- 图表：三层平均延迟柱状图（`avgLatencyMs.RULE/EMBEDDING/LLM`，null 值跳过该柱）。
- 无榜单（该接口无列表）。命中率三项以卡片呈现即可。

#### RAG 质量页 `/stats/rag`

- period 默认 `7d`。
- 卡片 ×4：总检索数、未命中数、未命中率（%）、平均 Top1 得分（null→「—」）。
- 榜单表：`topMissQueries`，列 = 排名 / 问题文本(`query_text`) / 未命中次数(`miss_count`)，最多 20 行。

#### LLM 成本页 `/stats/llmCost`

- period 默认 `today`；可选 `modelName` 文本输入。
- 卡片 ×4：总输入 Token、总输出 Token、总 Token、调用数（副标题带均值 avgTokensPerCall）。
- 图表：`byModel` 柱状图（x=model_name，y=total_tokens）。
- 表：`byCallType`，列 = 调用类型(`call_type`) / 总 Token(`total_tokens`)。
- 文案提示：byModel / byCallType 不受 modelName 过滤影响（展示全周期聚合）。

### 数字格式化

- 率（0~1）→ `(x*100).toFixed(1) + '%'`。
- Token/计数 → 千分位。
- 延迟 → `xxx ms`。
- 复用/新建轻量 `formatNumber` 工具（就近放在 `apps/src/views/stats/` 的 `constants.ts` 或各页内联，不引新依赖）。

## Part B — 座席端反馈按钮

### 数据可用性约束（已核对源码）

- `Msg.id` 只是客户端自增计数（`++msgId`），**不是**后端 `seq`。故前端拿不到真实 `messageId` → 送 `null`（后端契约允许）。
- `originalQuery`（AI 回复对应的访客问题）未与 AI 消息关联 → 在 `activeSession.value.msgs`（完整有序数组，非 `filteredMsgs`）中，从该 AI 消息位置向前找最近的 `role === 'user'` 消息文本。
- `sessionId` = `activeSession.value.id`。
- `correctAnswer` 的「原始 AI 回答」= 该 AI 消息 `m.text`。

### API

在 `apps/src/api/session/index.ts` 增加：

```ts
export interface AgentFeedbackPayload {
  sessionId: string;
  messageId?: string | null;
  feedbackType: 'GOOD' | 'WRONG_ANSWER' | 'WRONG_INTENT';
  originalQuery: string;
  correctIntent?: string;
  correctAnswer?: string;
}
export async function submitAgentFeedbackApi(payload: AgentFeedbackPayload): Promise<void> {
  return agentClient.post('/sessions/feedback', payload);
}
```

### UI 接线

1. `AgentChatArea.vue`：在 AI 气泡底部页脚行（现有复制按钮旁，`v-if="m.role === 'ai'"`）加一个「反馈」按钮，`emit('feedback', m)`，镜像现有 `copyMsg` 事件模式。只在实时视图加（只读/已结束视图暂不加，避免重复；如需要可后续补）。
2. `agent/index.vue`：
   - 新增 `feedbackModalVisible`、`feedbackTarget`（被反馈的 AI Msg）、表单状态（`feedbackType`、`correctIntent`、`correctAnswer`）。
   - 处理 `@feedback`：记录 target，从 `activeSession.value.msgs` 反向查 originalQuery，打开弹窗。
   - 弹窗（ant-design-vue `Modal` + `Radio.Group` + 条件 `Textarea`）：
     - 类型三选一：回答有误(WRONG_ANSWER) / 意图有误(WRONG_INTENT) / 回答很好(GOOD)。
     - `WRONG_INTENT` → 显示「正确意图」输入（必填校验）。
     - `WRONG_ANSWER` → 显示「正确答案」输入（必填校验）。
     - `GOOD` → 无额外输入。
   - 提交：组装 payload（`messageId: null`），调 `submitAgentFeedbackApi`，成功 `message.success`，失败 `message.error`，关闭弹窗。

### 前端表单校验（对齐后端业务层要求）

- `WRONG_INTENT` 未填 `correctIntent` → 阻止提交并提示。
- `WRONG_ANSWER` 未填 `correctAnswer` → 阻止提交并提示。

## 测试与验证

前端无现成单测框架用于 view 组件（codegraph 显示相关类型「no covering tests」）。验证以构建 + lint 为准：
- `pnpm -F @vben/web-antd build` 通过。
- lint（oxlint/eslint）通过（注意仓库禁用 `!` 非空断言，会拦 commit）。
- 三页手动核对渲染与空数据（null 分支、空榜单）表现。

## 交付边界（本设计不含）

- 后端 DB 菜单行（侧边栏可见性）—— 需在 aria-server 侧增加，交付说明标注 `component` 路径。
- 只读/已结束会话视图的反馈按钮（本期只做实时 AI 气泡）。
- 真实 `messageId`/`seq` 透传（本期送 null，后端按 sessionId + originalQuery 处理）。
- 前端数据大屏（归 P1）。
