# 会话队列统一接口改造设计

## 1. 背景与问题

当前座席工作台的会话队列数据通过三个独立接口获取：

- `GET /api/v1/sessions/queue` — 返回 WAITING 状态会话
- `GET /api/v1/sessions/active` — 返回 ACTIVE 状态会话
- `GET /api/v1/sessions/closed` — 返回 CLOSED 状态会话

由此引发以下问题：

1. **`QueueItem` 缺少 `status` 字段**：`toQueueItem()` 转换时丢弃了 `status`，导致前端无法按状态区分条目。
2. **"AI 对话"和"等待人工" Tab 共用同一个 `queue` 数组**：`AI_CHAT` 状态的会话没有独立数据源，"AI 对话" Tab 实际是空壳。
3. **数据来源分散**：`useSessionQueueChannel` 管 WAITING 队列，`index.vue` 的 `onMounted` 单独拉 ACTIVE，`closedSessions` 在切 Tab 时懒加载——三路数据互不感知，状态迁移（如 WAITING → ACTIVE）需要同时操作多个数据结构。

## 2. 目标

- 提供单一统一接口 `GET /api/v1/sessions`，返回包含所有状态（`AI_CHAT / WAITING / ACTIVE / CLOSED`）的会话列表。
- `QueueItem` 增加 `status` 字段，`toQueueItem()` 完整映射。
- `useSessionQueueChannel` 持有 flat sessions list，对外暴露四个 computed 切片，SSE 事件在 flat list 上原地更新 status。
- 四个 Tab 各自绑定对应切片，数据流清晰，不存在跨层重复管理。
- 删除旧的三个 API 函数及对应后端接口，消除死代码。

## 3. 非目标

- 不改变 SSE 事件的结构和后端推送逻辑（仍使用 `ENQUEUE / ACCEPTED / CLOSED / TRANSFER` 四种类型）。
- 不合并 WebSocket 实时消息管理（ACTIVE 会话的聊天消息仍由 `useAgentWebSocket` 独立管理）。
- 不调整分页、搜索、排序逻辑（保持现有行为）。
- 不涉及访客端（`publicClient` 相关接口不受影响）。

## 4. API 层变更

### 4.1 新增统一接口

```typescript
// src/api/session/index.ts

/** 获取所有状态的会话列表（座席端，需 token） */
export async function getAllSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/api/v1/sessions');
}
```

后端对应实现：`GET /api/v1/sessions`，返回当前座席可见的所有会话，包含 `AI_CHAT / WAITING / ACTIVE / CLOSED` 四种状态。`CLOSED` 状态最多返回最近 50 条，按结束时间倒序。

### 4.2 删除旧接口函数

以下三个函数从 `src/api/session/index.ts` 中直接删除（不保留 `@deprecated` 标记）：

```typescript
// 删除
export async function getSessionQueueApi(): Promise<SessionQueueItem[]>
export async function getActiveSessionsApi(): Promise<SessionQueueItem[]>
export async function getClosedSessionsApi(): Promise<SessionQueueItem[]>
```

### 4.3 SessionQueueItem 类型扩展

```typescript
export interface SessionQueueItem {
  sessionId: string;
  userName: string;
  transferReason: string;
  tag: string;
  waitSince: number; // epoch seconds
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING'; // AI_CHAT 为新增状态
}
```

### 4.4 后端接口清单变更

| 旧接口 | 新接口 | 操作 |
|---|---|---|
| `GET /api/v1/sessions/queue` | — | 删除 |
| `GET /api/v1/sessions/active` | — | 删除 |
| `GET /api/v1/sessions/closed` | — | 删除 |
| — | `GET /api/v1/sessions` | 新增 |

后端需同步删除对应 Controller 方法，并实现新的统一查询端点。

## 5. 数据模型变更

### 5.1 QueueItem 新增 status 字段

```typescript
// src/composables/useSessionQueue.ts

export interface QueueItem {
  id: string;
  name: string;
  color: string;
  waitMin: string;
  waitSince: number;
  reason: string;
  tag: string;
  tagColor: string;
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING'; // 新增
}
```

