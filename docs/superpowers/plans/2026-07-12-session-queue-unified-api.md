# 会话队列统一接口改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三个分散的会话队列接口（`/queue`、`/active`、`/closed`）合并为单一接口 `GET /api/v1/sessions`，在 `useSessionQueueChannel` 中持有包含 status 字段的 flat sessions list，并通过四个 computed 切片驱动 AgentLeftPanel 的四个 Tab。

**Architecture:** Channel 持有模块级单例 `sessions: Ref<QueueItem[]>`，SSE 事件在 flat list 上原地更新 status（ENQUEUE 插入/更新，ACCEPTED 改为 ACTIVE，CLOSED 改为 CLOSED，TRANSFER 删除）。四个只读 computed 切片（aiQueue / waitingQueue / activeQueue / closedQueue）由 Channel 暴露，index.vue 和 AgentLeftPanel 直接绑定切片，不再各自维护独立数组。

**Tech Stack:** Vue 3, TypeScript, Vitest, Ant Design Vue, Vite（项目根为 `/Users/lycodeing/WebstormProjects/aria-frontend`）

## Global Constraints

- 测试运行命令：`cd /Users/lycodeing/WebstormProjects/aria-frontend && pnpm vitest run apps/src/composables/__tests__/useSessionQueueChannel.test.ts`
- TypeScript 检查命令：`cd /Users/lycodeing/WebstormProjects/aria-frontend/apps && pnpm typecheck`
- 所有旧接口函数直接删除，不保留 `@deprecated`
- status 枚举值：`'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING'`（全大写字符串）
- git commit scope 格式：`feat(@vben/web-antd): ...`

---

## File Map

| 文件 | 操作 | 说明 |
|---|---|---|
| `apps/src/api/session/index.ts` | Modify | 删除旧三函数，新增 `getAllSessionsApi`，扩展 `SessionQueueItem.status` |
| `apps/src/composables/useSessionQueue.ts` | Modify | `QueueItem` 加 `status`，`toQueueItem` 映射，新增 `resolveStatusColor` |
| `apps/src/composables/useSessionQueueChannel.ts` | Modify | 全量重构：flat sessions list + 4 computed 切片 |
| `apps/src/composables/__tests__/useSessionQueueChannel.test.ts` | Modify | 同步更新所有断言和新增用例 |
| `apps/src/views/customerservice/agent/index.vue` | Modify | 简化 onMounted，closedSessions 改 computed，更新 channel 绑定和 props |
| `apps/src/views/customerservice/agent/AgentLeftPanel.vue` | Modify | 拆分 props，更新模板各 Tab 渲染 |
| `apps/src/layouts/basic.vue` | Modify | `loadQueue()` → `loadSessions()` |

---

## Task 1: API 层 + 数据模型

**Files:**
- Modify: `apps/src/api/session/index.ts`
- Modify: `apps/src/composables/useSessionQueue.ts`

**Interfaces:**
- Produces:
  - `getAllSessionsApi(): Promise<SessionQueueItem[]>` — 调用 `GET /api/v1/sessions`
  - `SessionQueueItem.status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING'`
  - `QueueItem.status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING'`
  - `resolveStatusColor(status: string): string`
  - `toQueueItem(item: ApiSessionItem): QueueItem` — 含 status 映射

---

- [ ] **Step 1: 修改 `SessionQueueItem` — 确认 status 已覆盖所有四种值**

打开 `apps/src/api/session/index.ts`，找到第 40-47 行的 `SessionQueueItem` 接口，将 status 字段改为：

```typescript
export interface SessionQueueItem {
  sessionId: string;
  userName: string;
  transferReason: string;
  tag: string;
  waitSince: number; // epoch seconds
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING';
}
```

- [ ] **Step 2: 删除旧三个 API 函数**

从 `apps/src/api/session/index.ts` 中删除以下三个函数（约第 91-108 行）：

```typescript
// 删除整个函数体
export async function getSessionQueueApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/api/v1/sessions/queue');
}

export async function getActiveSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/api/v1/sessions/active');
}

export async function getClosedSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/api/v1/sessions/closed');
}
```

- [ ] **Step 3: 新增 `getAllSessionsApi`**

在删除位置插入：

```typescript
/** 获取所有状态的会话列表（座席端，需 token）。
 * 返回 AI_CHAT / WAITING / ACTIVE / CLOSED 四种状态，CLOSED 最多 50 条按结束时间倒序。
 */
export async function getAllSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/api/v1/sessions');
}
```

- [ ] **Step 4: 更新 `QueueItem` 类型，新增 `resolveStatusColor`**

打开 `apps/src/composables/useSessionQueue.ts`，做以下变更：

**4a. 在 `QueueItem` 接口加 status 字段：**

```typescript
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

**4b. 在文件顶部（TAG_COLOR_MAP 之后）新增颜色映射：**

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

**4c. 更新 `toQueueItem`，使用 `resolveStatusColor` 并映射 status：**

```typescript
export function toQueueItem(item: ApiSessionItem): QueueItem {
  return {
    id: item.sessionId,
    name: item.userName,
    color: resolveStatusColor(item.status),
    waitMin: formatWaitTime(item.waitSince),
    waitSince: item.waitSince,
    reason: item.transferReason,
    tag: item.tag,
    tagColor: resolveTagColor(item.tag),
    status: item.status,
  };
}
```

- [ ] **Step 5: TypeScript 检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend/apps && pnpm typecheck 2>&1 | grep -E "error TS|useSessionQueue|session/index" | head -20
```

