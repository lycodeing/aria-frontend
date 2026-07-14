# 座席端 WebSocket 单连接多路复用 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将座席端"一会话一 WebSocket"改造为"一座席一 WebSocket 单连接多路复用"，消除冗余连接，统一生命周期管理。

**Architecture:** 新增模块级单例 `useAgentWsChannel`（传输+路由层），通过 `subscriberMap` 按 `sessionId` 分发消息；改造 `useAgentWebSocket` 为订阅层（对外接口不变）；在 `layouts/basic.vue` 中 watch accessToken 驱动 channel 生命周期；后端新增 `/ws/agent` 端点 + `AgentConnectionRegistry`（支持 BROADCAST/KICK 两种多登录模式）。

**Tech Stack:** Vue 3 + TypeScript + Pinia（@vben/stores）、Spring WebSocket（后端参考设计）、Vitest（单元测试）

## Global Constraints

- TypeScript strict mode；所有新文件须通过 `turbo run typecheck`
- 提交信息格式：`feat/fix/refactor/docs(@vben/web-antd): <描述>`
- 测试命令：`pnpm test:unit`（项目根目录）
- 前端文件路径均相对于 `apps/src/`
- 对外接口（`useAgentWebSocket` 返回值）保持不变，调用方零改动
- 访客端（`useVisitorWs.ts`）不修改
- 多登录模式默认 `BROADCAST`

---

## Task 1: 更新消息类型定义 & 废弃旧 connectAgentWs

**Files:**
- Modify: `apps/src/api/session/index.ts:49-61` (WsChatMessage 类型)
- Modify: `apps/src/api/session/index.ts:287-309` (connectAgentWs 函数标注废弃)

**Interfaces:**
- Produces: `WsChatMessage.type` 新增 `'KICKED_OUT'`，供 Task 2 的 channel 消费

- [ ] **Step 1: 修改 WsChatMessage 类型，新增 KICKED_OUT**

```ts
// apps/src/api/session/index.ts — 第 49 行
export interface WsChatMessage {
  type: 'AGENT_JOINED' | 'CONNECTED' | 'KICKED_OUT' | 'MESSAGE' | 'TYPING';
  sessionId: string;
  role?: 'agent' | 'user';
  content?: string;
  seq?: number | string;
  timestamp?: number;
}
```

- [ ] **Step 2: 给 connectAgentWs 加废弃注释**

```ts
// apps/src/api/session/index.ts — connectAgentWs 函数上方
/**
 * @deprecated 改造为单连接多路复用后，座席端不再直接使用此函数。
 * 请通过 useAgentWsChannel.init() 建立连接。
 * 访客端 connectVisitorWs 不受影响。
 */
export function connectAgentWs(
  // ... 函数体保持不变
```

- [ ] **Step 3: 运行 typecheck 确认无错误**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
pnpm --filter @vben/web-antd typecheck
```

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add apps/src/api/session/index.ts
git commit -m "refactor(@vben/web-antd): WsChatMessage 新增 KICKED_OUT 类型，标注 connectAgentWs 废弃"
```

---

## Task 2: 新增 useAgentWsChannel（传输 + 路由层）

**Files:**
- Create: `apps/src/composables/useAgentWsChannel.ts`

**Interfaces:**
- Consumes: `WsChatMessage`（含 `KICKED_OUT`）from `#/api/session`
- Produces:
  - `useAgentWsChannel(): AgentWsChannel`
  - `AgentWsChannel.init(token, options?)` — 建连，幂等
  - `AgentWsChannel.dispose()` — 断连，清理
  - `AgentWsChannel.subscribe(sessionId, callbacks)` — 注册会话回调
  - `AgentWsChannel.unsubscribe(sessionId)` — 注销会话回调
  - `AgentWsChannel.send(sessionId, content): boolean`
  - `AgentWsChannel.sendTyping(sessionId): void`
  - `AgentWsChannel.status: Ref<'closed'|'connecting'|'open'|'error'|'kicked'>`

- [ ] **Step 1: 创建文件，写入完整实现**