### 5.2 toQueueItem 补充映射

```typescript
export function toQueueItem(item: ApiSessionItem): QueueItem {
  return {
    id: item.sessionId,
    name: item.userName,
    color: QUEUE_AVATAR_COLOR,
    waitMin: formatWaitTime(item.waitSince),
    waitSince: item.waitSince,
    reason: item.transferReason,
    tag: item.tag,
    tagColor: resolveTagColor(item.tag),
    status: item.status, // 新增，直接透传
  };
}
```

### 5.3 字段语义说明

| 字段 | 说明 |
|---|---|
| `status: 'AI_CHAT'` | 会话由 AI 自动处理中，尚未转人工 |
| `status: 'WAITING'` | 用户已发起转人工请求，在队列中等待座席接入 |
| `status: 'ACTIVE'` | 座席已接入，正在进行人工对话 |
| `status: 'CLOSED'` | 会话已结束（用户离开或座席主动关闭） |

### 5.4 头像色扩展

不同状态的会话在列表中使用不同头像色，提升视觉区分度：

| status | 头像色 |
|---|---|
| `AI_CHAT` | `#f87171`（原 QUEUE_AVATAR_COLOR，沿用） |
| `WAITING` | `#f59e0b` |
| `ACTIVE` | `#8b5cf6` |
| `CLOSED` | `#9ca3af` |

`toQueueItem` 中的 `color` 字段由固定常量改为根据 `status` 动态选取：

```typescript
const STATUS_COLOR_MAP: Record<string, string> = {
  AI_CHAT: '#f87171',
  WAITING: '#f59e0b',
  ACTIVE: '#8b5cf6',
  CLOSED: '#9ca3af',
};

export function resolveStatusColor(status: string): string {
  return STATUS_COLOR_MAP[status] ?? '#9ca3af';
}
```

`QUEUE_AVATAR_COLOR` 常量保留以兼容现有引用，后续可清理。

## 6. useSessionQueueChannel 重构

### 6.1 接口定义变更

```typescript
// src/composables/useSessionQueueChannel.ts

import type { ComputedRef, Ref } from 'vue';

export interface SessionQueueChannel {
  // 底层 flat list（外部只读，四个切片的数据源）
  readonly sessions: Readonly<Ref<QueueItem[]>>;

  // 四个 Tab 直接绑定的 computed 切片
  readonly aiQueue:      ComputedRef<QueueItem[]>; // status === 'AI_CHAT'
  readonly waitingQueue: ComputedRef<QueueItem[]>; // status === 'WAITING'
  readonly activeQueue:  ComputedRef<QueueItem[]>; // status === 'ACTIVE'
  readonly closedQueue:  ComputedRef<QueueItem[]>; // status === 'CLOSED'

  readonly sseConnected: Readonly<Ref<boolean>>;
  readonly sseStatus: Readonly<Ref<'closed' | 'connecting' | 'error' | 'open'>>;

  init(): void;
  dispose(): void;
  reconnect(): void;
  loadSessions(): Promise<void>;          // 原 loadQueue()，调用 getAllSessionsApi()
  removeFromSessions(id: string): void;  // 原 removeFromQueue()

  onEnqueue(handler: EnqueueHandler): void;
  offEnqueue(handler: EnqueueHandler): void;
  onClosed(handler: ClosedHandler): void;
  offClosed(handler: ClosedHandler): void;
  onTransfer(handler: TransferHandler): void;
  offTransfer(handler: TransferHandler): void;
}
```

旧的 `queue` ref 和 `removeFromQueue` / `loadQueue` 方法全部删除，替换为上述新 API。

### 6.2 内部状态

```typescript
// 模块级单例 ref
const sessions = ref<QueueItem[]>([]);

// 四个 computed 切片（模块级，惰性求值）
const aiQueue      = computed(() => sessions.value.filter(s => s.status === 'AI_CHAT'));
const waitingQueue = computed(() => sessions.value.filter(s => s.status === 'WAITING'));
const activeQueue  = computed(() => sessions.value.filter(s => s.status === 'ACTIVE'));
const closedQueue  = computed(() => sessions.value.filter(s => s.status === 'CLOSED'));
```

