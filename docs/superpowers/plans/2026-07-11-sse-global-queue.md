# SSE 全局队列订阅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将座席端 SSE 会话队列订阅（`/api/v1/sessions/events`）从 `customerservice/agent` 页面局部提升为全局连接，登录后即建连，离开 agent 页面不断线，有新排队事件时全局可感知。

**Architecture:** 仿照现有 `useAgentWsChannel` 的模块级单例模式，新建 `useSessionQueueChannel.ts`，将 SSE 连接生命周期绑定到 `accessToken`（在 `layouts/basic.vue` 里 `watch` 登录态）。`queue`、`sseConnected` 等响应式状态提升为模块级，通过单例暴露为只读 ref；页面级事件回调（如 agent 页面处理 CLOSED/TRANSFER）通过 `on/off` 监听器模式注册，不影响全局连接。`useSessionQueue.ts` 保留为纯工具函数文件（`formatWaitTime`、`resolveTagColor`、`QueueItem` 类型）。

**Tech Stack:** Vue 3 Composition API、Pinia (`useAccessStore`)、原生 `EventSource`、TypeScript、Vitest

## Global Constraints

- 不引入新的第三方依赖
- 保持与现有 `useAgentWsChannel` 一致的模块级单例模式（不用 Pinia store）
- `useSessionQueue.ts` 中的工具函数 `formatWaitTime`、`resolveTagColor`、`QueueItem` 类型保持公开导出，不破坏任何现有 import
- `agent/index.vue` 中的 SSE 断线横幅（`sseConnected`）和手动重连按钮逻辑保持可用
- 所有新增代码必须有 TypeScript 类型，不允许 `any`

---

## File Map

| 操作 | 文件 | 说明 |
|---|---|---|
| **新建** | `apps/src/composables/useSessionQueueChannel.ts` | 模块级 SSE 单例，对外暴露 queue/sseConnected/init/dispose/on/off/reconnect/loadQueue |
| **新建** | `apps/src/composables/__tests__/useSessionQueueChannel.test.ts` | 单元测试 |
| **修改** | `apps/src/composables/useSessionQueue.ts` | 移除 SSE 订阅逻辑，只保留工具函数和类型 |
| **修改** | `apps/src/layouts/basic.vue` | 增加 channel init/dispose 调用，绑定登录态 |
| **修改** | `apps/src/views/customerservice/agent/index.vue` | 删除本地 `useSessionQueue()` 调用，改用全局 channel |

---

## Task 1: 新建 `useSessionQueueChannel.ts` 单例

**Files:**
- Create: `apps/src/composables/useSessionQueueChannel.ts`

**Interfaces:**
- Consumes: `subscribeSessionEvents`, `getSessionQueueApi` from `#/api/session`; `formatWaitTime`, `resolveTagColor`, `QueueItem` from `#/composables/useSessionQueue`
- Produces:
  ```ts
  export interface SessionQueueChannel {
    readonly queue: Readonly<Ref<QueueItem[]>>
    readonly sseConnected: Readonly<Ref<boolean>>
    init(token: string): void
    dispose(): void
    reconnect(): void
    loadQueue(): Promise<void>
    on(event: 'enqueue' | 'closed' | 'transfer', handler: QueueEventHandler): void
    off(event: 'enqueue' | 'closed' | 'transfer', handler: QueueEventHandler): void
  }
  export type QueueEventHandler =
    | { event: 'enqueue'; handler: (item: QueueItem) => void }
    | { event: 'closed';  handler: (sessionId: string) => void }
    | { event: 'transfer'; handler: (event: SessionSseEvent) => void }
  export function useSessionQueueChannel(): SessionQueueChannel
  ```

- [ ] **Step 1: 新建文件，写模块级状态和类型**