```ts
// apps/src/composables/useAgentWsChannel.ts
import type { Ref } from 'vue';
import type { WsChatMessage } from '#/api/session';

import { ref } from 'vue';

// ---- 类型定义 ----

export interface ChannelCallbacks {
  onMessage: (msg: WsChatMessage) => void;
  onTyping?: (sessionId: string) => void;
  onReconnect?: (sessionId: string) => void;
}

export interface AgentWsChannelOptions {
  // multiLoginMode 由后端 application.yml 配置，前端无需传递
  onKickedOut?: () => void;
}

export interface AgentWsChannel {
  init(token: string, options?: AgentWsChannelOptions): void;
  /**
   * token 刷新时调用：只更换 token 重建 WS，不清 subscriberMap。
   * 与 dispose()+init() 的区别：保留所有会话订阅，避免 token 刷新导致消息丢失。
   */
  reconnect(newToken: string): void;
  dispose(): void;
  subscribe(sessionId: string, callbacks: ChannelCallbacks): void;
  unsubscribe(sessionId: string): void;
  send(sessionId: string, content: string): boolean;
  sendTyping(sessionId: string): void;
  readonly status: Ref<'closed' | 'connecting' | 'error' | 'kicked' | 'open'>;
}

// ---- 重连常量 ----
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRIES = 10;
const HEARTBEAT_MS = 12_000;

// ---- 模块级单例状态 ----
let ws: null | WebSocket = null;
let _token = '';
let retryCount = 0;
let retryTimer: null | ReturnType<typeof setTimeout> = null;
let heartbeatTimer: null | ReturnType<typeof setInterval> = null;
let kicked = false;
let _onKickedOut: (() => void) | undefined;

const subscriberMap = new Map<string, Set<ChannelCallbacks>>();
const status = ref<'closed' | 'connecting' | 'error' | 'kicked' | 'open'>('closed');

// ---- 内部函数 ----

function buildWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/agent?token=${encodeURIComponent(_token)}`;
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!ws) { stopHeartbeat(); return; }
    const dead =
      ws.readyState === WebSocket.CLOSED ||
      ws.readyState === WebSocket.CLOSING ||
      !navigator.onLine;
    if (dead && status.value === 'open') {
      ws.close();
    }
  }, HEARTBEAT_MS);
}

function scheduleReconnect(): void {
  if (retryCount >= MAX_RETRIES) {
    status.value = 'error';
    return;
  }
  const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retryCount);
  retryCount++;
  retryTimer = setTimeout(connect, delay);
}

function onOpen(): void {
  status.value = 'open';
  retryCount = 0;
  startHeartbeat();
  // 通知所有订阅会话：channel 已恢复
  subscriberMap.forEach((cbs, sessionId) => {
    cbs.forEach((cb) => cb.onReconnect?.(sessionId));
  });
}

function onMessage(event: MessageEvent): void {
  let msg: WsChatMessage;
  try {
    msg = JSON.parse(event.data as string) as WsChatMessage;
  } catch {
    return;
  }

  // 被踢出：不重连，通知 UI
  if (msg.type === 'KICKED_OUT') {
    kicked = true;
    status.value = 'kicked';
    ws?.close();
    _onKickedOut?.();
    return;
  }

  const { sessionId, type } = msg;
  if (!sessionId) return;

  const cbs = subscriberMap.get(sessionId);
  if (!cbs) return;

  cbs.forEach((cb) => {
    if (type === 'TYPING') {
      cb.onTyping?.(sessionId);
    } else {
      cb.onMessage(msg);
    }
  });
}

function onClose(this: WebSocket): void {
  // 只清理触发 onclose 的那个实例，防止 dispose()+init() 后旧连接的 onclose 抹掉新 ws
  if (ws === this) ws = null;
  stopHeartbeat();
  // 先判断 kicked（语义更清晰），再判断 status
  if (!kicked && status.value !== 'closed') {
    status.value = 'connecting';
    scheduleReconnect();
  }
}

function onError(): void {
  // 握手失败（401）时浏览器触发 onerror 后紧跟 onclose；
  // 若 status 已到 'error'（重试耗尽），basic.vue 负责监听并触发 token 刷新
}

function onBrowserOffline(): void {
  if (ws && status.value === 'open') {
    ws.close();
  }
}