预期：无与这两个文件相关的 TS 错误。

- [ ] **Step 6: Commit**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/api/session/index.ts apps/src/composables/useSessionQueue.ts
git commit -m "feat(@vben/web-antd): 统一会话队列接口，QueueItem 增加 status 字段"
```

---

## Task 2: Channel 测试（TDD — 先写失败用例）

**Files:**
- Modify: `apps/src/composables/__tests__/useSessionQueueChannel.test.ts`

**Interfaces:**
- Consumes: `QueueItem.status`（Task 1 产出）
- Produces: 红灯测试套件，覆盖 Channel 新 API（sessions / aiQueue / waitingQueue / activeQueue / closedQueue / loadSessions）

---

- [ ] **Step 1: 更新 mock 声明——将 `getSessionQueueApi` 替换为 `getAllSessionsApi`**

文件第 20-28 行，将 mock 改为：

```typescript
import { getAllSessionsApi, subscribeSessionEvents } from '#/api/session';

vi.mock('#/api/session', () => ({
  subscribeSessionEvents: vi.fn(),
  getAllSessionsApi: vi.fn(),
}));
```

- [ ] **Step 2: 更新 `makeItem` helper，加 `status` 参数**

将现有 `makeItem` 函数替换为：

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

- [ ] **Step 3: 更新 `beforeEach` — 改用 `getAllSessionsApi` mock**

```typescript
beforeEach(async () => {
  vi.mocked(subscribeSessionEvents).mockImplementation(
    (onEvent, onError, onOpen) => {
      const es = new MockEsImpl('/api/v1/sessions/events');
      lastEventSource = es;
      es.addEventListener('open', () => onOpen?.());
      es.addEventListener('message', (e) => {
        if (e.data) {
          try {
            onEvent(JSON.parse(e.data));
          } catch {
            /* ignore non-JSON heartbeats */
          }
        }
      });
      if (onError) es.addEventListener('error', () => onError());
      return es as unknown as EventSource;
    },
  );
  vi.mocked(getAllSessionsApi).mockResolvedValue([]);

  channel = useSessionQueueChannel();
  channel.dispose();
  lastEventSource = null;
  await nextTick();
});
```

- [ ] **Step 4: 更新既有用例——`queue` → `sessions` + `waitingQueue`**

将以下用例逐一替换（完整新版本）：

```typescript
it('enqueue 事件加入 sessions 并出现在 waitingQueue 切片', async () => {
  channel.init();
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s1', '张三', 'WAITING') });
  await nextTick();
  expect(channel.sessions.value).toHaveLength(1);
  expect(channel.sessions.value[0]?.id).toBe('s1');
  expect(channel.sessions.value[0]?.status).toBe('WAITING');
  expect(channel.waitingQueue.value).toHaveLength(1);
  expect(channel.aiQueue.value).toHaveLength(0);
});

it('enqueue 事件触发 onEnqueue 回调', async () => {
  const handler = vi.fn();
  channel.init();
  channel.onEnqueue(handler);
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s2', '李四', 'WAITING') });
  await nextTick();
  expect(handler).toHaveBeenCalledOnce();
  expect(handler.mock.calls[0]?.[0]?.id).toBe('s2');
});

it('enqueue 去重：同 sessionId 不重复添加', async () => {
  channel.init();
  getEs().emit('open');
  const payload = { type: 'ENQUEUE', item: makeItem('s3', '王五', 'WAITING') };
  getEs().emit('message', payload);
  getEs().emit('message', payload);
  await nextTick();
  expect(channel.sessions.value).toHaveLength(1);
});

it('accepted 事件将 status 改为 ACTIVE，不触发 onClosed', async () => {
  const closedHandler = vi.fn();
  channel.init();
  channel.onClosed(closedHandler);
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s4', '赵六', 'WAITING') });
  getEs().emit('message', { type: 'ACCEPTED', item: makeItem('s4') });
  await nextTick();
  // 条目仍在 sessions，status 变为 ACTIVE
  expect(channel.sessions.value).toHaveLength(1);
  expect(channel.sessions.value[0]?.status).toBe('ACTIVE');
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(channel.activeQueue.value).toHaveLength(1);
  expect(closedHandler).not.toHaveBeenCalled();
});

it('closed 事件将 status 改为 CLOSED 并触发 onClosed', async () => {
  const closedHandler = vi.fn();
  channel.init();
  channel.onClosed(closedHandler);
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s5', '陈七', 'WAITING') });
  getEs().emit('message', { type: 'CLOSED', item: makeItem('s5') });
  await nextTick();
  // 条目保留在 sessions，status 改为 CLOSED
  expect(channel.sessions.value).toHaveLength(1);
  expect(channel.sessions.value[0]?.status).toBe('CLOSED');
  expect(channel.closedQueue.value).toHaveLength(1);
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(closedHandler).toHaveBeenCalledWith('s5');
});

it('transfer 事件从 sessions 移除并触发 onTransfer', async () => {
  const transferHandler = vi.fn();
  channel.init();
  channel.onTransfer(transferHandler);
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s6', '周八', 'WAITING') });
  getEs().emit('message', {
    type: 'TRANSFER',
    item: makeItem('s6'),
    fromAgentId: 'a1',
    toAgentId: 'a2',
  });
  await nextTick();
  expect(channel.sessions.value).toHaveLength(0);
  expect(transferHandler).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'TRANSFER' }),
  );
});

