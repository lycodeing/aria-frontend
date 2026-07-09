# 座席端 WebSocket 单连接多路复用改造设计

**日期**：2026-07-09  
**状态**：草稿  
**作者**：lycodeing

---

## 1. 背景与问题陈述

### 1.1 现状

当前座席端 WebSocket 实现（`useAgentWebSocket.ts`）采用"一会话一连接"模式：

- 内部维护 `Map<sessionId, WebSocket>`
- 座席接入一个会话 → 新建一条 WS 连接到 `/ws/agent/{sessionId}?token=xxx`
- 座席同时处理 N 个会话 → 同时维持 N 条 WS 连接

每条连接都有独立的心跳定时器（12s 间隔）、指数退避重连逻辑（最多 10 次），以及独立的 offline 监听器。

### 1.2 问题

| 问题 | 描述 |
|------|------|
| 资源浪费 | 每个 WS 连接消耗 1 个浏览器 TCP 连接 + 后端线程/协程，座席处理 5 个会话即有 5 条长连接 |
| 重复逻辑 | 心跳、重连、offline 事件处理在每条连接上各跑一份，维护成本高 |
| 生命周期混乱 | 连接生命周期与组件挂载/卸载绑定（`onUnmounted`），页面切换时连接会被意外断开 |
| 后端瓶颈 | `/ws/agent/{sessionId}` 每个会话对应独立端点，N 个会话 × M 个座席 = N×M 条服务端 WS session |

### 1.3 目标

- 一个已登录座席在任意时刻**只维持一条 WS 连接**
- 所有会话的实时消息（访客发消息、TYPING 信号）均通过这条管道传输
- 连接生命周期绑定到**登录态**而非组件
- 支持同一座席**多浏览器并发登录**（广播模型）
- 对现有调用方（`agent/index.vue`、`AgentChatArea.vue`）的接口改动最小化

### 1.4 非目标

- 访客端 WebSocket（`useVisitorWs.ts`）不在本次改造范围内——访客一个会话对应一条连接，本身就是单连接模型
- 漏消息补齐策略不引入后端 replay，保持现有"重连后前端按 sinceSeq 拉 HTTP 增量"逻辑

## 2. 整体架构

### 2.1 改造前

```
agent/index.vue
    └── useAgentWebSocket
            ├── Map<sessionId, WebSocket>
            ├── /ws/agent/session-A?token=xxx  ←→  后端 AgentWsHandler（session-A）
            ├── /ws/agent/session-B?token=xxx  ←→  后端 AgentWsHandler（session-B）
            └── /ws/agent/session-C?token=xxx  ←→  后端 AgentWsHandler（session-C）
```

### 2.2 改造后

```
登录态（Pinia accessStore）
    └── useAgentWsChannel（模块级单例）
            └── WebSocket（单条）
                /ws/agent?token=xxx  ←→  后端 AgentChannelWsHandler
                                              └── AgentConnectionRegistry
                                                      Map<agentId, Set<WsSession>>

useAgentWebSocket（订阅层，接口不变）
    ├── subscribe(sessionId, callbacks)
    ├── unsubscribe(sessionId)
    └── send(sessionId, content)

agent/index.vue / AgentChatArea.vue（零改动）
```

### 2.3 分层职责

| 层 | 类/文件 | 职责 |
|----|---------|------|
| 传输层 | `useAgentWsChannel.ts` | 单条 WS 的建连/断连、心跳、指数退避重连、在线状态监听 |
| 路由层 | `useAgentWsChannel.ts` | 按 `msg.sessionId` 将收到的消息分发给已注册的回调集合 |
| 订阅层 | `useAgentWebSocket.ts` | 对外暴露 `connectSession` / `disconnectSession` / `sendMessage`，内部改为向 channel 注册/注销订阅 |
| 业务层 | `agent/index.vue` | 调用订阅层，处理 `onUserMessage` / `onTyping` 等业务回调（不变） |

### 2.4 后端对应架构

```
旧端点（废弃）：/ws/agent/{sessionId}
新端点（新增）：/ws/agent

AgentChannelWsHandler
    onOpen(session):
        agentId = 从 token 解析
        registry.register(agentId, session)

    onMessage(session, msg):
        agentId = registry.getAgentId(session)
        根据 msg.sessionId 路由到对应 ConversationSession 处理

    onClose(session):
        registry.unregister(session)

AgentConnectionRegistry
    data: Map<agentId, Set<WebSocketSession>>
    register / unregister / broadcast(agentId, msg)
```

## 3. 前端：useAgentWsChannel（传输 + 路由层）

### 3.1 设计原则

- **模块级单例**：通过 ES 模块顶层变量持有唯一实例，任何组件 `import` 都拿到同一个对象，不依赖 provide/inject 或 Pinia
- **与组件解耦**：不调用 `onUnmounted`，生命周期由 `init()` / `dispose()` 显式控制
- **订阅者模型**：内部维护 `Map<sessionId, Set<ChannelCallback>>`，消息到来时按 `sessionId` 广播给所有订阅者

### 3.2 接口定义