function connect(): void {
  if (
    ws &&
    (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
  ) return;

  status.value = 'connecting';
  // 捕获当前实例，onclose 回调用 this 而非闭包 ws，防止竞态覆盖
  const socket = new WebSocket(buildWsUrl());
  ws = socket;
  socket.addEventListener('open', onOpen);
  socket.addEventListener('message', onMessage);
  // 用普通函数而非箭头函数，让 onClose 可通过 this 拿到对应实例
  socket.addEventListener('close', function (this: WebSocket) { onClose.call(this); });
  socket.addEventListener('error', onError);
}

// ---- 导出单例 ----

export function useAgentWsChannel(): AgentWsChannel {
  return {
    init(t: string, options?: AgentWsChannelOptions) {
      if (ws) return; // 幂等
      _token = t;
      kicked = false;
      _onKickedOut = options?.onKickedOut;
      window.addEventListener('offline', onBrowserOffline);
      connect();
    },
    /**
     * token 刷新时调用：只换 token 重建 WS，保留 subscriberMap。
     * 不能用 dispose()+init()，因为 dispose 会清空订阅，token 刷新后会话静默丢消息。
     */
    reconnect(newToken: string) {
      _token = newToken;
      kicked = false;
      // 清除重连计时器，终止退避循环
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      retryCount = 0;
      stopHeartbeat();
      ws?.close(); // 触发 onclose，但 subscriberMap 不清
      // onclose 异步触发后会调 scheduleReconnect，但 retryCount 已重置
      // 直接立即重连更可靠：强制状态并建连
      status.value = 'connecting';
      // 延迟一个 tick，确保旧 ws 的 close 事件已发出
      setTimeout(connect, 0);
    },
    dispose() {
      status.value = 'closed';
      kicked = false;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      stopHeartbeat();
      window.removeEventListener('offline', onBrowserOffline);
      ws?.close();
      ws = null;
      // 注意：不清 subscriberMap，token 刷新走 reconnect()；
      // 只有真正登出时才调 dispose()，此时组件也会卸载，订阅自然消亡
    },
    subscribe(sessionId: string, callbacks: ChannelCallbacks) {
      if (!subscriberMap.has(sessionId)) subscriberMap.set(sessionId, new Set());
      subscriberMap.get(sessionId)!.add(callbacks);
    },
    unsubscribe(sessionId: string) {
      subscriberMap.delete(sessionId);
    },
    send(sessionId: string, content: string): boolean {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'MESSAGE', sessionId, content }));
      return true;
    },
    sendTyping(sessionId: string): void {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'TYPING', sessionId }));
    },
    status,
  };
}
```

- [ ] **Step 2: 运行 typecheck**

```bash
pnpm --filter @vben/web-antd typecheck
```

Expected: 无类型错误

- [ ] **Step 3: 写单元测试**

```ts
// apps/src/composables/__tests__/useAgentWsChannel.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock WebSocket
class MockWs {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static CONNECTING = 0;
  readyState = MockWs.OPEN;
  listeners: Record<string, Function[]> = {};
  sent: string[] = [];

  addEventListener(evt: string, fn: Function) {
    (this.listeners[evt] ??= []).push(fn);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWs.CLOSED; }
  emit(evt: string, ...args: any[]) {
    (this.listeners[evt] ?? []).forEach(fn => fn(...args));
  }
}

let mockWsInstance: MockWs;
vi.stubGlobal('WebSocket', vi.fn(() => {
  mockWsInstance = new MockWs();
  return mockWsInstance;
}));