it('dispose() 关闭 SSE 连接、清空 sessions、sseConnected=false', async () => {
  channel.init();
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s7', '吴九', 'WAITING') });
  await nextTick();
  expect(channel.sessions.value).toHaveLength(1);

  const es = getEs();
  channel.dispose();
  expect(channel.sessions.value).toHaveLength(0);
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(channel.aiQueue.value).toHaveLength(0);
  expect(channel.activeQueue.value).toHaveLength(0);
  expect(channel.closedQueue.value).toHaveLength(0);
  expect(channel.sseConnected.value).toBe(false);
  expect(es.closed).toBe(true);
});

it('offEnqueue 后不再触发回调', async () => {
  const handler = vi.fn();
  channel.init();
  channel.onEnqueue(handler);
  channel.offEnqueue(handler);
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s8', '郑十', 'WAITING') });
  await nextTick();
  expect(handler).not.toHaveBeenCalled();
});

it('offClosed 后不再触发回调', async () => {
  const handler = vi.fn();
  channel.init();
  channel.onClosed(handler);
  channel.offClosed(handler);
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s9', '刘一', 'WAITING') });
  getEs().emit('message', { type: 'CLOSED', item: makeItem('s9') });
  await nextTick();
  expect(handler).not.toHaveBeenCalled();
});