```ts
// composables/useAgentWsChannel.ts

export interface ChannelCallbacks {
  onMessage: (msg: WsChatMessage) => void;
  onTyping?: (sessionId: string) => void;
  onReconnect?: (sessionId: string) => void;
}

/**
 * 多登录模式（后端配置一致）
 *   BROADCAST - 多端共存，所有登录端同时接收消息（默认）
 *   KICK       - 新端登录时踢掉旧端，旧端收到 KICKED_OUT 后不再重连
 */
export type MultiLoginMode = 'BROADCAST' | 'KICK';

export interface AgentWsChannelOptions {
  /** 多登录模式，默认 BROADCAST */
  multiLoginMode?: MultiLoginMode;
  /** KICK 模式下被踢出时回调，用于 UI 提示并跳转登录页 */
  onKickedOut?: () => void;
}

export interface AgentWsChannel {
  /** 初始化 channel，传入 token；已初始化则幂等 */
  init(token: string, options?: AgentWsChannelOptions): void;
  /** 销毁 channel（登出时调用） */
  dispose(): void;
  /** 订阅某个会话的消息 */
  subscribe(sessionId: string, callbacks: ChannelCallbacks): void;
  /** 注销某个会话的订阅 */
  unsubscribe(sessionId: string): void;
  /** 通过 channel 发送消息（自动带 sessionId） */
  send(sessionId: string, content: string): boolean;
  /** 发送 TYPING 信号 */
  sendTyping(sessionId: string): void;
  /** 当前连接状态（响应式） */
  readonly status: Ref<'closed' | 'connecting' | 'kicked' | 'open' | 'error'>;
}
```

### 3.3 内部状态

```ts
// 模块级变量（单例）
let ws: null | WebSocket = null;
let token = '';
let retryCount = 0;
let retryTimer: null | ReturnType<typeof setTimeout> = null;
let heartbeatTimer: null | ReturnType<typeof setInterval> = null;
let kicked = false; // KICK 模式下被踢出，禁止自动重连

// 多登录配置
let multiLoginMode: MultiLoginMode = 'BROADCAST';
let onKickedOutCallback: (() => void) | undefined;

// sessionId → 订阅回调集合
const subscriberMap = new Map<string, Set<ChannelCallbacks>>();

// 响应式状态（供 UI 展示连接状态）
const status = ref<'closed' | 'connecting' | 'kicked' | 'open' | 'error'>('closed');
```

### 3.4 连接建立

```ts
function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  status.value = 'connecting';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}/ws/agent?token=${encodeURIComponent(token)}`;
  ws = new WebSocket(url);

  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', onMessage);
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', onError);
}

function onOpen(): void {
  status.value = 'open';
  retryCount = 0;
  startHeartbeat();
  // 通知所有已订阅会话：channel 已恢复
  subscriberMap.forEach((callbacks, sessionId) => {
    callbacks.forEach(cb => cb.onReconnect?.(sessionId));
  });
}
```

### 3.5 消息路由

```ts
function onMessage(event: MessageEvent): void {
  let msg: WsChatMessage;
  try {
    msg = JSON.parse(event.data as string);
  } catch {
    return;
  }

  // KICKED_OUT：被新登录端踢出，不重连，通知 UI
  if (msg.type === 'KICKED_OUT') {
    kicked = true;
    status.value = 'kicked';
    ws?.close();
    onKickedOutCallback?.();
    return;
  }

  const { sessionId, type } = msg;
  if (!sessionId) return;

  const callbacks = subscriberMap.get(sessionId);
  if (!callbacks) return;

  callbacks.forEach(cb => {
    if (type === 'TYPING') {
      cb.onTyping?.(sessionId);
    } else {
      cb.onMessage(msg);
    }
  });
}
```

### 3.6 心跳与重连

```ts
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const MAX_RETRIES = 10;
const HEARTBEAT_MS = 12_000;

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!ws) return stopHeartbeat();
    const dead = ws.readyState === WebSocket.CLOSED
      || ws.readyState === WebSocket.CLOSING
      || !navigator.onLine;
    if (dead && status.value === 'open') {
      ws.close(); // 触发 onClose → scheduleReconnect
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

function onClose(): void {
  ws = null;
  stopHeartbeat();
  // kicked = true 时不重连（被踢出），status 已在 onMessage 里设为 'kicked'
  if (status.value !== 'closed' && !kicked) {
    status.value = 'connecting';
    scheduleReconnect();
  }
}
```

### 3.7 init / dispose

```ts
export function useAgentWsChannel(): AgentWsChannel {
  return {
    init(t: string, options?: AgentWsChannelOptions) {
      if (ws) return; // 幂等
      token = t;
      kicked = false;
      multiLoginMode = options?.multiLoginMode ?? 'BROADCAST';
      onKickedOutCallback = options?.onKickedOut;
      window.addEventListener('offline', onBrowserOffline);
      connect();
    },
    dispose() {
      status.value = 'closed';
      kicked = false;
      clearTimeout(retryTimer ?? undefined);
      stopHeartbeat();
      window.removeEventListener('offline', onBrowserOffline);
      ws?.close();
      ws = null;
      subscriberMap.clear();
    },
    subscribe(sessionId, callbacks) {
      if (!subscriberMap.has(sessionId)) subscriberMap.set(sessionId, new Set());
      subscriberMap.get(sessionId)!.add(callbacks);
    },
    unsubscribe(sessionId) {
      subscriberMap.delete(sessionId);
    },
    send(sessionId, content) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: 'MESSAGE', sessionId, content }));
      return true;
    },
    sendTyping(sessionId) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'TYPING', sessionId }));
    },
    status,
  };
}
```

## 4. 前端：useAgentWebSocket（订阅层改造）

### 4.1 改造策略

`useAgentWebSocket` 对外接口**完全保持不变**，调用方（`agent/index.vue`）零感知。内部实现从"直接管理 WebSocket 连接"改为"向 channel 注册/注销订阅"。

改造前后对照：

| 方法 | 改造前 | 改造后 |
|------|--------|--------|
| `connectSession(id)` | `new WebSocket('/ws/agent/{id}')` | `channel.subscribe(id, callbacks)` |
| `disconnectSession(id)` | `ws.close()` | `channel.unsubscribe(id)` |
| `sendMessage(id, content)` | `ws.send(...)` | `channel.send(id, content)` |
| `disconnectAll()` | 关闭所有 WS | 注销所有订阅（不关闭 channel） |
| `statusMap` | 每条 WS 独立 readyState | 全部映射到 channel.status |

### 4.2 改造后代码骨架

```ts
// composables/useAgentWebSocket.ts（改造后）