// 重置模块级单例需 vi.resetModules()
describe('useAgentWsChannel', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('init 后建立 WS 连接', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('test-token');
    expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('/ws/agent?token=test-token'));
    ch.dispose();
  });

  it('send 发送正确格式', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    mockWsInstance.emit('open');
    const ok = ch.send('sid-A', 'hello');
    expect(ok).toBe(true);
    expect(JSON.parse(mockWsInstance.sent[0])).toEqual({
      type: 'MESSAGE', sessionId: 'sid-A', content: 'hello',
    });
    ch.dispose();
  });

  it('KICKED_OUT 消息设置 status=kicked 并调用 onKickedOut', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const onKickedOut = vi.fn();
    const ch = useAgentWsChannel();
    ch.init('tok', { onKickedOut });
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', { data: JSON.stringify({ type: 'KICKED_OUT' }) });
    expect(ch.status.value).toBe('kicked');
    expect(onKickedOut).toHaveBeenCalledOnce();
    ch.dispose();
  });

  it('subscribe 后收到对应 sessionId 消息触发回调', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    const onMessage = vi.fn();
    ch.subscribe('sid-A', { onMessage });
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', {
      data: JSON.stringify({ type: 'MESSAGE', sessionId: 'sid-A', role: 'user', content: 'hi' }),
    });
    expect(onMessage).toHaveBeenCalledOnce();
    ch.dispose();
  });

  it('unsubscribe 后不再触发回调', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    const onMessage = vi.fn();
    ch.subscribe('sid-A', { onMessage });
    ch.unsubscribe('sid-A');
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', {
      data: JSON.stringify({ type: 'MESSAGE', sessionId: 'sid-A', role: 'user', content: 'hi' }),
    });
    expect(onMessage).not.toHaveBeenCalled();
    ch.dispose();
  });

  it('CONNECTING 状态下 init 幂等：不重复建连', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    mockWsInstance = new MockWs();
    mockWsInstance.readyState = MockWs.CONNECTING; // 模拟连接中
    const ch = useAgentWsChannel();
    ch.init('tok');
    const callCount = (WebSocket as any).mock.calls.length;
    // 再次 init 不应新建 WebSocket
    ch.init('tok');
    expect((WebSocket as any).mock.calls.length).toBe(callCount);
    ch.dispose();
  });

  it('reconnect 更换 token 重建连接，不清 subscriberMap', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('old-token');
    const onMessage = vi.fn();
    ch.subscribe('sid-A', { onMessage });
    mockWsInstance.emit('open');

    // token 刷新
    ch.reconnect('new-token');

    // subscriberMap 保留，新连接建立后仍能收到消息
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', {
      data: JSON.stringify({ type: 'MESSAGE', sessionId: 'sid-A', role: 'user', content: 'after-reconnect' }),
    });
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'after-reconnect' }),
    );
    ch.dispose();
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
pnpm test:unit -- composables/__tests__/useAgentWsChannel.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/src/composables/useAgentWsChannel.ts apps/src/composables/__tests__/useAgentWsChannel.test.ts
git commit -m "feat(@vben/web-antd): 新增 useAgentWsChannel 单连接传输层"
```

---

## Task 3: 改造 useAgentWebSocket（订阅层）

**Files:**
- Modify: `apps/src/composables/useAgentWebSocket.ts`

**Interfaces:**
- Consumes: `useAgentWsChannel(): AgentWsChannel` from `./useAgentWsChannel`
- Produces: 对外接口与改造前完全一致：
  - `connectSession(sessionId: string): void`
  - `disconnectSession(sessionId: string): void`
  - `sendMessage(sessionId: string, content: string): boolean`
  - `disconnectAll(): void`
  - `statusMap: reactive Record<string, WsStatus>`
  - `getStatus(sessionId: string): WsStatus`

- [ ] **Step 1: 将 useAgentWebSocket.ts 替换为订阅层实现**

```ts
// apps/src/composables/useAgentWebSocket.ts
import type { WsChatMessage } from '#/api/session';

import { onScopeDispose, reactive, watch } from 'vue';

import { useAgentWsChannel } from './useAgentWsChannel';

export type WsStatus = 'closed' | 'connecting' | 'error' | 'open';

export interface AgentWebSocketOptions {
  onUserMessage: (sessionId: string, msg: WsChatMessage) => void;
  onTyping?: (sessionId: string) => void;
  onReconnect?: (sessionId: string) => void;
  onStatusChange?: (sessionId: string, status: WsStatus) => void;
}