it('offTransfer 后不再触发回调', async () => {
  const handler = vi.fn();
  channel.init();
  channel.onTransfer(handler);
  channel.offTransfer(handler);
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s10', '陈二', 'WAITING') });
  getEs().emit('message', {
    type: 'TRANSFER',
    item: makeItem('s10'),
    fromAgentId: 'a1',
    toAgentId: 'a2',
  });
  await nextTick();
  expect(handler).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: 在 `describe` 块末尾追加新增用例**

```typescript
// ---- 新增：AI_CHAT 切片 ----

it('AI_CHAT 状态的 enqueue 进入 aiQueue 切片', async () => {
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

// ---- 新增：WAITING → ACTIVE 状态迁移 ----

it('ACCEPTED 事件完成 WAITING→ACTIVE 迁移，条目不被删除', async () => {
  channel.init();
  getEs().emit('open');
  getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s-w', '等待用户', 'WAITING') });
  await nextTick();
  expect(channel.waitingQueue.value).toHaveLength(1);

  getEs().emit('message', { type: 'ACCEPTED', item: makeItem('s-w') });
  await nextTick();
  expect(channel.waitingQueue.value).toHaveLength(0);
  expect(channel.activeQueue.value).toHaveLength(1);
  expect(channel.sessions.value).toHaveLength(1);
});

// ---- 新增：loadSessions 使用 getAllSessionsApi ----

it('loadSessions() 从 getAllSessionsApi 填充 sessions', async () => {
  vi.mocked(getAllSessionsApi).mockResolvedValue([
    makeItem('ls1', '加载用户', 'WAITING'),
    makeItem('ls2', 'AI用户', 'AI_CHAT'),
  ]);
  channel.init();
  await channel.loadSessions();
  await nextTick();
  expect(channel.sessions.value).toHaveLength(2);
  expect(channel.waitingQueue.value).toHaveLength(1);
  expect(channel.aiQueue.value).toHaveLength(1);
});
```

- [ ] **Step 6: 运行测试，确认红灯（Channel 尚未实现新 API）**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend && pnpm vitest run apps/src/composables/__tests__/useSessionQueueChannel.test.ts 2>&1 | tail -30
```

预期：多个用例 FAIL，原因是 `channel.sessions`、`channel.aiQueue` 等属性不存在。

---

## Task 3: Channel 实现

**Files:**
- Modify: `apps/src/composables/useSessionQueueChannel.ts`

**Interfaces:**
- Consumes:
  - `getAllSessionsApi(): Promise<SessionQueueItem[]>`（Task 1）
  - `toQueueItem(item): QueueItem`，`QueueItem.status`（Task 1）
- Produces:
  - `SessionQueueChannel.sessions: Readonly<Ref<QueueItem[]>>`
  - `SessionQueueChannel.aiQueue: ComputedRef<QueueItem[]>`
  - `SessionQueueChannel.waitingQueue: ComputedRef<QueueItem[]>`
  - `SessionQueueChannel.activeQueue: ComputedRef<QueueItem[]>`
  - `SessionQueueChannel.closedQueue: ComputedRef<QueueItem[]>`
  - `SessionQueueChannel.loadSessions(): Promise<void>`
  - `SessionQueueChannel.removeFromSessions(id: string): void`

---

- [ ] **Step 1: 用以下完整内容替换 `useSessionQueueChannel.ts`**

```typescript
// apps/src/composables/useSessionQueueChannel.ts
import type { ComputedRef, Ref } from 'vue';

import type { SessionSseEvent } from '#/api/session';
import type { QueueItem } from '#/composables/useSessionQueue';

import { computed, ref } from 'vue';

import { message as antMessage } from 'ant-design-vue';

import { getAllSessionsApi, subscribeSessionEvents } from '#/api/session';
import { formatWaitTime, toQueueItem } from '#/composables/useSessionQueue';

// ---- 类型 ----

export type EnqueueHandler = (item: QueueItem) => void;
export type ClosedHandler = (sessionId: string) => void;
export type TransferHandler = (event: SessionSseEvent) => void;

export interface SessionQueueChannel {
  /** 底层 flat list（外部只读，四个切片的数据源） */
  readonly sessions: Readonly<Ref<QueueItem[]>>;

  /** 四个 Tab 直接绑定的 computed 切片 */
  readonly aiQueue:      ComputedRef<QueueItem[]>;
  readonly waitingQueue: ComputedRef<QueueItem[]>;
  readonly activeQueue:  ComputedRef<QueueItem[]>;
  readonly closedQueue:  ComputedRef<QueueItem[]>;

  readonly sseConnected: Readonly<Ref<boolean>>;
  readonly sseStatus: Readonly<Ref<'closed' | 'connecting' | 'error' | 'open'>>;

  init(): void;
  dispose(): void;
  reconnect(): void;
  /** 从统一接口加载全量会话，替代原 loadQueue() */
  loadSessions(): Promise<void>;
  /** 从 sessions 中移除指定会话（用于 TRANSFER 乐观更新） */
  removeFromSessions(id: string): void;

  onEnqueue(handler: EnqueueHandler): void;
  offEnqueue(handler: EnqueueHandler): void;
  onClosed(handler: ClosedHandler): void;
  offClosed(handler: ClosedHandler): void;
  onTransfer(handler: TransferHandler): void;
  offTransfer(handler: TransferHandler): void;
}

// ---- 重连常量 ----

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRIES = 10;

// ---- 模块级单例状态 ----

const sessions = ref<QueueItem[]>([]);
const sseConnected = ref(false);
const sseStatus = ref<'closed' | 'connecting' | 'error' | 'open'>('closed');

// 四个 computed 切片（惰性求值）
const aiQueue      = computed(() => sessions.value.filter(s => s.status === 'AI_CHAT'));
const waitingQueue = computed(() => sessions.value.filter(s => s.status === 'WAITING'));
const activeQueue  = computed(() => sessions.value.filter(s => s.status === 'ACTIVE'));
const closedQueue  = computed(() => sessions.value.filter(s => s.status === 'CLOSED'));

let eventSource: EventSource | null = null;
let sseRetryCount = 0;
let sseRetryTimer: null | ReturnType<typeof setTimeout> = null;
let waitTimer: null | ReturnType<typeof setInterval> = null;
let _loadGen = 0;

// 多播监听器
const enqueueHandlers = new Set<EnqueueHandler>();
const closedHandlers = new Set<ClosedHandler>();
const transferHandlers = new Set<TransferHandler>();

// ---- 内部函数 ----

function _stopWaitTimer(): void {
  if (waitTimer !== null) {
    clearInterval(waitTimer);
    waitTimer = null;
  }
}

function _startWaitTimer(): void {
  _stopWaitTimer();
  waitTimer = setInterval(() => {
    sessions.value.forEach((item) => {
      // CLOSED 条目的等待时间不需要实时刷新
      if (item.status !== 'CLOSED') {
        item.waitMin = formatWaitTime(item.waitSince);
      }
    });
  }, 1000);
}

function _stopSse(): void {
  if (sseRetryTimer !== null) {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
  }
  eventSource?.close();
  eventSource = null;
  sseConnected.value = false;
}

function _connect(): void {
  _stopSse();

  const es = subscribeSessionEvents(
    (event) => {
      sseRetryCount = 0;
      const sid = event.item?.sessionId;
      if (!sid) return;

      if (event.type === 'ENQUEUE') {
        const item = event.item;
        const existing = sessions.value.find((s) => s.id === item.sessionId);
        if (existing) {
          // 幂等：已存在则更新 status（防止重放）
          existing.status = item.status;
        } else {
          const qi = toQueueItem(item);
          sessions.value.push(qi);
          antMessage.info(`新会话请求：${item.userName}`);
          enqueueHandlers.forEach((h) => h(qi));
        }
      } else if (event.type === 'ACCEPTED') {
        // 原地更新 status → ACTIVE，条目保留在 flat list
        const found = sessions.value.find((s) => s.id === sid);
        if (found) found.status = 'ACTIVE';
      } else if (event.type === 'CLOSED') {
        // 原地更新 status → CLOSED，条目保留以便 CLOSED Tab 展示
        const found = sessions.value.find((s) => s.id === sid);
        if (found) found.status = 'CLOSED';
        closedHandlers.forEach((h) => h(sid));
      } else if (event.type === 'TRANSFER') {
        // 转交给其他座席，本座席不再持有该会话，直接移除
        sessions.value = sessions.value.filter((s) => s.id !== sid);
        transferHandlers.forEach((h) => h(event));
      }
    },
    () => {
      if (eventSource !== es) return;
      sseConnected.value = false;
      es.close();
      eventSource = null;
      if (sseRetryCount >= MAX_RETRIES) {
        sseStatus.value = 'error';
        return;
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** sseRetryCount, MAX_DELAY_MS);
      sseRetryCount++;
      sseStatus.value = 'connecting';
      sseRetryTimer = setTimeout(_connect, delay);
    },
    () => {
      sseRetryCount = 0;
      sseConnected.value = true;
      sseStatus.value = 'open';
    },
  );

  eventSource = es;
  _startWaitTimer();
}

// ---- loadSessions ----

async function loadSessions(): Promise<void> {
  const gen = ++_loadGen;
  try {
    const items = await getAllSessionsApi();
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

// ---- 导出单例 ----

export function useSessionQueueChannel(): SessionQueueChannel {
  return {
    sessions,
    aiQueue,
    waitingQueue,
    activeQueue,
    closedQueue,
    sseConnected,
    sseStatus,

    init() {
      if (eventSource) return;
      sseRetryCount = 0;
      sseStatus.value = 'connecting';
      _connect();
    },

    dispose() {
      _stopSse();
      _stopWaitTimer();
      _loadGen++;
      sessions.value.splice(0);
      sseRetryCount = 0;
      sseStatus.value = 'closed';
    },

    reconnect() {
      sseRetryCount = 0;
      sseStatus.value = 'connecting';
      _connect();
    },

    loadSessions,

    removeFromSessions(id: string) {
      const idx = sessions.value.findIndex((s) => s.id === id);
      if (idx !== -1) sessions.value.splice(idx, 1);
    },

    onEnqueue(handler) { enqueueHandlers.add(handler); },
    offEnqueue(handler) { enqueueHandlers.delete(handler); },
    onClosed(handler) { closedHandlers.add(handler); },
    offClosed(handler) { closedHandlers.delete(handler); },
    onTransfer(handler) { transferHandlers.add(handler); },
    offTransfer(handler) { transferHandlers.delete(handler); },
  };
}
```

- [ ] **Step 2: 运行测试，确认全部绿灯**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend && pnpm vitest run apps/src/composables/__tests__/useSessionQueueChannel.test.ts 2>&1 | tail -20
```

预期：所有用例 PASS，无 FAIL。

- [ ] **Step 3: Commit**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/composables/useSessionQueueChannel.ts apps/src/composables/__tests__/useSessionQueueChannel.test.ts
git commit -m "feat(@vben/web-antd): 重构 useSessionQueueChannel 为 flat sessions list + 四切片"
```

---

## Task 4: index.vue 改造

**Files:**
- Modify: `apps/src/views/customerservice/agent/index.vue`

**Interfaces:**
- Consumes:
  - `queueChannel.aiQueue: ComputedRef<QueueItem[]>`（Task 3）
  - `queueChannel.waitingQueue: ComputedRef<QueueItem[]>`（Task 3）
  - `queueChannel.activeQueue: ComputedRef<QueueItem[]>`（Task 3）
  - `queueChannel.closedQueue: ComputedRef<QueueItem[]>`（Task 3）
  - `queueChannel.loadSessions(): Promise<void>`（Task 3）
  - `queueChannel.removeFromSessions(id): void`（Task 3）
- Produces:
  - `aiQueue`, `waitingQueue`, `pagedWaitingQueue`, `visiblePagedWaitingQueue` — 传给 AgentLeftPanel
  - `closedSessions: ComputedRef<ClosedSessionItem[]>` — 来自 closedQueue 派生

---

- [ ] **Step 1: 更新 import，删除旧 API 函数引用**

将 `#/api/session` 的 import 中删除 `getActiveSessionsApi` 和 `getClosedSessionsApi`：

```typescript
import {
  acceptSessionApi,
  closeSessionApi,
  getOnlineAgentsApi,
  getSessionHistoryApi,
  transferSessionApi,
} from '#/api/session';
```

- [ ] **Step 2: 更新 channel 解构**

将 `index.vue` 中的 channel 解构从：
```typescript
const { queue, sseConnected } = queueChannel;
```
改为：
```typescript
const { aiQueue, waitingQueue, sseConnected } = queueChannel;
```

- [ ] **Step 3: 删除 `closedSessions` ref 和 `closedLoading`，改为 computed**

删除以下代码：
```typescript
const closedSessions = ref<ClosedSessionItem[]>([]);
const closedLoading = ref(false);
```

在其位置新增：
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

- [ ] **Step 4: 删除 `loadClosedSessions` 函数**

删除整个函数：
```typescript
async function loadClosedSessions() {
  closedLoading.value = true;
  try {
    // ...
  } finally {
    closedLoading.value = false;
  }
}
```

- [ ] **Step 5: 更新 `watch(queueStateTab)` — 移除 closedSessions 懒加载逻辑**

将原来的 watch 改为：
```typescript
watch(queueStateTab, (tab) => {
  if (tab !== 'closed') closedView.value = null;
});
```

- [ ] **Step 6: 更新分页目标为 `waitingQueue`**

将以下代码：
```typescript
const queueTotalPages = computed(() =>
  Math.max(1, Math.ceil(queue.value.length / 5)),
);
const pagedQueue = computed(() => {
  const start = (queuePage.value - 1) * 5;
  return queue.value.slice(start, start + 5);
});
watch(
  () => queue.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) queuePage.value = 1;
  },
);
```

替换为：
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

- [ ] **Step 7: 更新 `visiblePagedQueue` → `visiblePagedWaitingQueue`**

```typescript
const visiblePagedWaitingQueue = computed(() =>
  pagedWaitingQueue.value.filter((q) =>
    matchKeyword(queueSearch.value, q.name, q.tag, q.id),
  ),
);
```

同时删除旧的 `pagedQueue` 和 `visiblePagedQueue` 变量（已被上面替换）。

- [ ] **Step 8: 更新 `acceptItem` — 不再调用 `removeFromQueue`**

```typescript
async function acceptItem(item: QueueItem): Promise<ApiSessionItem> {
  await acceptSessionApi(item.id);
  // Channel 会通过 SSE ACCEPTED 事件自动将 status 改为 ACTIVE
  // 乐观更新：手动触发一次 removeFromSessions 防止 SSE 延迟时用户看到重复条目
  queueChannel.removeFromSessions(item.id);
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

- [ ] **Step 9: 简化 `onMounted` — 从 `activeQueue` 初始化进行中会话**

将 `onMounted` 中调用 `getActiveSessionsApi()` 的部分替换为：

```typescript
onMounted(async () => {
  queueChannel.onClosed(handleQueueClosed);
  queueChannel.onTransfer(handleQueueTransfer);

  // channel.loadSessions() 由 layouts/basic.vue 在登录时已调用
  // 直接从 activeQueue 切片取已接入的会话
  const activeSessions = queueChannel.activeQueue.value;

  if (activeSessions.length > 0) {
    const histories = await Promise.all(
      activeSessions.map((item) =>
        getSessionHistoryApi(item.id).catch(() => []),
      ),
    );
    activeSessions.forEach((item, idx) => {
      const history = histories[idx] ?? [];
      let maxSeq = 0;
      const loadedMsgs: Msg[] = history
        .filter((h) => !isTypingSignal(h.content))
        .map((h) => {
          const seqNum =
            h.seq === null || h.seq === undefined ? Number.NaN : Number(h.seq);
          if (Number.isFinite(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
          return historyItemToMsg(h);
        });
      if (maxSeq > 0) writeLastSeq(item.id, maxSeq);
      sessions.value.push({
        id: item.id,
        name: item.name,
        nameChar: item.name.at(0) ?? '',
        color: '#8b5cf6',
        min: '接待中',
        active: false,
        sessionCode: `#${item.id}`,
        transferReason: item.reason,
        tag: item.tag,
        waitSince: item.waitSince,
        unread: 0,
        msgs:
          loadedMsgs.length > 0
            ? loadedMsgs
            : [{ id: ++msgId, role: 'ai', text: '您好！请问有什么可以帮您？' }],
      });
    });
    if (sessions.value[0]) sessions.value[0].active = true;
    activeSessions.forEach((item) => connectAgentSession(item.id));
  }
});
```

- [ ] **Step 10: 更新传给 AgentLeftPanel 的 props**

```html
<AgentLeftPanel
  class="flex-[2] min-w-0"
  :agent-online="agentOnline"
  :concurrent="concurrent"
  :max-concurrent="MAX_CONCURRENT"
  :sse-connected="sseConnected"
  :queue-state-tab="queueStateTab"
  :ai-queue="aiQueue"
  :waiting-queue="waitingQueue"
  :paged-waiting-queue="pagedWaitingQueue"
  :queue-page="queuePage"
  :queue-total-pages="queueTotalPages"
  :queue-search="queueSearch"
  :visible-paged-waiting-queue="visiblePagedWaitingQueue"
  :visible-sessions="visibleSessions"
  :sessions="sessions"
  :closed-sessions="closedSessions"
  :closed-view="closedView"
  @toggle-online="agentOnline = $event"
  @update:queue-state-tab="queueStateTab = $event"
  @update:queue-page="queuePage = $event"
  @update:queue-search="queueSearch = $event"
  @accept-queue="acceptQueue"
  @switch-session="switchSession"
  @view-closed="viewClosedSession"
  @reconnect-queue="reconnectQueue"
/>
```

（删除 `:queue`、`:paged-queue`、`:visible-paged-queue`、`:closed-loading` 这四个旧 prop）

- [ ] **Step 11: TypeScript 检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend/apps && pnpm typecheck 2>&1 | grep -E "error TS|index\.vue" | head -20
```

预期：无 index.vue 相关的 TS 错误。

---

## Task 5: AgentLeftPanel.vue 改造

**Files:**
- Modify: `apps/src/views/customerservice/agent/AgentLeftPanel.vue`

**Interfaces:**
- Consumes:
  - `aiQueue: QueueItem[]`（Task 4 传入）
  - `waitingQueue: QueueItem[]`（Task 4 传入）
  - `pagedWaitingQueue: QueueItem[]`（Task 4 传入）
  - `visiblePagedWaitingQueue: QueueItem[]`（Task 4 传入）
  - `closedSessions: ClosedSessionItem[]`（Task 4 传入，来自 closedQueue 派生）

---

- [ ] **Step 1: 更新 `defineProps` — 拆分旧 `queue` 为四个专用 props，删除 `closedLoading`**

将原 props 定义替换为：

```typescript
const props = defineProps<{
  agentOnline: boolean;
  closedSessions: ClosedSessionItem[];
  closedView: ClosedView | null;
  concurrent: number;
  maxConcurrent: number;
  aiQueue: QueueItem[];                    // AI 对话 Tab
  waitingQueue: QueueItem[];               // 头部徽标计数 + 搜索无结果判断
  pagedWaitingQueue: QueueItem[];          // 等待人工 Tab（分页后）
  visiblePagedWaitingQueue: QueueItem[];   // 等待人工 Tab（分页+搜索过滤后）
  queuePage: number;
  queueSearch: string;
  queueStateTab: 'active' | 'ai' | 'closed' | 'waiting';
  queueTotalPages: number;
  sessions: SessionData[];
  sseConnected: boolean;
  visibleSessions: SessionData[];
  // 已删除：queue, pagedQueue, visiblePagedQueue, closedLoading
}>();
```

- [ ] **Step 2: 更新头部总数徽标**

将模板中：
```html
<span
  v-if="queue.length > 0"
  class="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1a73e8] px-1 text-[11px] text-white"
>
  {{ queue.length }}
</span>
```
改为：
```html
<span
  v-if="waitingQueue.length > 0"
  class="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1a73e8] px-1 text-[11px] text-white"
>
  {{ waitingQueue.length }}
</span>
```

- [ ] **Step 3: 更新 Tab 徽标**

将等待人工 Tab 的红点条件从 `queue.length` 改为 `waitingQueue.length`，并在 AI 对话 Tab 新增角标：

```html
<button
  v-for="tab in queueStateTabs"
  :key="tab.key"
  class="flex h-[26px] flex-1 items-center justify-center gap-1 rounded-md text-[11px] transition-colors"
  :class="
    queueStateTab === tab.key
      ? 'bg-[#1a73e8] font-medium text-white'
      : 'bg-transparent text-[#52525b] hover:text-[#0a0a0b]'
  "
  @click="
    emit(
      'update:queueStateTab',
      tab.key as 'ai' | 'active' | 'closed' | 'waiting',
    )
  "
>
  <!-- AI 对话 Tab 角标 -->
  <span
    v-if="tab.key === 'ai' && aiQueue.length"
    class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
    :class="
      queueStateTab === 'ai'
        ? 'bg-white/30 text-white'
        : 'bg-[#1a73e8]/10 text-[#1a73e8]'
    "
    >{{ aiQueue.length }}</span
  >
  <!-- 等待人工 Tab 红点 -->
  <span
    v-else-if="tab.key === 'waiting' && waitingQueue.length"
    class="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white"
    >{{ waitingQueue.length }}</span
  >
  <!-- 人工接待中 Tab 角标 -->
  <span
    v-else-if="tab.key === 'active' && sessions.length"
    class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
    :class="
      queueStateTab === 'active'
        ? 'bg-white/30 text-white'
        : 'bg-[#1a73e8]/10 text-[#1a73e8]'
    "
    >{{ sessions.length }}</span
  >
  {{ tab.label }}
</button>
```

- [ ] **Step 4: 更新 AI 对话 Tab 渲染，改用 `aiQueue`**

```html
<!-- AI 对话 Tab：展示当前 AI 自动处理中的队列项 -->
<template v-if="queueStateTab === 'ai'">
  <div v-if="aiQueue.length" class="space-y-1.5">
    <div
      v-for="item in aiQueue"
      :key="item.id"
      class="flex items-center gap-2 rounded-xl bg-white p-2.5"
    >
      <div
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white"
        :style="{ background: item.color }"
      >
        {{ item.name[0] }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-medium text-[#0a0a0b]">
          {{ item.name }}
        </p>
        <p class="text-[11px] text-[#1a73e8]">
          AI 处理中 · {{ item.waitMin }}
        </p>
      </div>
      <span class="flex h-2 w-2 shrink-0 items-center justify-center">
        <span class="relative flex h-2 w-2">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1a73e8] opacity-60"
          ></span>
          <span
            class="relative inline-flex h-2 w-2 rounded-full bg-[#1a73e8]"
          ></span>
        </span>
      </span>
    </div>
  </div>
  <div
    v-else
    class="flex flex-col items-center justify-center py-8 text-center"
  >
    <div
      class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#e8f0ff]"
    >
      <Icon icon="lucide:bot" class="text-lg text-[#1a73e8]" />
    </div>
    <p class="text-[12px] font-medium text-[#52525b]">暂无 AI 对话</p>
    <p class="mt-1 text-[11px] text-[#9ca3af]">
      AI 自动处理中的会话将在此显示
    </p>
  </div>
</template>
```

- [ ] **Step 5: 更新等待人工 Tab 渲染，改用 `visiblePagedWaitingQueue` / `waitingQueue`**

```html
<!-- 等待人工 Tab -->
<template v-else-if="queueStateTab === 'waiting'">
  <div v-if="visiblePagedWaitingQueue.length" class="space-y-2">
    <div
      v-for="item in visiblePagedWaitingQueue"
      :key="item.id"
      class="rounded-xl bg-white p-2.5"
    >
      <!-- 内容与原来完全相同，无需改动 -->
      <div class="flex items-center gap-2">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white"
          :style="{ background: item.color }"
        >
          {{ item.name[0] }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-[#0a0a0b]">
            {{ item.name }}
          </p>
          <p class="text-[11px] text-[#f59e0b]">
            等待 {{ item.waitMin }}
          </p>
        </div>
        <Tag :color="item.tagColor" class="shrink-0 !text-[11px]">
          {{ item.tag }}
        </Tag>
      </div>
      <p class="mt-1.5 truncate text-[11px] text-[#52525b]">
        {{ item.reason }}
      </p>
      <Button
        type="primary"
        size="small"
        block
        class="mt-2 !bg-[#1a73e8] !border-[#1a73e8]"
        @click="emit('acceptQueue', item)"
      >
        <template #icon><Icon icon="lucide:headphones" /></template>
        接入会话
      </Button>
    </div>
  </div>

  <!-- 搜索无结果 -->
  <div
    v-else-if="waitingQueue.length && !visiblePagedWaitingQueue.length"
    class="flex flex-col items-center justify-center py-8 text-center"
  >
    <Icon icon="lucide:search-x" class="mb-2 text-2xl text-[#e4e7ed]" />
    <p class="text-[12px] text-[#9ca3af]">
      未找到匹配"{{ queueSearch }}"的会话
    </p>
  </div>

  <!-- 队列为空 -->
  <div
    v-else
    class="flex flex-col items-center justify-center py-8 text-center"
  >
    <div
      class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#f0fdf4]"
    >
      <Icon icon="lucide:coffee" class="text-lg text-[#10b981]" />
    </div>
    <p class="text-[12px] font-medium text-[#52525b]">暂无等待用户</p>
    <p class="mt-1 text-[11px] text-[#9ca3af]">队列空空，轻松一下</p>
    <div class="mt-3 flex items-center gap-1.5">
      <span class="relative flex h-2 w-2">
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10b981] opacity-75"
        ></span>
        <span
          class="relative inline-flex h-2 w-2 rounded-full bg-[#10b981]"
        ></span>
      </span>
      <span class="text-[11px] text-[#10b981]">实时监听中</span>
    </div>
  </div>
</template>
```

- [ ] **Step 6: 更新已结束 Tab — 移除 `closedLoading` 和 `Spin`**

```html
<!-- 已结束 Tab -->
<template v-else-if="queueStateTab === 'closed'">
  <div v-if="closedSessions.length" class="space-y-1.5">
    <!-- 内容与原来相同，无需改动 -->
  </div>
  <div
    v-else
    class="flex flex-col items-center justify-center py-8 text-center"
  >
    <Icon icon="lucide:archive" class="mb-2 text-2xl text-[#e4e7ed]" />
    <p class="text-[12px] text-[#9ca3af]">暂无已结束会话</p>
  </div>
</template>
```

从 `<script setup>` 的 import 中移除 `Spin`（如无其他地方使用）。

- [ ] **Step 7: 更新分页区域的条件判断**

分页固定栏的显示条件从 `queue.length` 相关改为 `waitingQueue.length`（此区域只需检查 `queueStateTab === 'waiting' && queueTotalPages > 1`，原来已是该条件，无需改动）。确认模板底部分页区域引用仍使用 `queuePage`、`queueTotalPages`，无需额外修改。

- [ ] **Step 8: TypeScript 检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend/apps && pnpm typecheck 2>&1 | grep -E "error TS|AgentLeftPanel" | head -20
```

预期：无 AgentLeftPanel.vue 相关的 TS 错误。

- [ ] **Step 9: Commit**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/customerservice/agent/AgentLeftPanel.vue apps/src/views/customerservice/agent/index.vue
git commit -m "feat(@vben/web-antd): AgentLeftPanel props 拆分，四 Tab 绑定独立 queue 切片"
```

---

## Task 6: layouts/basic.vue 更新 + 全量验证

**Files:**
- Modify: `apps/src/layouts/basic.vue`

**Interfaces:**
- Consumes: `SessionQueueChannel.loadSessions(): Promise<void>`（Task 3）

---

- [ ] **Step 1: 更新 `basic.vue` 中的 `loadQueue` 调用为 `loadSessions`**

打开 `apps/src/layouts/basic.vue`，找到约第 184 行：

```typescript
await queueChannel.loadQueue();
```

改为：

```typescript
await queueChannel.loadSessions();
```

- [ ] **Step 2: TypeScript 全量检查**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend/apps && pnpm typecheck 2>&1 | grep "error TS" | head -30
```

预期：零 TS 错误。如有残留错误，根据文件路径定位并修复（常见原因：某处仍引用了已删除的 `queue` prop 或旧函数名）。

- [ ] **Step 3: 运行所有单元测试**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend && pnpm vitest run 2>&1 | tail -20
```

预期：全部 PASS，无 FAIL。

- [ ] **Step 4: 检查是否还有残留的旧 API 引用**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend && grep -r "getSessionQueueApi\|getActiveSessionsApi\|getClosedSessionsApi\|loadQueue\b\|\.queue\b\|pagedQueue\|visiblePagedQueue\b\|closedLoading" apps/src --include="*.ts" --include="*.vue" 2>/dev/null
```

预期：零输出。如有输出，逐一修复对应文件中的残留引用。

- [ ] **Step 5: 最终 commit**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/layouts/basic.vue
git commit -m "feat(@vben/web-antd): basic.vue 改用 loadSessions，完成会话队列统一接口改造"
```

---

## 自检清单

以下是对 spec 的逐项覆盖验证：

| Spec 要求 | 对应 Task | 状态 |
|---|---|---|
| 新增 `GET /api/v1/sessions` | Task 1 — `getAllSessionsApi` | ✓ |
| 删除旧三接口函数 | Task 1 | ✓ |
| `SessionQueueItem.status` 含 `AI_CHAT` | Task 1 | ✓ |
| `QueueItem.status` 字段 | Task 1 | ✓ |
| `toQueueItem` 映射 status | Task 1 | ✓ |
| 头像色按 status 分色 | Task 1 — `resolveStatusColor` | ✓ |
| Channel flat sessions list | Task 3 | ✓ |
| 四个 computed 切片 | Task 3 | ✓ |
| SSE ENQUEUE 原地插入/去重 | Task 3 | ✓ |
| SSE ACCEPTED → status ACTIVE | Task 3 | ✓ |
| SSE CLOSED → status CLOSED | Task 3 | ✓ |
| SSE TRANSFER → 移除条目 | Task 3 | ✓ |
| waitTimer 跳过 CLOSED 条目 | Task 3 | ✓ |
| `loadSessions` 用统一接口 | Task 3 | ✓ |
| `index.vue` onMounted 消费 activeQueue | Task 4 | ✓ |
| `closedSessions` 改 computed | Task 4 | ✓ |
| 删除 `loadClosedSessions` | Task 4 | ✓ |
| 分页目标改为 waitingQueue | Task 4 | ✓ |
| AgentLeftPanel props 拆分 | Task 5 | ✓ |
| AI Tab 绑定 aiQueue | Task 5 | ✓ |
| 等待 Tab 绑定 waitingQueue | Task 5 | ✓ |
| 已结束 Tab 移除 closedLoading | Task 5 | ✓ |
| basic.vue loadSessions 更新 | Task 6 | ✓ |
| 测试同步更新 | Task 2 + Task 3 | ✓ |