### 6.3 SSE 事件处理逻辑

原逻辑是增删 queue 数组；新逻辑是在 flat list 上**原地更新 status**，仅在确实没有记录时才插入。

```
ENQUEUE 事件：
  → 根据 event.item.status 确定初始状态（通常为 WAITING 或 AI_CHAT）
  → 若 sessions 中不存在该 sessionId，push 新条目
  → 若已存在，更新 status（幂等，防止重放）
  → 触发 onEnqueue 回调

ACCEPTED 事件：
  → 找到对应条目，将 status 改为 'ACTIVE'
  → 不触发 onClosed
  （原逻辑是从 queue 删除，现在改为原地状态迁移）

CLOSED 事件：
  → 找到对应条目，将 status 改为 'CLOSED'
  → 触发 onClosed 回调
  （原逻辑是从 queue 删除，现在保留条目以便 CLOSED Tab 展示）

TRANSFER 事件：
  → 从 sessions 中直接移除该条目（转交给其他座席，本座席不再持有）
  → 触发 onTransfer 回调
  （行为不变）
```

### 6.4 loadSessions 变更

```typescript
async function loadSessions(): Promise<void> {
  const gen = ++_loadGen;
  try {
    const items = await getAllSessionsApi(); // 改用统一接口
    if (gen !== _loadGen) return;
    sessions.value.splice(
      0,
      sessions.value.length,
      ...items.map((item) => toQueueItem(item)),
    );
  } catch (error) {
    console.error('[useSessionQueueChannel] loadSessions 失败:', error);
  }
}
```

### 6.5 waitTimer 作用域收窄

原 `waitTimer` 每秒刷新整个 `queue.value`；重构后改为只刷新非 CLOSED 条目（CLOSED 条目的 `waitMin` 不需要实时更新）：

```typescript
waitTimer = setInterval(() => {
  sessions.value.forEach((item) => {
    if (item.status !== 'CLOSED') {
      item.waitMin = formatWaitTime(item.waitSince);
    }
  });
}, 1000);
```

### 6.6 dispose 清理

`dispose()` 清空 `sessions.value`，四个 computed 切片自动归空，行为一致：

```typescript
dispose() {
  _stopSse();
  _stopWaitTimer();
  _loadGen++;
  sessions.value.splice(0);
  sseRetryCount = 0;
  sseStatus.value = 'closed';
}
```

## 7. index.vue 变更

### 7.1 onMounted 简化

原来 `onMounted` 中需要单独调用 `getActiveSessionsApi()` 拉取进行中会话，然后逐条构建 `SessionData`。重构后，ACTIVE 会话已由 `channel.activeQueue` 提供，`onMounted` 改为消费该切片：

```typescript
onMounted(async () => {
  queueChannel.onClosed(handleQueueClosed);
  queueChannel.onTransfer(handleQueueTransfer);

  // 从 channel 的 activeQueue 切片初始化进行中会话
  // channel.loadSessions() 由 layouts/basic.vue 在登录时已调用
  const activeSessions = queueChannel.activeQueue.value;

  if (activeSessions.length > 0) {
    const histories = await Promise.all(
      activeSessions.map((item) =>
        getSessionHistoryApi(item.id).catch(() => []),
      ),
    );
    activeSessions.forEach((item, idx) => {
      const history = histories[idx] ?? [];
      // 构建 SessionData，逻辑与原来一致
      // ...
    });
    if (sessions.value[0]) sessions.value[0].active = true;
    activeSessions.forEach((item) => connectAgentSession(item.id));
  }
});
```

### 7.2 删除 closedSessions 及相关逻辑

以下内容从 `index.vue` 中删除：

```typescript
// 删除
const closedSessions = ref<ClosedSessionItem[]>([]);
const closedLoading = ref(false);

async function loadClosedSessions() { ... }

watch(queueStateTab, (tab) => {
  if (tab === 'closed' && closedSessions.value.length === 0)
    void loadClosedSessions();
  // ...
});
```