export function useAgentWebSocket(options: AgentWebSocketOptions) {
  const channel = useAgentWsChannel();
  const subscribedSessions = new Set<string>();
  const statusMap = reactive<Record<string, WsStatus>>({});

  // channel 整体状态变化时同步到所有已订阅会话
  watch(channel.status, (s) => {
    const mapped: WsStatus =
      s === 'open' ? 'open'
      : s === 'connecting' ? 'connecting'
      : s === 'error' ? 'error'
      : 'closed';
    for (const sid of subscribedSessions) {
      statusMap[sid] = mapped;
      options.onStatusChange?.(sid, mapped);
    }
  });

  function connectSession(sessionId: string): void {
    if (subscribedSessions.has(sessionId)) return; // 幂等
    subscribedSessions.add(sessionId);
    statusMap[sessionId] = channel.status.value === 'open' ? 'open' : 'connecting';

    channel.subscribe(sessionId, {
      onMessage(msg) {
        if (msg.type === 'MESSAGE' && msg.role === 'user') {
          options.onUserMessage(sessionId, msg);
        }
      },
      onTyping() {
        options.onTyping?.(sessionId);
      },
      onReconnect() {
        statusMap[sessionId] = 'open';
        options.onReconnect?.(sessionId);
      },
    });
  }

  function disconnectSession(sessionId: string): void {
    subscribedSessions.delete(sessionId);
    channel.unsubscribe(sessionId);
    statusMap[sessionId] = 'closed';
    options.onStatusChange?.(sessionId, 'closed');
  }

  function sendMessage(sessionId: string, content: string): boolean {
    return channel.send(sessionId, content);
  }

  function getStatus(sessionId: string): WsStatus {
    return statusMap[sessionId] ?? 'closed';
  }

  function disconnectAll(): void {
    for (const sid of subscribedSessions) {
      channel.unsubscribe(sid);
      statusMap[sid] = 'closed';
    }
    subscribedSessions.clear();
    // 不调用 channel.dispose()，channel 生命周期由登录态（basic.vue）管理
  }

  // 组件卸载时自动清理订阅，防止回调泄漏
  onScopeDispose(() => disconnectAll());

  return {
    connectSession,
    disconnectSession,
    sendMessage,
    disconnectAll,
    statusMap,
    getStatus,
  };
}
```

- [ ] **Step 2: 运行 typecheck**

```bash
pnpm --filter @vben/web-antd typecheck
```

Expected: 无类型错误

- [ ] **Step 3: 写单元测试**

```ts
// apps/src/composables/__tests__/useAgentWebSocket.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock useAgentWsChannel
const mockChannel = {
  status: { value: 'open' as const },
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  send: vi.fn().mockReturnValue(true),
  sendTyping: vi.fn(),
  init: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('../useAgentWsChannel', () => ({
  useAgentWsChannel: () => mockChannel,
}));

describe('useAgentWebSocket', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('connectSession 订阅 channel 并设置 statusMap', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const onUserMessage = vi.fn();
    const { connectSession, statusMap } = useAgentWebSocket({ onUserMessage });
    connectSession('sid-A');
    expect(mockChannel.subscribe).toHaveBeenCalledWith('sid-A', expect.any(Object));
    expect(statusMap['sid-A']).toBe('open');
  });

  it('connectSession 幂等：重复调用不重复订阅', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession } = useAgentWebSocket({ onUserMessage: vi.fn() });
    connectSession('sid-A');
    connectSession('sid-A');
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('disconnectSession 注销订阅并设置 status=closed', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession, disconnectSession, getStatus } = useAgentWebSocket({ onUserMessage: vi.fn() });
    connectSession('sid-A');
    disconnectSession('sid-A');
    expect(mockChannel.unsubscribe).toHaveBeenCalledWith('sid-A');
    expect(getStatus('sid-A')).toBe('closed');
  });

  it('sendMessage 委托给 channel.send', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession, sendMessage } = useAgentWebSocket({ onUserMessage: vi.fn() });
    connectSession('sid-A');
    const result = sendMessage('sid-A', 'test msg');
    expect(mockChannel.send).toHaveBeenCalledWith('sid-A', 'test msg');
    expect(result).toBe(true);
  });

  it('disconnectAll 注销所有订阅但不 dispose channel', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession, disconnectAll } = useAgentWebSocket({ onUserMessage: vi.fn() });
    connectSession('sid-A');
    connectSession('sid-B');
    disconnectAll();
    expect(mockChannel.unsubscribe).toHaveBeenCalledWith('sid-A');
    expect(mockChannel.unsubscribe).toHaveBeenCalledWith('sid-B');
    expect(mockChannel.dispose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
pnpm test:unit -- composables/__tests__/useAgentWebSocket.test.ts
```

Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/src/composables/useAgentWebSocket.ts apps/src/composables/__tests__/useAgentWebSocket.test.ts
git commit -m "refactor(@vben/web-antd): useAgentWebSocket 改为 channel 订阅层，对外接口不变"
```

---

## Task 4: 绑定 channel 生命周期到登录态

**Files:**
- Modify: `apps/src/layouts/basic.vue`

**Interfaces:**
- Consumes:
  - `useAgentWsChannel(): AgentWsChannel` from `#/composables/useAgentWsChannel`
  - `useAccessStore()` from `@vben/stores`
- Produces: channel 在 accessToken 存在时自动 init，登出/token 清除时自动 dispose

- [ ] **Step 1: 在 basic.vue 中 import 所需模块**

在 `apps/src/layouts/basic.vue` `<script lang="ts" setup>` 现有 import 块末尾追加：

```ts
import { useAgentWsChannel } from '#/composables/useAgentWsChannel';
import { message as antMessage } from 'ant-design-vue';
import { useAuthStore } from '#/store';
```

注意：`useAuthStore` 在 `basic.vue` 中已有 `authStore` 实例，确认是否已 import，避免重复。

- [ ] **Step 2: 在 script 末尾追加 channel 初始化逻辑**

在 `apps/src/layouts/basic.vue` `<script lang="ts" setup>` 末尾，`handleLogout` 函数之后追加：

```ts
// ===== 座席端 WS Channel 生命周期（绑定登录态） =====
const agentChannel = useAgentWsChannel();

watch(
  () => accessStore.accessToken,
  (newToken, oldToken) => {
    if (newToken && !oldToken) {
      // 首次登录：全量初始化
      agentChannel.init(newToken, {
        onKickedOut: () => {
          antMessage.warning('您的账号已在其他设备登录，当前连接已断开');
        },
      });
    } else if (newToken && newToken !== oldToken) {
      // token 刷新：只换 token 重建 WS，保留 subscriberMap 避免会话订阅丢失
      agentChannel.reconnect(newToken);
    } else if (!newToken) {
      // 登出：销毁 channel
      agentChannel.dispose();
    }
  },
  { immediate: true },
);

// 401 握手失败耗尽重试后 status='error'，尝试刷新 token
watch(
  () => agentChannel.status.value,
  async (s) => {
    if (s === 'error') {
      try {
        await authStore.refreshAccessToken();
        // refreshAccessToken 成功后会更新 accessStore.accessToken，
        // 上方的 watch(accessToken) 会触发 reconnect()，无需在此手动调用
      } catch {
        // refresh 也失败，强制登出
        await authStore.logout(false);
      }
    }
  },
);
```

- [ ] **Step 3: 运行 typecheck**

```bash
pnpm --filter @vben/web-antd typecheck
```

Expected: 无类型错误

- [ ] **Step 4: 本地启动验证**

```bash
pnpm dev
```

打开座席工作台，检查浏览器控制台：
- 登录后：`WebSocket` 连接到 `/ws/agent?token=xxx`（Network → WS 标签可见）
- 接入一个会话后：只有 **1 条** WS 连接（非改造前的 N 条）
- 接入多个会话后：仍然只有 **1 条** WS 连接

- [ ] **Step 5: Commit**

```bash
git add apps/src/layouts/basic.vue
git commit -m "feat(@vben/web-antd): 绑定 WS channel 生命周期到登录态，支持多登录模式"
```

---

## Task 5: 联调验证 & 清理旧代码

**Files:**
- Modify: `apps/src/composables/useAgentWebSocket.ts` — 删除已无用的 import
- Modify: `apps/src/api/session/index.ts` — 确认 `connectAgentWs` 废弃注释正确

**Interfaces:**
- Consumes: 前 4 个 Task 的所有产物

- [ ] **Step 1: 检查 connectAgentWs 是否还有调用方**

```bash
grep -rn "connectAgentWs" apps/src --include="*.ts" --include="*.vue"
```

Expected: 只剩 `api/session/index.ts` 中的定义本身（无其他调用方）

- [ ] **Step 2: 检查旧 agentWsMap / heartbeatMap 相关代码是否已清除**

```bash
grep -rn "agentWsMap\|heartbeatMap\|retryMap\|intentionalClose" apps/src --include="*.ts"
```

Expected: 无结果（改造后这些变量不再存在）

- [ ] **Step 3: 运行全量 typecheck**

```bash
pnpm --filter @vben/web-antd typecheck
```

Expected: 无错误

- [ ] **Step 4: 运行全量单元测试**

```bash
pnpm test:unit
```

Expected: 所有测试通过（包含 Task 2、Task 3 新增的测试）

- [ ] **Step 5: 端到端手动验证清单**

| 场景 | 操作 | 期望结果 |
|------|------|---------|
| 单会话收发 | 访客发消息 | 座席工作台实时收到 |
| 单会话收发 | 座席发消息 | 访客 chat-widget 实时收到 |
| 多会话路由 | 同时接入 2 个访客 | 各会话消息不串扰 |
| TYPING 信号 | 访客打字 | 座席侧显示"输入中"气泡，3s 后消失 |
| 断线重连 | 断网后恢复 | channel 自动重连，漏消息补齐 |
| 多标签页 | 同一账号开两个工作台 Tab | 两个 Tab 均收到访客消息 |
| 登出重连 | 登出再登录 | 新 token 重建 channel，正常收发 |

- [ ] **Step 6: 最终 Commit**

```bash
git add -A
git commit -m "feat(@vben/web-antd): 座席端 WebSocket 单连接多路复用改造完成"
```

---