```typescript
// apps/src/composables/useSessionQueueChannel.ts
import type { Ref } from 'vue';

import type { SessionSseEvent } from '#/api/session';
import type { QueueItem } from '#/composables/useSessionQueue';

import { ref } from 'vue';

import { message as antMessage } from 'ant-design-vue';

import { getSessionQueueApi, subscribeSessionEvents } from '#/api/session';
import {
  formatWaitTime,
  resolveTagColor,
  toQueueItem,
} from '#/composables/useSessionQueue';

// ---- 类型 ----

export type EnqueueHandler = (item: QueueItem) => void;
export type ClosedHandler = (sessionId: string) => void;
export type TransferHandler = (event: SessionSseEvent) => void;

export interface SessionQueueChannel {
  readonly queue: Readonly<Ref<QueueItem[]>>;
  readonly sseConnected: Readonly<Ref<boolean>>;
  init(token: string): void;
  dispose(): void;
  reconnect(): void;
  loadQueue(): Promise<void>;
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

// ---- 模块级单例状态 ----

const queue = ref<QueueItem[]>([]);
const sseConnected = ref(false);

let eventSource: EventSource | null = null;
let sseRetryCount = 0;
let sseRetryTimer: null | ReturnType<typeof setTimeout> = null;
let waitTimer: null | ReturnType<typeof setInterval> = null;

// 多播监听器
const enqueueHandlers = new Set<EnqueueHandler>();
const closedHandlers = new Set<ClosedHandler>();
const transferHandlers = new Set<TransferHandler>();
```

- [ ] **Step 2: 写内部函数 `_startWaitTimer` / `_stopWaitTimer` / `_stopSse`**

```typescript
function _stopWaitTimer(): void {
  if (waitTimer !== null) {
    clearInterval(waitTimer);
    waitTimer = null;
  }
}

function _startWaitTimer(): void {
  _stopWaitTimer();
  waitTimer = setInterval(() => {
    queue.value.forEach((item) => {
      item.waitMin = formatWaitTime(item.waitSince);
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
```

- [ ] **Step 3: 写内部函数 `_connect`（含指数退避重连逻辑）**

```typescript
function _connect(): void {
  _stopSse();

  eventSource = subscribeSessionEvents(
    (event) => {
      sseRetryCount = 0;
      const sid = event.item?.sessionId;
      if (!sid) return;

      if (event.type === 'ENQUEUE') {
        const item = event.item;
        if (!queue.value.some((q) => q.id === item.sessionId)) {
          const qi = toQueueItem(item);
          queue.value.push(qi);
          antMessage.info(`新会话请求：${item.userName}`);
          enqueueHandlers.forEach((h) => h(qi));
        }
      } else if (event.type === 'ACCEPTED' || event.type === 'CLOSED') {
        queue.value = queue.value.filter((q) => q.id !== sid);
        if (event.type === 'CLOSED') {
          closedHandlers.forEach((h) => h(sid));
        }
      } else if (event.type === 'TRANSFER') {
        queue.value = queue.value.filter((q) => q.id !== sid);
        transferHandlers.forEach((h) => h(event));
      }
    },
    () => {
      // 断线：指数退避重连
      sseConnected.value = false;
      eventSource?.close();
      eventSource = null;
      const delay = Math.min(BASE_DELAY_MS * 2 ** sseRetryCount, MAX_DELAY_MS);
      sseRetryCount++;
      sseRetryTimer = setTimeout(_connect, delay);
    },
    () => {
      sseRetryCount = 0;
      sseConnected.value = true;
    },
  );

  _startWaitTimer();
}
```

- [ ] **Step 4: 写 `loadQueue` 和导出单例函数**

```typescript
async function loadQueue(): Promise<void> {
  try {
    const items = await getSessionQueueApi();
    queue.value = items.map((item) => toQueueItem(item));
  } catch (error) {
    console.error('[useSessionQueueChannel] loadQueue 失败:', error);
  }
}

// ---- 导出单例 ----

export function useSessionQueueChannel(): SessionQueueChannel {
  return {
    queue,
    sseConnected,

    init(_token: string) {
      if (eventSource) return; // 幂等：已连接则不重复建连
      sseRetryCount = 0;
      _connect();
    },

    dispose() {
      _stopSse();
      _stopWaitTimer();
      queue.value = [];
      sseRetryCount = 0;
    },

    reconnect() {
      sseRetryCount = 0;
      _connect();
    },

    loadQueue,

    onEnqueue(handler) { enqueueHandlers.add(handler); },
    offEnqueue(handler) { enqueueHandlers.delete(handler); },
    onClosed(handler) { closedHandlers.add(handler); },
    offClosed(handler) { closedHandlers.delete(handler); },
    onTransfer(handler) { transferHandlers.add(handler); },
    offTransfer(handler) { transferHandlers.delete(handler); },
  };
}
```