改为直接从 `channel.closedQueue` 派生 `ClosedSessionItem[]`：

```typescript
const closedSessions = computed<ClosedSessionItem[]>(() =>
  queueChannel.closedQueue.value.map((item) => ({
    id: item.id,
    name: item.name,
    nameChar: item.name.at(0) ?? '?',
    endedAt:
      item.waitSince > 0
        ? new Date(item.waitSince * 1000).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
    transferReason: item.reason,
    tag: item.tag,
  })),
);
```

`closedLoading` 也随之删除（初始加载由 `channel.loadSessions()` 统一覆盖，无需单独 loading 状态）。

### 7.3 channel 绑定变更

```typescript
// 原
const { queue, sseConnected } = queueChannel;

// 改为
const { aiQueue, waitingQueue, sseConnected } = queueChannel;
// activeQueue 和 closedQueue 通过 queueChannel.activeQueue / closedQueue 访问
```

### 7.4 acceptItem 更新

```typescript
async function acceptItem(item: QueueItem): Promise<ApiSessionItem> {
  await acceptSessionApi(item.id);
  // 不再调用 removeFromQueue，channel 通过 SSE ACCEPTED 事件自动将 status 改为 ACTIVE
  // 若 SSE 延迟，乐观更新：直接在 sessions flat list 中更新 status
  // （channel 暴露 updateStatus 方法，或在 index.vue 中通过 removeFromSessions 兜底）
  return {
    sessionId: item.id,
    userName: item.name,
    transferReason: item.reason,
    tag: item.tag,
    waitSince: item.waitSince,
    status: 'ACTIVE',
  };
}
```

### 7.5 AgentLeftPanel props 变更

传递给 `AgentLeftPanel` 的 props 拆分：

```html
<!-- 原 -->
<AgentLeftPanel
  :queue="queue"
  :paged-queue="pagedQueue"
  :visible-paged-queue="visiblePagedQueue"
  :closed-sessions="closedSessions"
  :closed-loading="closedLoading"
  ...
/>

<!-- 改为 -->
<AgentLeftPanel
  :ai-queue="aiQueue"
  :waiting-queue="waitingQueue"
  :paged-waiting-queue="pagedWaitingQueue"
  :visible-paged-waiting-queue="visiblePagedWaitingQueue"
  :closed-sessions="closedSessions"
  ...
/>
```

`closedLoading` prop 删除，不再传递。

### 7.6 分页目标切换

原分页作用于整个 `queue`（WAITING），重构后分页目标改为 `waitingQueue`：

```typescript
const queueTotalPages = computed(() =>
  Math.max(1, Math.ceil(waitingQueue.value.length / 5)),
);
const pagedWaitingQueue = computed(() => {
  const start = (queuePage.value - 1) * 5;
  return waitingQueue.value.slice(start, start + 5);
});

watch(
  () => waitingQueue.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) queuePage.value = 1;
  },
);
```

### 7.7 队列总数徽标

原头部徽标显示 `queue.length`（仅 WAITING）。重构后可选择：
- 继续只显示 `waitingQueue.value.length`（等待人工的数量，对座席最有意义）
- 或显示 `aiQueue.value.length + waitingQueue.value.length`（AI+等待合计）

设计选择：**徽标只显示 `waitingQueue.value.length`**，即等待人工接入的数量，保持原有语义。

## 8. AgentLeftPanel.vue 变更

### 8.1 Props 变更

```typescript
// 原
defineProps<{
  queue: QueueItem[];          // 混用，同时给 AI 和等待 Tab
  pagedQueue: QueueItem[];
  visiblePagedQueue: QueueItem[];
  closedSessions: ClosedSessionItem[];
  closedLoading: boolean;
  // ...
}>()

// 改为
defineProps<{
  aiQueue: QueueItem[];                    // AI 对话 Tab
  waitingQueue: QueueItem[];               // 用于头部徽标计数
  pagedWaitingQueue: QueueItem[];          // 等待人工 Tab（分页后）
  visiblePagedWaitingQueue: QueueItem[];   // 等待人工 Tab（分页+搜索过滤后）
  closedSessions: ClosedSessionItem[];     // 已结束 Tab（来自 channel.closedQueue 派生）
  // closedLoading 删除
  // ...
}>()
```