import { reactive } from 'vue';
import { useAgentWsChannel } from './useAgentWsChannel';
import type { WsChatMessage } from '#/api/session';

export type WsStatus = 'closed' | 'connecting' | 'error' | 'open';

export interface AgentWebSocketOptions {
  onUserMessage: (sessionId: string, msg: WsChatMessage) => void;
  onTyping?: (sessionId: string) => void;
  onReconnect?: (sessionId: string) => void;
  onStatusChange?: (sessionId: string, status: WsStatus) => void;
}

export function useAgentWebSocket(options: AgentWebSocketOptions) {
  const channel = useAgentWsChannel();
  // 已订阅的 sessionId 集合（用于 disconnectAll）
  const subscribedSessions = new Set<string>();
  // statusMap 响应式：所有订阅会话共享 channel 状态
  const statusMap = reactive<Record<string, WsStatus>>({});

  // 同步 channel.status → 所有已订阅会话的 statusMap
  watch(channel.status, (s) => {
    for (const sid of subscribedSessions) {
      const mapped = s === 'open' ? 'open'
        : s === 'connecting' ? 'connecting'
        : s === 'error' ? 'error'
        : 'closed';
      statusMap[sid] = mapped;
      options.onStatusChange?.(sid, mapped);
    }
  });

  function connectSession(sessionId: string): void {
    if (subscribedSessions.has(sessionId)) return; // 幂等
    subscribedSessions.add(sessionId);
    statusMap[sessionId] = channel.status.value === 'open' ? 'open' : 'connecting';

    channel.subscribe(sessionId, {
      onMessage: (msg) => {
        if (msg.type === 'MESSAGE' && msg.role === 'user') {
          options.onUserMessage(sessionId, msg);
        }
      },
      onTyping: () => options.onTyping?.(sessionId),
      onReconnect: () => {
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
    // 注意：不调用 channel.dispose()，channel 生命周期由登录态管理
  }

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

### 4.3 关键变化说明

**`statusMap` 语义变化**：改造前每个 sessionId 有独立的连接状态（某个 session 的 WS 可能是 open 而另一个是 connecting）；改造后所有会话共享同一条 channel 的状态。这在 UI 上意味着连接指示器显示的是"座席与服务器的整体连接状态"，更符合单连接的语义。

**`disconnectAll` 不关 channel**：座席主动关闭某个会话时只是注销订阅，channel 本身继续运行，等待下一个会话订阅进来。只有登出时才调用 `channel.dispose()`。

**幂等保证**：`connectSession` 对同一 sessionId 重复调用安全（Set 去重）；`channel.subscribe` 允许多次调用同一 sessionId，内部 Set 也会去重。

## 5. 消息协议

### 5.1 现有协议回顾

```ts
// 现有 WsChatMessage 类型（api/session/index.ts）— 新增 KICKED_OUT
export interface WsChatMessage {
  type: 'AGENT_JOINED' | 'CONNECTED' | 'KICKED_OUT' | 'MESSAGE' | 'TYPING';
  sessionId: string;   // ← 字段已存在，原先只是"携带信息"，未用于路由
  role?: 'agent' | 'user';
  content?: string;
  seq?: number | string;
  timestamp?: number;
}
```

`sessionId` 字段已经在类型定义中，**无需修改类型**（仅新增 `KICKED_OUT` 枚举值）。

### 5.2 发送方向变化

单连接后，后端无法再从 URL 路径获取 sessionId，前端发送的消息体必须携带 `sessionId`。

**改造前（路径路由）：**

```ts
// 连接 /ws/agent/session-A，后端从路径取 sessionId
ws.send(JSON.stringify({ type: 'MESSAGE', content: '你好' }));
ws.send(JSON.stringify({ type: 'TYPING' }));
```

**改造后（消息体路由）：**

```ts
// 连接 /ws/agent，后端从消息体取 sessionId
ws.send(JSON.stringify({ type: 'MESSAGE', sessionId: 'session-A', content: '你好' }));
ws.send(JSON.stringify({ type: 'TYPING', sessionId: 'session-A' }));
```

### 5.3 改造点

只需修改 `api/session/index.ts` 中的两个工具函数，channel 层的 `send` / `sendTyping` 方法内部已按新格式发送，**原有 `sendWsMessage` / `sendTypingSignal` 函数可以保留用于访客端，不影响 `useVisitorWs`**。

```ts
// channel 层发送（useAgentWsChannel.ts 内部）
ws.send(JSON.stringify({ type: 'MESSAGE', sessionId, content }));
ws.send(JSON.stringify({ type: 'TYPING', sessionId }));
```

### 5.4 接收方向（不变）

后端推给前端的消息格式不变，`sessionId` 字段已有：

```json
// 访客发消息，后端推给座席
{ "type": "MESSAGE", "sessionId": "session-A", "role": "user", "content": "我要退款", "seq": "42", "timestamp": 1720512000000 }

// 访客输入中
{ "type": "TYPING", "sessionId": "session-A" }

// 座席接入通知（当前仅访客端接收，座席端忽略）
{ "type": "AGENT_JOINED", "sessionId": "session-A" }
```

### 5.5 完整消息类型表

| type | 方向 | sessionId | role | content | seq |
|------|------|-----------|------|---------|-----|
| `MESSAGE` | 双向 | ✓ 必填 | ✓ 必填 | ✓ 必填 | 后端→前端时有值 |
| `TYPING` | 双向 | ✓ 必填 | — | — | — |
| `CONNECTED` | 后端→前端 | ✓ 必填 | — | — | — |
| `AGENT_JOINED` | 后端→前端 | ✓ 必填 | — | — | — |
| `KICKED_OUT` | 后端→前端 | — | — | — | — |

`KICKED_OUT` 仅在后端配置为 `KICK` 模式时发送，表示当前连接被更新的登录端强制下线。

## 6. 连接生命周期 & 重连策略

### 6.1 生命周期绑定登录态

Channel 的生命周期由登录状态驱动，与任何 Vue 组件解耦。

**触发点**：在应用入口（`layouts/basic.vue` 或全局初始化逻辑中）watch Pinia accessStore 的 token 变化：

```ts
// 推荐放在 layouts/basic.vue 或独立的 useAgentSession composable
import { watch } from 'vue';
import { useAccessStore } from '@vben/stores';
import { useAgentWsChannel } from '#/composables/useAgentWsChannel';

const accessStore = useAccessStore();
const channel = useAgentWsChannel();

watch(
  () => accessStore.accessToken,
  (token) => {
    if (token) {
      channel.init(token);       // 登录 → 建连
    } else {
      channel.dispose();         // 登出 → 断连 + 清理所有订阅
    }
  },
  { immediate: true },
);
```

### 6.2 生命周期状态机

```
                  login / token 出现
         ┌─────────────────────────────────┐
         ↓                                 │
      [closed] ──init()──► [connecting]    │
                                │          │
                           连接成功         │
                                │          │
                           [open] ──────── │
                                │
                           网络断开/服务端关闭
                                │
                         [connecting]（重连中）
                                │
                    重试耗尽（10次）
                                │
                           [error]
                                │
                      dispose() / 用户刷新页面
                                │
                           [closed]
```

### 6.3 重连策略

指数退避，参数与现有 `useAgentWebSocket` 保持一致：

| 参数 | 值 |
|------|-----|
| 基础延迟 | 1000ms |
| 最大延迟 | 30000ms |
| 最大重试次数 | 10 次 |
| 心跳间隔 | 12000ms |

**重连公式**：`delay = min(30000, 1000 × 2^retryCount)`

| 第几次重连 | 延迟 |
|-----------|------|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6+ | 30s（上限） |

### 6.4 重连后漏消息补齐

Channel 重连成功（`onOpen`）后，通知所有已订阅会话触发 `onReconnect` 回调。`agent/index.vue` 中现有的 `fetchMissingForSession(sid)` 逻辑**不变**，仅触发时机从"单个 session WS 的 onReconnect"改为"channel 级别 onReconnect 触发所有活跃 session 并行 fetch"：

```ts
// channel onOpen 时
subscriberMap.forEach((callbacks, sessionId) => {
  callbacks.forEach(cb => cb.onReconnect?.(sessionId));
});

// useAgentWebSocket 订阅层转发给业务层
onReconnect: () => options.onReconnect?.(sessionId),

// agent/index.vue（不变）
onReconnect: (sessionId) => {
  void fetchMissingForSession(sessionId);
},
```

多个 session 并行触发 `fetchMissingForSession`，函数内部 `fetchInflight` Set 已有并发保护，每个 session 独立锁，不互相阻塞。

### 6.5 心跳机制

Channel 建连成功后启动单一心跳定时器（12s），检测 `ws.readyState` 和 `navigator.onLine`。发现连接死亡时主动调用 `ws.close()` 触发 `onclose` 事件，进入重连流程。同时监听 `window` 的 `offline` 事件，断网时立即感知并触发重连。

改造后只有**一个**心跳定时器，而非原来的 N 个。

### 6.6 token 刷新处理

当 `accessToken` 被 `refreshTokenApi` 刷新后，watch 会检测到新值，此时：

- 若 channel 当前 `status === 'open'`：调用 `dispose()` 关闭旧连接，`init(newToken)` 用新 token 重建
- 若 channel 当前处于重连中：更新内部 `token` 变量，下次重连时自动使用新 token

```ts
watch(
  () => accessStore.accessToken,
  (newToken, oldToken) => {
    if (newToken && newToken !== oldToken) {
      channel.dispose();   // 关闭旧连接
      channel.init(newToken); // 用新 token 重建
    } else if (!newToken) {
      channel.dispose();
    }
  },
  { immediate: true },
);
```

## 7. 多浏览器并发处理

### 7.1 场景描述

同一座席在多个浏览器（或同一浏览器的多个标签）同时登录，每个浏览器各自建立一条 WS 连接到 `/ws/agent?token=xxx`。后端解析出的 `agentId` 相同，需要决策如何处理并发连接。

### 7.2 多登录模式（可配置）

后端通过配置项 `agent.ws.multi-login-mode` 控制行为：

| 模式 | 值 | 行为 | 适用场景 |
|------|-----|------|---------|
| 广播共存（默认） | `BROADCAST` | 多端同时在线，消息广播给所有连接 | 座席多开标签、双屏工作 |
| 踢出旧端 | `KICK` | 新端连入时向旧端推送 `KICKED_OUT`，旧端断开且不重连 | 安全要求较高、防止消息泄露 |

**默认选 `BROADCAST`**，符合客服场景的实际使用习惯（座席多开标签很常见）。

### 7.3 BROADCAST 模式（广播共存）

后端 `AgentConnectionRegistry` 使用 `Map<agentId, Set<WebSocketSession>>`，推送时遍历广播：

```
访客发消息
    └── ConversationService
            └── registry.broadcast(agentId, msg)
                    ├── Browser A 的 WS → 显示消息
                    └── Browser B 的 WS → 显示消息
```

前端的 `seq` 去重逻辑确保消息不重复渲染。座席从 Browser A 发消息时，后端 `broadcastExcept` echo 给 Browser B，保持两端同步。

### 7.4 KICK 模式（踢出旧端）

新端连入时，后端找到该 agentId 的所有旧连接，逐一推送 `KICKED_OUT` 消息后关闭：

```
Browser B 新建连接
    └── AgentChannelWsHandler.afterConnectionEstablished
            └── if (mode == KICK)
                    ├── registry.broadcast(agentId, { type: 'KICKED_OUT' })  // 推给旧端
                    ├── registry.closeAll(agentId)                            // 关闭旧连接
                    └── registry.register(agentId, newSession)               // 注册新端
```

前端收到 `KICKED_OUT` 后：

```ts
// onMessage 中处理
if (msg.type === 'KICKED_OUT') {
  kicked = true;
  status.value = 'kicked';
  ws?.close();
  onKickedOutCallback?.();  // 通知 UI：弹提示 + 跳转登录页或仅提示
  return;
}
```

UI 建议展示提示：**"您的账号已在其他设备登录，当前连接已断开"**，并禁止自动重连。

### 7.5 前端无感知（BROADCAST 模式）

每个浏览器的 `useAgentWsChannel` 只管自己的单条连接，不感知其他浏览器的存在。多浏览器的消息同步完全由后端广播解决，前端代码无需任何修改。

**前提：每个标签页的 `subscriberMap` 如何保证订阅到正确的 session**

"无感知"成立的基础是每个标签页在打开时都会独立完成订阅，依赖两个已有机制：

1. **onMounted 加载活跃会话**：工作台页面挂载时调用 `getActiveSessionsApi()`，拿到当前所有活跃 session，逐一调用 `connectSession(sessionId)` → `channel.subscribe(sessionId, callbacks)`，Tab B 打开时会把已有会话全部订阅进 `subscriberMap`。

2. **SSE 事件驱动新会话订阅**：每个标签页独立订阅 SSE 事件流，收到 `ACCEPTED` 事件时调用 `connectSession(sessionId)`，新会话到来时两个标签页同步完成订阅。

```
Tab B 打开工作台
  └── onMounted
        └── getActiveSessionsApi() → [session-A, session-B]
              ├── connectSession('session-A') → subscriberMap.set('session-A', callbacks)
              └── connectSession('session-B') → subscriberMap.set('session-B', callbacks)

新访客入队 → 座席接入
  └── SSE ACCEPTED 事件
        ├── Tab A: connectSession('session-C') → subscriberMap.set('session-C', ...)
        └── Tab B: connectSession('session-C') → subscriberMap.set('session-C', ...)
```

结论：后端广播把消息推给两个标签的 WS 连接，前端 channel 的分发逻辑能找到对应的 callbacks，消息正确渲染。整个过程前端无需额外的跨标签通信（不需要 BroadcastChannel / SharedWorker）。

### 7.6 异常场景处理

| 场景 | 处理方式 |
|------|---------|
| Browser A 断线，Browser B 正常（BROADCAST） | 访客消息仍推给 Browser B；Browser A 重连后拉增量补齐 |
| 两个浏览器同时离线 | 各自独立重连，重连后各自拉增量（互不影响） |
| 座席在 Browser A 登出 | `channel.dispose()` 关闭 A 的连接，registry 中 A 被移除；B 不受影响 |
| 座席关闭会话（结束工单） | 后端广播 `CLOSED` 消息给所有连接，所有浏览器同步移除该会话 |
| Browser B 连入时 KICK 模式 | Browser A 收到 `KICKED_OUT`，`status='kicked'`，不重连，UI 弹提示 |

```java
// AgentConnectionRegistry.java（伪代码）
@Component
public class AgentConnectionRegistry {
    // agentId → 所有活跃连接
    private final ConcurrentHashMap<String, CopyOnWriteArraySet<WebSocketSession>>
        registry = new ConcurrentHashMap<>();

    public void register(String agentId, WebSocketSession session) {
        registry.computeIfAbsent(agentId, k -> new CopyOnWriteArraySet<>()).add(session);
    }

    public void unregister(String agentId, WebSocketSession session) {
        Set<WebSocketSession> sessions = registry.get(agentId);
        if (sessions != null) {
            sessions.remove(session);
            if (sessions.isEmpty()) registry.remove(agentId);
        }
    }

    /** 向该座席的所有活跃连接广播消息 */
    public void broadcast(String agentId, String payload) {
        Set<WebSocketSession> sessions = registry.getOrDefault(agentId, Collections.emptySet());
        for (WebSocketSession s : sessions) {
            if (s.isOpen()) {
                try {
                    s.sendMessage(new TextMessage(payload));
                } catch (IOException e) {
                    log.warn("broadcast failed for session {}", s.getId(), e);
                }
            }
        }
    }
}
```

### 7.3 消息同步：访客 → 座席

访客发消息时，后端通过 `broadcast(agentId, msg)` 推给该座席的所有连接，每个浏览器都能实时收到：

```
访客发消息
    └── 后端 ConversationService
            └── AgentConnectionRegistry.broadcast(agentId, msg)
                    ├── Browser A 的 WS → 显示消息
                    └── Browser B 的 WS → 显示消息
```

前端的 `seq` 去重逻辑（`writeLastSeq` + `sinceSeq` 过滤）确保消息不会重复渲染——两个浏览器各自独立维护自己的 `localStorage` 游标，互不影响。

### 7.4 消息同步：座席 → 访客（echo back）

座席从 Browser A 发消息给访客时，后端在发送给访客的同时，**echo 回该 agentId 的所有其他连接**（排除发送方自身）：

```
Browser A 发消息
    └── 后端 AgentMessageHandler
            ├── 发送给访客（ConversationSession）
            └── AgentConnectionRegistry.broadcastExcept(agentId, senderSession, msg)
                    └── Browser B 的 WS → 显示"自己发出"的消息（role=agent）
```

前端收到 `role === 'agent'` 的消息时，正常追加到消息列表即可，无需特殊处理。

### 7.5 前端无感知

每个浏览器的 `useAgentWsChannel` 只管自己的单条连接，不感知其他浏览器的存在。多浏览器的消息同步完全由后端广播解决，前端代码无需任何修改。

**前提：每个标签页的 `subscriberMap` 如何保证订阅到正确的 session**

"无感知"成立的基础是每个标签页在打开时都会独立完成订阅，依赖两个已有机制：

1. **onMounted 加载活跃会话**：工作台页面挂载时调用 `getActiveSessionsApi()`，拿到当前所有活跃 session，逐一调用 `connectSession(sessionId)` → `channel.subscribe(sessionId, callbacks)`，Tab B 打开时会把已有会话全部订阅进 `subscriberMap`。

2. **SSE 事件驱动新会话订阅**：每个标签页独立订阅 SSE 事件流，收到 `ACCEPTED` 事件时调用 `connectSession(sessionId)`，新会话到来时两个标签页同步完成订阅。

```
Tab B 打开工作台
  └── onMounted
        └── getActiveSessionsApi() → [session-A, session-B]
              ├── connectSession('session-A') → subscriberMap.set('session-A', callbacks)
              └── connectSession('session-B') → subscriberMap.set('session-B', callbacks)

新访客入队 → 座席接入
  └── SSE ACCEPTED 事件
        ├── Tab A: connectSession('session-C') → subscriberMap.set('session-C', ...)
        └── Tab B: connectSession('session-C') → subscriberMap.set('session-C', ...)
```

结论：后端广播把消息推给两个标签的 WS 连接，前端 channel 的分发逻辑能找到对应的 callbacks，消息正确渲染。整个过程前端无需额外的跨标签通信（不需要 BroadcastChannel / SharedWorker）。

### 7.6 异常场景处理

| 场景 | 处理方式 |
|------|---------|
| Browser A 断线，Browser B 正常 | 访客消息仍推给 Browser B；Browser A 重连后拉增量补齐 |
| 两个浏览器同时离线 | 各自独立重连，重连后各自拉增量（互不影响） |
| 座席在 Browser A 登出 | `channel.dispose()` 关闭 A 的连接，registry 中 A 被移除；B 不受影响 |
| 座席关闭会话（结束工单） | 后端广播 `CLOSED` 消息给所有连接，所有浏览器同步移除该会话 |

## 8. 后端改造

### 8.1 改造范围

| 组件 | 操作 | 说明 |
|------|------|------|
| `AgentWsHandler`（旧，按 sessionId 路由） | 废弃 | 替换为 AgentChannelWsHandler |
| `AgentChannelWsHandler`（新） | 新增 | 处理 `/ws/agent` 端点，按消息体 sessionId 路由 |
| `AgentConnectionRegistry`（新） | 新增 | `Map<agentId, Set<WsSession>>` 广播模型 + KICK 支持 |
| `AgentHandshakeInterceptor` | 修改 | 去掉 `pathVariable sessionId`，仍从 `?token=` 解析 agentId |
| WS 路由配置 | 修改 | 注册新端点 `/ws/agent`，保留旧端点至灰度结束后删除 |
| `application.yml` | 新增 | `agent.ws.multi-login-mode: BROADCAST` 配置项 |

### 8.2 新端点注册（Spring WebSocket 示例）

```java
// WebSocketConfig.java
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // 新：单连接多路复用端点
        registry.addHandler(agentChannelWsHandler, "/ws/agent")
                .addInterceptors(agentHandshakeInterceptor)
                .setAllowedOrigins("*");

        // 旧：保留，灰度迁移完成后删除
        registry.addHandler(agentWsHandler, "/ws/agent/{sessionId}")
                .addInterceptors(agentHandshakeInterceptor)
                .setAllowedOrigins("*");

        // 访客端（不变）
        registry.addHandler(visitorWsHandler, "/ws/chat/{sessionId}")
                .setAllowedOrigins("*");
    }
}
```

### 8.3 AgentHandshakeInterceptor 修改

```java
// 改造前：从路径变量取 sessionId
Map<String, Object> attrs = wsSession.getAttributes();
String sessionId = (String) attrs.get("sessionId"); // 路径变量注入

// 改造后：只解析 agentId，不依赖路径变量
@Override
public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
        WebSocketHandler wsHandler, Map<String, Object> attributes) {
    String query = request.getURI().getQuery(); // token=xxx
    String token = parseTokenFromQuery(query);
    if (token == null || token.isBlank()) {
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return false;
    }
    String agentId = saTokenUtil.getLoginIdByToken(token);
    if (agentId == null) {
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return false;
    }
    attributes.put("agentId", agentId);
    return true;
}
```

### 8.4 AgentChannelWsHandler

```java
@Component
public class AgentChannelWsHandler extends TextWebSocketHandler {

    private final AgentConnectionRegistry registry;
    private final ConversationService conversationService;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String agentId = (String) session.getAttributes().get("agentId");
        registry.register(agentId, session);
        log.info("[WS:Agent] 连接建立 agentId={} sessionId={}", agentId, session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        WsChatMessage msg = parseMessage(message.getPayload());
        if (msg == null || msg.getSessionId() == null) return;

        String agentId = (String) session.getAttributes().get("agentId");

        switch (msg.getType()) {
            case "MESSAGE" -> {
                // 座席发消息给访客
                conversationService.sendAgentMessage(msg.getSessionId(), agentId, msg.getContent());
                // Echo 给同一座席的其他浏览器
                registry.broadcastExcept(agentId, session,
                    buildMessage("MESSAGE", msg.getSessionId(), "agent", msg.getContent()));
            }
            case "TYPING" -> {
                // 座席输入中（如有需要可转发给访客）
                conversationService.forwardAgentTyping(msg.getSessionId());
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String agentId = (String) session.getAttributes().get("agentId");
        registry.unregister(agentId, session);
        log.info("[WS:Agent] 连接关闭 agentId={} status={}", agentId, status);
    }
}
```

### 8.5 推送访客消息给座席

原来是找到 `agentId` 对应的单条 WS session 发送，改为广播：

```java
// ConversationService.java（改造前）
WebSocketSession agentSession = agentSessionMap.get(agentId);
if (agentSession != null && agentSession.isOpen()) {
    agentSession.sendMessage(new TextMessage(payload));
}

// 改造后
registry.broadcast(agentId, payload);
```

### 8.6 数据结构：AgentConnectionRegistry

```java
@Component
public class AgentConnectionRegistry {

    // agentId → Set<WsSession>（CopyOnWriteArraySet 保证并发安全）
    private final ConcurrentHashMap<String, CopyOnWriteArraySet<WebSocketSession>>
        registry = new ConcurrentHashMap<>();

    // WsSession.getId() → agentId 反向索引（afterConnectionClosed 时快速查找）
    private final ConcurrentHashMap<String, String> sessionToAgent = new ConcurrentHashMap<>();

    private static final String KICKED_OUT_PAYLOAD = "{\"type\":\"KICKED_OUT\"}";

    public void register(String agentId, WebSocketSession session) {
        registry.computeIfAbsent(agentId, k -> new CopyOnWriteArraySet<>()).add(session);
        sessionToAgent.put(session.getId(), agentId);
    }

    /**
     * KICK 模式：向 agentId 的所有旧连接推送 KICKED_OUT，关闭旧连接，再注册新连接。
     * 注意：close() 会触发 afterConnectionClosed → unregister，因此先把旧连接快照，
     *       再执行踢出，避免并发修改 Set。
     */
    public void kickAndRegister(String agentId, WebSocketSession newSession) {
        CopyOnWriteArraySet<WebSocketSession> existing =
            registry.getOrDefault(agentId, new CopyOnWriteArraySet<>());
        List<WebSocketSession> snapshot = new ArrayList<>(existing);

        // 先注册新连接，再踢出旧连接（保证消息不丢）
        register(agentId, newSession);

        for (WebSocketSession old : snapshot) {
            if (old.isOpen()) {
                try {
                    old.sendMessage(new TextMessage(KICKED_OUT_PAYLOAD));
                    old.close(CloseStatus.NORMAL);
                } catch (IOException e) {
                    log.warn("[WS:Agent] kickAndRegister close failed sid={}", old.getId(), e);
                }
            }
        }
    }

    public void unregister(String agentId, WebSocketSession session) {
        sessionToAgent.remove(session.getId());
        CopyOnWriteArraySet<WebSocketSession> sessions = registry.get(agentId);
        if (sessions != null) {
            sessions.remove(session);
            if (sessions.isEmpty()) registry.remove(agentId);
        }
    }

    public String getAgentId(WebSocketSession session) {
        return sessionToAgent.get(session.getId());
    }

    public void broadcast(String agentId, String payload) {
        Set<WebSocketSession> sessions = registry.getOrDefault(agentId, Collections.emptySet());
        for (WebSocketSession s : sessions) {
            if (s.isOpen()) {
                try { s.sendMessage(new TextMessage(payload)); }
                catch (IOException e) { log.warn("broadcast error", e); }
            }
        }
    }

    public void broadcastExcept(String agentId, WebSocketSession exclude, String payload) {
        Set<WebSocketSession> sessions = registry.getOrDefault(agentId, Collections.emptySet());
        for (WebSocketSession s : sessions) {
            if (s.isOpen() && !s.getId().equals(exclude.getId())) {
                try { s.sendMessage(new TextMessage(payload)); }
                catch (IOException e) { log.warn("broadcastExcept error", e); }
            }
        }
    }
}
```

### 8.7 多登录模式配置

`application.yml`：

```yaml
agent:
  ws:
    # 多登录模式：BROADCAST（默认，多端共存）| KICK（新端踢旧端）
    multi-login-mode: BROADCAST
```

`AgentChannelWsHandler` 注入配置，在 `afterConnectionEstablished` 中按模式分支：

```java
@Value("${agent.ws.multi-login-mode:BROADCAST}")
private String multiLoginMode;

@Override
public void afterConnectionEstablished(WebSocketSession session) {
    String agentId = (String) session.getAttributes().get("agentId");
    if ("KICK".equalsIgnoreCase(multiLoginMode)) {
        registry.kickAndRegister(agentId, session);
    } else {
        registry.register(agentId, session);
    }
    log.info("[WS:Agent] 连接建立 agentId={} mode={}", agentId, multiLoginMode);
}
```

## 9. 迁移计划

### 9.1 迁移策略

开发阶段无历史包袱，采用**直接替换**策略，不需要灰度过渡期。

### 9.2 执行顺序

后端先行，前端跟进，联调验证后清理旧代码。

```
Step 1：后端新增 /ws/agent 端点
Step 2：后端新增 AgentConnectionRegistry（含 KICK 模式）
Step 3：后端新增 application.yml 配置项 agent.ws.multi-login-mode
Step 4：后端改造消息推送逻辑（broadcast 替换单点发送）
Step 5：前端新增 useAgentWsChannel.ts（含 KICKED_OUT 处理）
Step 6：前端改造 useAgentWebSocket.ts（订阅层）
Step 7：前端在 layouts/basic.vue 绑定登录态生命周期，传入 onKickedOut 回调
Step 8：联调测试（单会话 → 多会话 → 多浏览器 → 断线重连 → KICK 模式）
Step 9：清理旧端点 /ws/agent/{sessionId} 及相关代码
```

### 9.3 文件变更清单

**新增文件：**

| 文件 | 说明 |
|------|------|
| `apps/src/composables/useAgentWsChannel.ts` | 传输 + 路由层（单例） |

**修改文件：**

| 文件 | 改动内容 |
|------|---------|
| `apps/src/composables/useAgentWebSocket.ts` | 内部改为向 channel 订阅，对外接口不变 |
| `apps/src/layouts/basic.vue` | watch accessToken，驱动 channel init/dispose |
| `apps/src/api/session/index.ts` | 废弃 `connectAgentWs` 函数（改由 channel 内部建连），保留 `connectVisitorWs`、`sendWsMessage`、`sendTypingSignal`（访客端继续使用） |

**不需要修改的文件：**

| 文件 | 原因 |
|------|------|
| `apps/src/views/customerservice/agent/index.vue` | `useAgentWebSocket` 接口不变，零改动 |
| `apps/src/views/customerservice/agent/AgentChatArea.vue` | 同上 |
| `apps/src/composables/useVisitorWs.ts` | 访客端不在改造范围 |
| `apps/src/composables/useTransfer.ts` | 不涉及 WS 连接管理 |
| `apps/src/composables/useVisitorSession.ts` | 不涉及 WS 连接管理 |

### 9.4 测试用例

| 场景 | 验证点 |
|------|--------|
| 单会话基本收发 | 座席收到访客消息，座席发消息访客能收到 |
| 多会话并发 | 同时接入 3 个会话，消息按 sessionId 正确路由，互不串扰 |
| 断线重连 | 模拟网络断开后恢复，channel 自动重连，`fetchMissingForSession` 补齐漏消息 |
| 重连幂等 | 快速断线重连多次，不出现重复消息 |
| 多浏览器广播（BROADCAST） | 两个浏览器同时登录，访客消息两端均收到，一端发消息另一端 echo |
| KICK 模式踢出 | Browser B 登录后，Browser A 收到 `KICKED_OUT`，`status='kicked'`，不触发重连，UI 弹出提示 |
| KICK 模式消息不丢 | Browser B 踢出 Browser A 后，新消息仍能正常收发 |
| 登出清理 | 登出后 channel 关闭，重新登录后 channel 重建，`kicked` 标志重置 |
| token 刷新 | accessToken 刷新后 channel 用新 token 重建，消息收发正常 |
| TYPING 信号 | 访客输入中信号正确路由到对应会话，3s 无信号后自动清除 |

### 9.5 风险与缓解

| 风险 | 概率 | 缓解措施 |
|------|------|---------|
| 后端 registry 内存泄漏（session 未正确 unregister） | 中 | `afterConnectionClosed` 确保 unregister，加 session 数量监控指标 |
| channel 单例在 SSR 场景下共享状态污染 | 低（本项目 CSR） | 确认项目为纯 CSR，无需处理 |
| 多浏览器 echo 消息被前端重复渲染 | 低 | seq 去重逻辑已覆盖；echo 消息 role=agent，逻辑路径与 user 消息不同 |
| token 过期导致 WS 握手失败重试死循环 | 中 | 握手失败（HTTP 401）时不触发重连，直接进入 error 状态，等待 token 刷新后重建 |

### 9.6 后续可选优化（不在本次范围）

- **后端 replay**：握手时接收 `lastSeq` 列表，服务端主动推漏消息（消除重连后的 HTTP 轮询）
- **连接状态指示器细化**：区分"channel 断线"与"某个 session 无响应"
- **WS 压缩**：开启 `permessage-deflate` 减少带宽（消息量大时有意义）