- [ ] **Step 5: 确认 `useSessionQueue.ts` 需要导出 `toQueueItem`**

打开 `apps/src/composables/useSessionQueue.ts`，确认 `toQueueItem` 函数是否已导出。若没有，在该文件里将其从内部函数改为 `export function toQueueItem`（Task 2 会做这步，此处只确认）。

- [ ] **Step 6: 暂不提交（等 Task 2 一起），用 tsc 做类型检查**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd exec tsc --noEmit 2>&1 | head -40
```

Expected: 报 `toQueueItem` 找不到（因为 Task 2 还没做），其余无新增错误。

## Task 2: 重构 `useSessionQueue.ts` — 保留工具函数，导出 `toQueueItem`

**Files:**
- Modify: `apps/src/composables/useSessionQueue.ts`

**Interfaces:**
- Consumes: nothing new
- Produces (保持原有导出，新增):
  ```ts
  export function toQueueItem(item: ApiSessionItem): QueueItem   // 新增为 public
  // 以下保持不变:
  export function formatWaitTime(waitSince: number): string
  export function resolveTagColor(tag: string): string
  export interface QueueItem { ... }
  // 以下删除:
  // export function useSessionQueue(pageSize?)  ← 删除整个 composable
  ```

- [ ] **Step 1: 打开文件，确认当前 `toQueueItem` 是否已导出**

读取 `apps/src/composables/useSessionQueue.ts`，检查第 89 行附近的 `toQueueItem` 函数签名。

- [ ] **Step 2: 将 `useSessionQueue.ts` 精简为纯工具文件**

将文件内容替换为以下版本（删除所有 SSE、计时器、composable 逻辑，保留工具函数和类型）：

```typescript
// apps/src/composables/useSessionQueue.ts
import type { SessionQueueItem as ApiSessionItem } from '#/api/session';

// 标签颜色映射
const TAG_COLOR_MAP: Record<string, string> = {
  投诉: 'red',
  退款: 'orange',
  订单: 'blue',
  账单: 'blue',
};

export function resolveTagColor(tag: string): string {
  return TAG_COLOR_MAP[tag] ?? 'blue';
}

export function formatWaitTime(waitSince: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - waitSince));
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}小时${m}分钟`;
  }
  if (sec < 60) {
    return `${sec}秒`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分钟${String(s).padStart(2, '0')}秒`;
}

export interface QueueItem {
  id: string;
  name: string;
  color: string;
  waitMin: string;
  waitSince: number;
  reason: string;
  tag: string;
  tagColor: string;
}

/** 头像色常量，供 channel 和页面一致使用 */
export const QUEUE_AVATAR_COLOR = '#f87171';

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
  };
}
```

- [ ] **Step 3: 检查有没有其他文件导入了 `useSessionQueue`（组合式函数本体）**

```bash
grep -r "useSessionQueue" /Users/lycodeing/WebstormProjects/ai-customerservice-frontend/apps/src --include="*.ts" --include="*.vue" -l
```

Expected: 只有 `agent/index.vue` 和 `useSessionQueue.ts` 自身。Task 5 会更新 `agent/index.vue`。

- [ ] **Step 4: 确认 `acceptSessionApi` 在 agent 页面还能直接 import**

```bash
grep "acceptSessionApi" /Users/lycodeing/WebstormProjects/ai-customerservice-frontend/apps/src/views/customerservice/agent/index.vue
```

Expected: 找到现有 import，说明 `agent/index.vue` 已直接导入此 API，`acceptItem` 逻辑可内联在页面。

- [ ] **Step 5: 提交 Task 1 + Task 2**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
git add apps/src/composables/useSessionQueueChannel.ts apps/src/composables/useSessionQueue.ts
git commit -m "refactor(session-queue): 提取 SSE 单例 useSessionQueueChannel，精简 useSessionQueue 为工具函数"
```