### 8.2 emits 无变化

```typescript
// 保持不变，不新增 emit
```

### 8.3 Tab 徽标数字更新

```html
<!-- 原：等待人工 Tab 红点 -->
<span v-if="tab.key === 'waiting' && queue.length">
  {{ queue.length }}
</span>

<!-- 改为 -->
<span v-if="tab.key === 'waiting' && waitingQueue.length">
  {{ waitingQueue.length }}
</span>

<!-- 新增：AI 对话 Tab 蓝色角标 -->
<span
  v-if="tab.key === 'ai' && aiQueue.length"
  class="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#1a73e8]/20 px-1 text-[10px] text-[#1a73e8]"
  :class="queueStateTab === 'ai' ? 'bg-white/30 text-white' : ''"
>
  {{ aiQueue.length }}
</span>
```

### 8.4 AI 对话 Tab 渲染

原 AI 对话 Tab 遍历 `queue`（实为 WAITING 数据），改为遍历 `aiQueue`：

```html
<!-- 原 -->
<template v-if="queueStateTab === 'ai'">
  <div v-if="queue.length" class="space-y-1.5">
    <div v-for="item in queue" :key="item.id" ...>

<!-- 改为 -->
<template v-if="queueStateTab === 'ai'">
  <div v-if="aiQueue.length" class="space-y-1.5">
    <div v-for="item in aiQueue" :key="item.id" ...>
```

### 8.5 等待人工 Tab 渲染

原遍历 `visiblePagedQueue`，改为 `visiblePagedWaitingQueue`；搜索无结果判断改用 `waitingQueue.length`：

```html
<!-- 原 -->
<div v-if="visiblePagedQueue.length" class="space-y-2">
  <div v-for="item in visiblePagedQueue" ...>
...
<div v-else-if="queue.length && !visiblePagedQueue.length" ...>

<!-- 改为 -->
<div v-if="visiblePagedWaitingQueue.length" class="space-y-2">
  <div v-for="item in visiblePagedWaitingQueue" ...>
...
<div v-else-if="waitingQueue.length && !visiblePagedWaitingQueue.length" ...>
```

### 8.6 已结束 Tab 渲染

原有 `closedLoading` 控制 Spin，删除后改为：直接显示列表，无 loading 状态（首次加载由 Channel `loadSessions()` 在登录时统一处理，不存在单独的 CLOSED 懒加载时机）。

```html
<!-- 原 -->
<template v-else-if="queueStateTab === 'closed'">
  <div v-if="closedLoading" class="flex justify-center py-8">
    <Spin size="small" />
  </div>
  <div v-else-if="closedSessions.length" class="space-y-1.5">

<!-- 改为 -->
<template v-else-if="queueStateTab === 'closed'">
  <div v-if="closedSessions.length" class="space-y-1.5">
```

`Spin` 组件引入可同步从 `import` 中移除（若无其他地方使用）。

### 8.7 头部总数徽标

```html
<!-- 原：显示 queue.length -->
<span v-if="queue.length > 0" ...>{{ queue.length }}</span>

<!-- 改为：显示等待人工数量 -->
<span v-if="waitingQueue.length > 0" ...>{{ waitingQueue.length }}</span>
```

## 9. 测试更新

### 9.1 useSessionQueueChannel.test.ts 变更概览

测试文件需要同步更新以覆盖新的 flat list 语义和四个 computed 切片。

**主要变更：**

1. 所有 `channel.queue.value` 引用改为 `channel.sessions.value`
2. 新增对四个 computed 切片的断言
3. `ACCEPTED` 事件的断言从「queue 变为空」改为「status 变为 ACTIVE」
4. `CLOSED` 事件的断言从「queue 变为空」改为「status 变为 CLOSED，条目仍保留在 sessions 中」
5. `loadQueue` mock 改为 `getAllSessionsApi` mock
6. `makeItem` 补充 `status` 字段