## Task 3: 单元测试 `useSessionQueueChannel.test.ts`

**Files:**
- Create: `apps/src/composables/__tests__/useSessionQueueChannel.test.ts`

**Interfaces:**
- Consumes: `useSessionQueueChannel` from `#/composables/useSessionQueueChannel`
- Produces: 测试覆盖 init 幂等、ENQUEUE/ACCEPTED/CLOSED/TRANSFER 事件处理、断线重连、dispose 清理

- [ ] **Step 1: 参考 `useAgentWsChannel.test.ts` 的 MockWs 模式，新建测试文件**

```typescript
// apps/src/composables/__tests__/useSessionQueueChannel.test.ts
/**
 * useSessionQueueChannel 契约测试
 *
 * 覆盖范围：
 *   - init() 建立 SSE 连接（幂等，已连接时不重复建连）
 *   - ENQUEUE 事件：加入 queue，触发 onEnqueue 回调，去重
 *   - ACCEPTED 事件：从 queue 移除，不触发 onClosed
 *   - CLOSED 事件：从 queue 移除，触发 onClosed 回调
 *   - TRANSFER 事件：从 queue 移除，触发 onTransfer 回调
 *   - SSE 断线：sseConnected=false，触发指数退避重连
 *   - reconnect()：重置 retryCount，重新建连
 *   - dispose()：关闭连接，清空 queue，offEnqueue/offClosed/offTransfer 后不再触发
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// ---- Mock EventSource ----

interface MockEventSourceInstance {
  url: string;
  listeners: Record<string, ((e: { data?: string }) => void)[]>;
  closed: boolean;
  close(): void;
  addEventListener(type: string, handler: (e: { data?: string }) => void): void;
  emit(type: string, data?: unknown): void;
}

let lastEventSource: MockEventSourceInstance | null = null;

class MockEventSource implements MockEventSourceInstance {
  url: string;
  listeners: Record<string, ((e: { data?: string }) => void)[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    lastEventSource = this;
  }

  addEventListener(type: string, handler: (e: { data?: string }) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data?: unknown) {
    const handlers = this.listeners[type] ?? [];
    handlers.forEach((h) => h(data !== undefined ? { data: JSON.stringify(data) } : {}));
  }
}

vi.stubGlobal('EventSource', MockEventSource);

// ---- Mock ant-design-vue message ----
vi.mock('ant-design-vue', () => ({
  message: { info: vi.fn() },
}));

// ---- Mock useAccessStore ----
vi.mock('@vben/stores', () => ({
  useAccessStore: () => ({ accessToken: 'test-token' }),
}));

// ---- Import SUT ----
// 注意：模块级单例需要在每个 test 中通过 dispose() 重置状态
import { useSessionQueueChannel } from '../useSessionQueueChannel';
```

- [ ] **Step 2: 写 beforeEach 重置单例，写基础连接测试**

```typescript
describe('useSessionQueueChannel', () => {
  let channel: ReturnType<typeof useSessionQueueChannel>;

  beforeEach(async () => {
    // 每次测试前 dispose 重置模块级状态
    channel = useSessionQueueChannel();
    channel.dispose();
    lastEventSource = null;
    await nextTick();
  });

  // ---- init ----

  it('init() 建立 SSE 连接', () => {
    channel.init('token');
    expect(lastEventSource).not.toBeNull();
  });

  it('init() 幂等：已连接时不重复建连', () => {
    channel.init('token');
    const first = lastEventSource;
    channel.init('token');
    expect(lastEventSource).toBe(first);
  });

  it('open 回调设置 sseConnected=true', () => {
    channel.init('token');
    lastEventSource!.emit('open');
    expect(channel.sseConnected.value).toBe(true);
  });
```

- [ ] **Step 3: 写 ENQUEUE / ACCEPTED / CLOSED / TRANSFER 事件测试**

```typescript
  // ---- ENQUEUE ----

  it('ENQUEUE 事件加入 queue', async () => {
    channel.init('token');
    lastEventSource!.emit('open');
    lastEventSource!.emit('message', {
      type: 'ENQUEUE',
      item: { sessionId: 's1', userName: '张三', waitSince: 0, transferReason: '', tag: '订单' },
    });
    await nextTick();
    expect(channel.queue.value).toHaveLength(1);
    expect(channel.queue.value[0]!.id).toBe('s1');
  });

  it('ENQUEUE 事件触发 onEnqueue 回调', async () => {
    const handler = vi.fn();
    channel.init('token');
    channel.onEnqueue(handler);
    lastEventSource!.emit('open');
    lastEventSource!.emit('message', {
      type: 'ENQUEUE',
      item: { sessionId: 's2', userName: '李四', waitSince: 0, transferReason: '', tag: '' },
    });
    await nextTick();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].id).toBe('s2');
  });

  it('ENQUEUE 去重：同 sessionId 不重复添加', async () => {
    channel.init('token');
    lastEventSource!.emit('open');
    const payload = {
      type: 'ENQUEUE',
      item: { sessionId: 's3', userName: '王五', waitSince: 0, transferReason: '', tag: '' },
    };
    lastEventSource!.emit('message', payload);
    lastEventSource!.emit('message', payload);
    await nextTick();
    expect(channel.queue.value).toHaveLength(1);
  });

  it('ACCEPTED 事件从 queue 移除，不触发 onClosed', async () => {
    const closedHandler = vi.fn();
    channel.init('token');
    channel.onClosed(closedHandler);
    lastEventSource!.emit('open');
    lastEventSource!.emit('message', {
      type: 'ENQUEUE',
      item: { sessionId: 's4', userName: '赵六', waitSince: 0, transferReason: '', tag: '' },
    });
    lastEventSource!.emit('message', { type: 'ACCEPTED', item: { sessionId: 's4' } });
    await nextTick();
    expect(channel.queue.value).toHaveLength(0);
    expect(closedHandler).not.toHaveBeenCalled();
  });

  it('CLOSED 事件从 queue 移除并触发 onClosed', async () => {
    const closedHandler = vi.fn();
    channel.init('token');
    channel.onClosed(closedHandler);
    lastEventSource!.emit('open');
    lastEventSource!.emit('message', {
      type: 'ENQUEUE',
      item: { sessionId: 's5', userName: '陈七', waitSince: 0, transferReason: '', tag: '' },
    });
    lastEventSource!.emit('message', { type: 'CLOSED', item: { sessionId: 's5' } });
    await nextTick();
    expect(channel.queue.value).toHaveLength(0);
    expect(closedHandler).toHaveBeenCalledWith('s5');
  });

  it('TRANSFER 事件从 queue 移除并触发 onTransfer', async () => {
    const transferHandler = vi.fn();
    channel.init('token');
    channel.onTransfer(transferHandler);
    lastEventSource!.emit('open');
    lastEventSource!.emit('message', {
      type: 'ENQUEUE',
      item: { sessionId: 's6', userName: '周八', waitSince: 0, transferReason: '', tag: '' },
    });
    const transferEvent = {
      type: 'TRANSFER',
      item: { sessionId: 's6' },
      fromAgentId: 'a1',
      toAgentId: 'a2',
    };
    lastEventSource!.emit('message', transferEvent);
    await nextTick();
    expect(channel.queue.value).toHaveLength(0);
    expect(transferHandler).toHaveBeenCalledWith(expect.objectContaining({ type: 'TRANSFER' }));
  });
```

- [ ] **Step 4: 写断线重连和 dispose 测试**