### 9.2 makeItem 更新

```typescript
function makeItem(
  sessionId: string,
  userName = 'Test User',
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING' = 'WAITING',
) {
  return {
    sessionId,
    userName,
    waitSince: 0,
      transferReason: '',
    tag: '',
    status,
  };
}
```

### 9.3 关键用例更新示例

```typescript
// 原
it('enqueue 事件加入 queue', async () => {
  ...
  expect(channel.queue.value).toHaveLength(1);
  expect(channel.queue.value[0]?.id).toBe('s1');
});

// 改为
it('enqueue 事件加入 sessions', async () => {
  ...
  expect(channel.sessions.value).toHaveLength(1);
  expect(channel.sessions.value[0]?.id).toBe('s1');
  expect(channel.sessions.value[0]?.status).toBe('WAITING');
  // computed 切片也应反映
  expect(channel.waitingQueue.value).toHaveLength(1);
  expect(channel.aiQueue.value).toHaveLength(0);
});

// 原
it('accepted 事件从 queue 移除，不触发 onClosed', async () => {
  ...
  expect(channel.queue.value).toHaveLength(0);
  expect(closedHandler).not.toHaveBeenCalled();
});

// 改为
it('accepted 事件将 status 改为 ACTIVE，不触发 onClosed', async () => {
  ...
  // 条目仍在 sessions，但 status 变为 ACTIVE
  expect(channel.sessions.value).toHaveLength(1);
  expect(channel.sessions.value[0]?.status).toBe('ACTIVE');
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(channel.activeQueue.value).toHaveLength(1);
  expect(closedHandler).not.toHaveBeenCalled();
});

// 原
it('closed 事件从 queue 移除并触发 onClosed', async () => {
  ...
  expect(channel.queue.value).toHaveLength(0);
  expect(closedHandler).toHaveBeenCalledWith('s5');
});

// 改为
it('closed 事件将 status 改为 CLOSED 并触发 onClosed', async () => {
  ...
  // 条目保留在 sessions，status 改为 CLOSED
  expect(channel.sessions.value).toHaveLength(1);
  expect(channel.sessions.value[0]?.status).toBe('CLOSED');
  expect(channel.closedQueue.value).toHaveLength(1);
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(closedHandler).toHaveBeenCalledWith('s5');
});
```

### 9.4 dispose 用例更新

```typescript
// 改为
it('dispose() 关闭 SSE 连接、清空 sessions、sseConnected=false', async () => {
  ...
  expect(channel.sessions.value).toHaveLength(0);
  // 四个切片也自动归空
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(channel.aiQueue.value).toHaveLength(0);
  expect(channel.activeQueue.value).toHaveLength(0);
  expect(channel.closedQueue.value).toHaveLength(0);
  expect(channel.sseConnected.value).toBe(false);
  expect(es.closed).toBe(true);
});
```

### 9.5 新增用例

```typescript
// AI_CHAT 状态入队进入 aiQueue 切片
it('AI_CHAT 状态的 enqueue 事件进入 aiQueue 切片', async () => {
  channel.init();
  getEs().emit('open');
  getEs().emit('message', {
    type: 'ENQUEUE',
    item: makeItem('s-ai', 'AI用户', 'AI_CHAT'),
  });
  await nextTick();
  expect(channel.aiQueue.value).toHaveLength(1);
  expect(channel.waitingQueue.value).toHaveLength(0);
});

// 状态迁移：WAITING → ACTIVE（ACCEPTED 事件）
it('ACCEPTED 事件完成 WAITING→ACTIVE 状态迁移', async () => {
  channel.init();
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s-w', '等待用户', 'WAITING') });
  await nextTick();
  expect(channel.waitingQueue.value).toHaveLength(1);

  getEs().emit('message', { type: 'ACCEPTED', item: makeItem('s-w') });
  await nextTick();
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(channel.activeQueue.value).toHaveLength(1);
  expect(channel.sessions.value).toHaveLength(1); // 条目未被删除
});
```