```typescript
  // ---- 断线重连 ----

  it('SSE error 触发重连，sseConnected=false', async () => {
    vi.useFakeTimers();
    channel.init('token');
    lastEventSource!.emit('open');
    expect(channel.sseConnected.value).toBe(true);

    lastEventSource!.emit('error');
    await nextTick();
    expect(channel.sseConnected.value).toBe(false);

    // 触发第一次退避延时（1000ms）
    vi.advanceTimersByTime(1100);
    await nextTick();
    expect(lastEventSource).not.toBeNull(); // 已重连

    vi.useRealTimers();
  });

  it('reconnect() 立即重置并重建连接', async () => {
    channel.init('token');
    const first = lastEventSource;
    channel.reconnect();
    await nextTick();
    expect(lastEventSource).not.toBe(first);
  });

  // ---- dispose ----

  it('dispose() 关闭 SSE，清空 queue', async () => {
    channel.init('token');
    lastEventSource!.emit('open');
    lastEventSource!.emit('message', {
      type: 'ENQUEUE',
      item: { sessionId: 's7', userName: '吴九', waitSince: 0, transferReason: '', tag: '' },
    });
    await nextTick();
    expect(channel.queue.value).toHaveLength(1);

    channel.dispose();
    expect(channel.queue.value).toHaveLength(0);
    expect(channel.sseConnected.value).toBe(false);
    expect(lastEventSource!.closed).toBe(true);
  });

  it('offEnqueue 后不再触发回调', async () => {
    const handler = vi.fn();
    channel.init('token');
    channel.onEnqueue(handler);
    channel.offEnqueue(handler);
    lastEventSource!.emit('open');
    lastEventSource!.emit('message', {
      type: 'ENQUEUE',
      item: { sessionId: 's8', userName: '郑十', waitSince: 0, transferReason: '', tag: '' },
    });
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: 运行测试，确认全部通过**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd vitest run apps/src/composables/__tests__/useSessionQueueChannel.test.ts
```

Expected: 所有测试 PASS，0 failed。

- [ ] **Step 6: 提交**

```bash
git add apps/src/composables/__tests__/useSessionQueueChannel.test.ts
git commit -m "test(session-queue): 新增 useSessionQueueChannel 单元测试（10 cases）"
```

## Task 4: 在 `layouts/basic.vue` 绑定全局 SSE 生命周期

**Files:**
- Modify: `apps/src/layouts/basic.vue`

**Interfaces:**
- Consumes: `useSessionQueueChannel` from `#/composables/useSessionQueueChannel`
- Produces: SSE channel 随 `accessToken` 出现/消失而 init/dispose，方式与 WS channel 完全一致

- [ ] **Step 1: 在 `basic.vue` 的 import 区块加入 channel**

在 `apps/src/layouts/basic.vue` 第 23 行（`useAgentWsChannel` 的 import 下面）新增一行：

```typescript
import { useSessionQueueChannel } from '#/composables/useSessionQueueChannel';
```

- [ ] **Step 2: 在 `watch(accessStore.accessToken)` 块之后（第 171 行后）添加 SSE channel 生命周期绑定**

在现有 WS channel watch 块（约第 141-171 行）之后，紧接着插入：

```typescript
// ===== 座席端 SSE Queue Channel 生命周期（绑定登录态） =====
// 随 WS Channel 同步建连/销毁，保证离开 agent 页面后队列推送不中断。
const queueChannel = useSessionQueueChannel();

watch(
  () => accessStore.accessToken,
  async (newToken, oldToken) => {
    if (newToken && !oldToken) {
      // 首次登录：加载初始队列 + 建立 SSE 连接
      queueChannel.init(newToken);
      await queueChannel.loadQueue();
    } else if (!newToken) {
      // 登出：销毁 SSE channel
      queueChannel.dispose();
    }
    // token 刷新时 SSE 连接不受影响（EventSource 使用 cookie/query-token，
    // token 变更后浏览器下一次重连自动携带新 token）
  },
  { immediate: true },
);
```

- [ ] **Step 3: 运行 tsc 类型检查，确认无新增错误**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd exec tsc --noEmit 2>&1 | head -40
```

Expected: 0 新增错误（此时 agent/index.vue 仍用旧接口，会有已知错误，Task 5 修复）。

- [ ] **Step 4: 提交**

```bash
git add apps/src/layouts/basic.vue
git commit -m "feat(layout): 绑定 SSE QueueChannel 生命周期到登录态，全局持有队列连接"
```

---

## Task 5: 更新 `agent/index.vue` — 改用全局 channel

**Files:**
- Modify: `apps/src/views/customerservice/agent/index.vue`

**Interfaces:**
- Consumes:
  - `useSessionQueueChannel()` → `{ queue, sseConnected, reconnect, onEnqueue, offEnqueue, onClosed, offClosed, onTransfer, offTransfer }` from `#/composables/useSessionQueueChannel`
  - `toQueueItem`, `QueueItem`, `formatWaitTime`, `resolveTagColor` from `#/composables/useSessionQueue`（保持现有 import）
- Produces: 页面行为与之前完全一致，但 SSE 连接改由全局 channel 持有

- [ ] **Step 1: 替换 import — 移除 `useSessionQueue` composable，改 import `useSessionQueueChannel`**

找到现有 import 行（约第 44-46 行）：

```typescript
import {
  resolveTagColor,
  useSessionQueue,
} from '#/composables/useSessionQueue';
```

替换为：

```typescript
import {
  formatWaitTime,
  resolveTagColor,
  toQueueItem,
} from '#/composables/useSessionQueue';
import { useSessionQueueChannel } from '#/composables/useSessionQueueChannel';
```

（`formatWaitTime` 原来由 `useSessionQueue` composable 内部使用，此处可能已从别处 import；检查页面里是否直接用到了 `formatWaitTime`，按实际情况增减。）

- [ ] **Step 2: 替换 composable 调用 — 删除 `useSessionQueue()` 展开，改用全局 channel**

找到并删除以下代码块（约第 259 行附近）：

```typescript
const {
  queue,
  queuePage,
  queueTotalPages,
  pagedQueue,
  sseConnected,
  loadQueue,
  subscribeQueue,
  acceptItem,
  reconnect: reconnectQueue,
} = useSessionQueue();
```

替换为：

```typescript
// ===== 全局 SSE Queue Channel（由 layouts/basic.vue 持有连接） =====
const queueChannel = useSessionQueueChannel();
const { queue, sseConnected } = queueChannel;

// 分页（局部，保持原有逻辑）
const queuePage = ref(1);
const queueTotalPages = computed(() =>
  Math.max(1, Math.ceil(queue.value.length / 5)),
);
const pagedQueue = computed(() => {
  const start = (queuePage.value - 1) * 5;
  return queue.value.slice(start, start + 5);
});
// N-01: 仅在新会话入队时（长度增大）才重置分页
watch(
  () => queue.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) queuePage.value = 1;
  },
);

function reconnectQueue() {
  queueChannel.reconnect();
}
```

- [ ] **Step 3: 重构 `acceptItem` — 内联为页面局部函数**

原来 `acceptItem` 由 `useSessionQueue` 提供，现在 composable 被删除，需在页面内补充：

```typescript
async function acceptItem(item: QueueItem): Promise<ApiSessionItem> {
  await acceptSessionApi(item.id);
  queue.value = queue.value.filter((q) => q.id !== item.id);
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

（检查 `acceptSessionApi` 是否已在文件顶部 import，约第 36 行，应已存在。）

- [ ] **Step 4: 重构 `onMounted` — 删除 `loadQueue` 和 `subscribeQueue` 调用，改为注册事件监听器**

找到 `onMounted` 块（约第 701-748 行），将：

```typescript
onMounted(async () => {
  const [, activeSessions] = await Promise.all([
    loadQueue(),
    getActiveSessionsApi().catch(() => [] as ApiSessionItem[]),
  ]);
  // ...
  subscribeQueue(undefined, handleQueueClosed, handleQueueTransfer);
});
```

修改为：

```typescript
onMounted(async () => {
  // queue 初始数据由 layouts/basic.vue 在登录时已通过 queueChannel.loadQueue() 加载
  // 此处只需注册页面级事件回调
  queueChannel.onClosed(handleQueueClosed);
  queueChannel.onTransfer(handleQueueTransfer);

  const activeSessions = await getActiveSessionsApi().catch(
    () => [] as ApiSessionItem[],
  );

  if (activeSessions.length > 0) {
    const histories = await Promise.all(
      activeSessions.map((item) =>
        getSessionHistoryApi(item.sessionId).catch(() => []),
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
      if (maxSeq > 0) writeLastSeq(item.sessionId, maxSeq);
      sessions.value.push({
        id: item.sessionId,
        name: item.userName,
        nameChar: item.userName.at(0) ?? '',
        color: '#8b5cf6',
        min: '接待中',
        active: false,
        sessionCode: `#${item.sessionId}`,
        transferReason: item.transferReason,
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
    activeSessions.forEach((item) => connectAgentSession(item.sessionId));
  }
});
```

- [ ] **Step 5: 在 `onUnmounted` 中注销事件监听器**

找到 `onUnmounted` 块（约第 751-754 行），增加 off 调用：

```typescript
onUnmounted(() => {
  typingTimers.forEach((timer) => clearTimeout(timer));
  typingTimers.clear();
  // 离开页面时注销，防止多次进入页面导致回调重复执行
  queueChannel.offClosed(handleQueueClosed);
  queueChannel.offTransfer(handleQueueTransfer);
});
```

- [ ] **Step 6: 运行 tsc 类型检查**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd exec tsc --noEmit 2>&1 | head -60
```

Expected: 0 errors。

- [ ] **Step 7: 运行全量单元测试**

```bash
pnpm --filter @vben/web-antd vitest run
```

Expected: 所有测试 PASS（包含新增的 useSessionQueueChannel.test.ts）。

- [ ] **Step 8: 提交**

```bash
git add apps/src/views/customerservice/agent/index.vue
git commit -m "refactor(agent): 改用全局 SSE QueueChannel，离开页面不断线"
```

## 自检：Spec 覆盖 & Placeholder 扫描

### Spec 覆盖检查

| 需求 | 覆盖任务 |
|---|---|
| SSE 连接提升为全局，登录即建连 | Task 1（单例）+ Task 4（basic.vue 绑定） |
| 登出时销毁 SSE 连接 | Task 4（dispose on !newToken） |
| queue / sseConnected 全局可读 | Task 1（模块级 ref） |
| agent 页面仍可使用 queue 数据 | Task 5（直接从 channel 读取） |
| SSE 断线横幅 + 手动重连按钮 | Task 5（sseConnected / reconnectQueue 保持） |
| 页面级 CLOSED/TRANSFER 回调 | Task 5（onMounted 注册，onUnmounted 注销） |
| 工具函数 formatWaitTime / resolveTagColor / QueueItem 继续导出 | Task 2 |
| 单元测试覆盖新 channel | Task 3（10 cases） |
| 不引入新依赖 | 所有 Task 均使用原有依赖 |

### Placeholder 扫描

- 无 TBD / TODO / "implement later"
- 所有代码步骤均含完整代码块
- 类型名在 Task 1 定义，Task 3/5 使用一致
- `toQueueItem` 在 Task 2 导出，Task 1/5 使用同一名称
- `handleQueueClosed` / `handleQueueTransfer` 在 agent/index.vue 中已存在，Task 5 直接复用

### 类型一致性确认

- `QueueItem` — 定义于 `useSessionQueue.ts`（Task 2），被 `useSessionQueueChannel.ts`（Task 1）和 `agent/index.vue`（Task 5）消费
- `SessionSseEvent` — 来自 `#/api/session`，贯穿 Task 1/3/5
- `EnqueueHandler / ClosedHandler / TransferHandler` — 定义于 Task 1，被 Task 3 测试引用（通过 `useSessionQueueChannel()` 返回接口）
- `SessionQueueChannel.queue` 类型为 `Readonly<Ref<QueueItem[]>>`，Task 5 解构时 `const { queue, sseConnected } = queueChannel` 类型正确
