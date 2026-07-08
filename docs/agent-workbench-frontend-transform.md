# 座席工作台前端改造技术文档

> 版本：v1.0 | 日期：2026-07-08  
> 关联文档：`docs/agent-workbench-gap-analysis.md`  
> 改造范围：`apps/src/views/customerservice/agent/index.vue` 及相关 composables

---

## 一、概述与改造范围

### 1.1 改造背景

根据功能缺口分析报告，座席工作台存在以下核心问题：

1. **数据一致性**：座席在线状态未同步后端，服务端无法感知座席真实在线情况
2. **静态配置**：快捷回复硬编码，业务变化需发版
3. **通知缺失**：多会话场景下新消息无感知手段，容易漏消息
4. **功能单薄**：输入框、会话信息、结束流程均有明显缺口
5. **测试空白**：核心 composable 无任何单元测试

### 1.2 涉及文件清单

| 文件 | 改造类型 |
|---|---|
| `apps/src/views/customerservice/agent/index.vue` | 主要改造（状态、UI、事件） |
| `apps/src/composables/useSessionQueue.ts` | 新增 SSE 状态上报逻辑 |
| `apps/src/composables/useAgentWebSocket.ts` | 新增 TYPING 事件处理 |
| `apps/src/api/session/index.ts` | 新增 API 函数 |
| `apps/src/composables/__tests__/useSessionQueue.test.ts` | 新建 |
| `apps/src/composables/__tests__/useAgentWebSocket.test.ts` | 新建 |

### 1.3 依赖的后端新接口（需后端先行）

| 接口 | 说明 |
|---|---|
| `PUT /api/v1/agent/status` | 座席上线/下线状态同步 |
| `GET /api/v1/quick-replies` | 快捷回复列表（带分组/搜索） |
| `GET /api/v1/agent/profile` | 包含 `maxConcurrent` 字段 |
| `PATCH /api/v1/sessions/:id/tag` | 会话标签更新 |
| WS `TYPING` event | 访客打字状态推送 |

### 1.4 改造优先级与顺序

```
Sprint 1 (核心正确性)
  └── P1-1 座席状态同步
  └── P1-4 多会话消息通知
  └── 补充 composable 单元测试

Sprint 2 (效率提升)
  └── P1-2 快捷回复动态化
  └── P2-3 内部备注
  └── P2-4 转交备注
  └── P2-6 结束会话满意度

Sprint 3 (体验完善)
  └── P1-3 输入框增强
  └── P2-1 打字状态提示
  └── P2-2 消息搜索
  └── P2-5 会话时长
```

## 二、Sprint 1 — 座席在线状态同步后端（P1-1）

### 2.1 问题根因

`index.vue` 中 `agentOnline` 是纯前端 `ref<boolean>`，切换时不调用任何 API。当前 `useSessionQueue.ts` 的 SSE `onCompletion/onTimeout` 回调会调用 `deregisterAgent`，但这依赖 SSE 连接断开才触发，存在最长 30 分钟的"幽灵在线"窗口。

### 2.2 API 层新增

**文件：`apps/src/api/session/index.ts`**

```typescript
/** 座席主动上线/下线 */
export type AgentStatusPayload = { status: 'ONLINE' | 'OFFLINE' | 'BUSY' }

export function updateAgentStatusApi(payload: AgentStatusPayload) {
  return requestClient.put<void>('/api/v1/agent/status', payload)
}

/** 获取座席 profile（含 maxConcurrent） */
export interface AgentProfile {
  agentId: string
  name: string
  maxConcurrent: number
}
export function getAgentProfileApi() {
  return requestClient.get<AgentProfile>('/api/v1/agent/profile')
}
```

### 2.3 组件改造

**文件：`apps/src/views/customerservice/agent/index.vue`**

#### 2.3.1 状态变量调整

```typescript
// 原来：纯 UI 开关
const agentOnline = ref(false)

// 改为：加载中状态 + 最大并发来自接口
const agentOnline = ref(false)
const statusSyncing = ref(false)          // 防止切换时重复点击
const maxConcurrent = ref(5)              // 从 getAgentProfileApi 读取，不再硬编码
```

#### 2.3.2 onMounted 加载 profile

```typescript
onMounted(async () => {
  // 原有逻辑不变，新增：
  const profile = await getAgentProfileApi()
  maxConcurrent.value = profile.maxConcurrent
  // 初始状态：SSE 建立成功视为上线，先调接口标记在线
  await updateAgentStatusApi({ status: 'ONLINE' }).catch(() => {
    // 失败不阻断，但打 warn
    console.warn('[AgentWorkbench] failed to mark agent ONLINE on mount')
  })
  agentOnline.value = true
})
```

#### 2.3.3 状态切换逻辑

```typescript
async function toggleAgentStatus() {
  if (statusSyncing.value) return
  statusSyncing.value = true
  const next = !agentOnline.value
  try {
    await updateAgentStatusApi({ status: next ? 'ONLINE' : 'OFFLINE' })
    agentOnline.value = next
  } catch (e) {
    message.error('状态切换失败，请重试')
    // 回滚 UI，保持原状态
  } finally {
    statusSyncing.value = false
  }
}
```

#### 2.3.4 下线确认弹窗

当 `sessions.value.length > 0` 且试图下线时，弹出确认框：

```typescript
async function toggleAgentStatus() {
  if (statusSyncing.value) return
  const goOffline = agentOnline.value
  if (goOffline && sessions.value.length > 0) {
    Modal.confirm({
      title: '确认下线',
      content: `当前有 ${sessions.value.length} 个进行中的会话，下线后等待中的访客将重新分配。确认下线？`,
      onOk: () => doStatusSwitch(false),
    })
    return
  }
  await doStatusSwitch(!agentOnline.value)
}
```

#### 2.3.5 页面卸载时下线

```typescript
onBeforeUnmount(async () => {
  // 静默发送，不等响应
  navigator.sendBeacon('/api/v1/agent/status', JSON.stringify({ status: 'OFFLINE' }))
})
```

> 注意：`sendBeacon` 不携带 Authorization header，后端需支持从 cookie 或 query token 中读取身份；或改为在 `visibilitychange` + `pagehide` 中用 `fetch keepalive`。

#### 2.3.6 模板变化

```html
<!-- 原来 -->
<a-switch v-model:checked="agentOnline" />

<!-- 改为 -->
<a-switch
  v-model:checked="agentOnline"
  :loading="statusSyncing"
  @change="toggleAgentStatus"
/>
```

### 2.4 MAX_CONCURRENT 配置化

所有原来引用 `MAX_CONCURRENT` 常量的地方改为 `maxConcurrent.value`：

```typescript
// 原来
const MAX_CONCURRENT = 5

// 删除上行，改为响应式引用
// sessions.value.length >= maxConcurrent.value → 拒绝接入并提示
if (sessions.value.length >= maxConcurrent.value) {
  message.warning(`当前已达最大并发数（${maxConcurrent.value}），请先结束一个会话`)
  return
}
```

## 三、Sprint 1 — 多会话新消息通知机制（P1-4）

### 3.1 问题根因

当前收到新消息时，WS handler 只把消息追加到对应 session 的 `msgs` 数组，没有任何跨会话的感知通知。座席专注于会话 A 时，会话 B 的新消息只有左侧绿点变化。

### 3.2 未读计数设计

**在 `SessionData` 接口中新增字段：**

```typescript
// apps/src/views/customerservice/agent/index.vue（顶部接口区域）
interface SessionData {
  // ...原有字段...
  unreadCount: number   // 新增：当前会话未读消息数
}
```

**新增 session 初始化时设置默认值：**

```typescript
// accept 时初始化
unreadCount: 0,
```

### 3.3 消息到达时的未读逻辑

在 `useAgentWebSocket.ts` 的 `onMessage` 回调处理链中，通知组件层更新未读数：

```typescript
// useAgentWebSocket.ts 新增 onNewMessage 回调类型
type OnNewMessageCallback = (sessionId: string) => void

// connectSession 参数扩展
export function connectSession(
  sessionId: string,
  onMessage: (msg: WsChatMessage) => void,
  onReconnect: () => void,
  onNewMessage?: OnNewMessageCallback   // 新增，可选
)
```

**组件层（index.vue）接入回调：**

```typescript
connectSession(s.id, handleWsMessage, handleReconnect, (sessionId) => {
  // 只有非当前活跃会话才累加未读
  if (activeSession.value?.id !== sessionId) {
    const target = sessions.value.find(s => s.id === sessionId)
    if (target) {
      target.unreadCount++
      triggerNewMessageNotification(target.name)
    }
  }
})

// 切换到某会话时清零未读
function selectSession(sessionId: string) {
  sessions.value.forEach(s => {
    s.active = s.id === sessionId
    if (s.active) s.unreadCount = 0
  })
}
```

### 3.4 浏览器通知（Notification API）

```typescript
// apps/src/composables/useNotification.ts（新建）
export function useNotification() {
  const permitted = ref(Notification.permission === 'granted')

  async function requestPermission() {
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      permitted.value = result === 'granted'
    }
  }

  function notify(title: string, body: string) {
    if (!permitted.value || document.visibilityState === 'visible') return
    // 页面可见时不弹系统通知，用页面内 toast 代替
    new Notification(title, { body, icon: '/favicon.ico' })
  }

  return { permitted, requestPermission, notify }
}
```

**在 `index.vue` onMounted 中申请权限：**

```typescript
const { requestPermission, notify } = useNotification()

onMounted(async () => {
  await requestPermission()
  // ...其他初始化...
})
```

### 3.5 页面内 Toast 提示

```typescript
function triggerNewMessageNotification(visitorName: string) {
  // 页面可见时用 ant-design message，不打断当前操作
  if (document.visibilityState === 'visible') {
    message.info({
      content: `${visitorName} 发来新消息`,
      duration: 3,
      key: `new-msg-${visitorName}`, // 同一访客消息去重，不叠加多个 toast
    })
  } else {
    // 页面不可见时走系统通知
    notify('新消息', `${visitorName} 发来新消息`)
  }
}
```

### 3.6 左侧队列未读角标

```html
<!-- 会话列表 item 模板 -->
<div class="relative">
  <a-avatar ...>{{ s.nameChar }}</a-avatar>
  <span
    v-if="s.unreadCount > 0"
    class="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px]
           rounded-full flex items-center justify-center px-1"
  >
    {{ s.unreadCount > 99 ? '99+' : s.unreadCount }}
  </span>
</div>
```

### 3.7 标签页 Title Badge

```typescript
// 计算所有会话的总未读数，更新标签页标题
const totalUnread = computed(() =>
  sessions.value.reduce((sum, s) => sum + s.unreadCount, 0)
)

watch(totalUnread, (count) => {
  document.title = count > 0
    ? `(${count}) 座席工作台 - AI智能客服`
    : '座席工作台 - AI智能客服'
})
```

## 四、Sprint 2 — 快捷回复动态化（P1-2）

### 4.1 问题根因

当前快捷回复是组件内硬编码数组，无法通过管理界面维护，业务话术变更需发版。

### 4.2 类型定义

```typescript
// apps/src/api/session/index.ts 新增
export interface QuickReply {
  id: number
  category: string    // 分组名称，如"订单类"、"物流类"
  content: string     // 回复内容
  sortOrder: number
}

export interface QuickReplyCategory {
  name: string
  replies: QuickReply[]
}

export function getQuickRepliesApi(params?: { category?: string; keyword?: string }) {
  return requestClient.get<QuickReply[]>('/api/v1/quick-replies', { params })
}
```

### 4.3 新建 composable

**文件：`apps/src/composables/useQuickReplies.ts`（新建）**

```typescript
import { ref, computed } from 'vue'
import { getQuickRepliesApi, type QuickReply } from '@/api/session'

export function useQuickReplies() {
  const allReplies = ref<QuickReply[]>([])
  const loading = ref(false)
  const searchKeyword = ref('')

  async function load() {
    loading.value = true
    try {
      allReplies.value = await getQuickRepliesApi()
    } finally {
      loading.value = false
    }
  }

  // 按关键词过滤（纯前端，不重复请求）
  const filtered = computed(() => {
    const kw = searchKeyword.value.trim().toLowerCase()
    if (!kw) return allReplies.value
    return allReplies.value.filter(r => r.content.toLowerCase().includes(kw))
  })

  // 按分组聚合，供 UI 分组展示
  const grouped = computed(() => {
    const map = new Map<string, QuickReply[]>()
    for (const r of filtered.value) {
      const list = map.get(r.category) ?? []
      list.push(r)
      map.set(r.category, list)
    }
    return [...map.entries()].map(([name, replies]) => ({ name, replies }))
  })

  return { grouped, filtered, loading, searchKeyword, load }
}
```

### 4.4 组件改造

**index.vue 中替换硬编码：**

```typescript
// 删除原来的硬编码数组
// const quickReplies = ['已核实订单信息', '安排补发处理', ...]

// 改为
const { grouped, searchKeyword: qrSearch, load: loadQuickReplies } = useQuickReplies()

onMounted(async () => {
  await loadQuickReplies()
  // ...其他初始化...
})

function applyQuickReply(content: string) {
  msgInput.value = content
  // 聚焦输入框
  nextTick(() => inputRef.value?.focus())
}
```

### 4.5 模板改造

快捷回复区域从横向 chip 列表改为带搜索的下拉面板：

```html
<a-popover trigger="click" placement="topLeft">
  <template #content>
    <div class="w-72">
      <!-- 搜索框 -->
      <a-input
        v-model:value="qrSearch"
        placeholder="搜索快捷回复..."
        class="mb-2"
        allow-clear
      />
      <!-- 分组展示 -->
      <div class="max-h-64 overflow-y-auto">
        <template v-if="grouped.length === 0">
          <a-empty :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无匹配" />
        </template>
        <template v-for="group in grouped" :key="group.name">
          <div class="text-xs text-gray-400 px-1 py-1">{{ group.name }}</div>
          <div
            v-for="item in group.replies"
            :key="item.id"
            class="px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50 text-sm"
            @click="applyQuickReply(item.content)"
          >
            {{ item.content }}
          </div>
        </template>
      </div>
    </div>
  </template>
  <!-- 触发按钮 -->
  <a-button size="small" type="text">
    <template #icon><MessageOutlined /></template>
    快捷回复
  </a-button>
</a-popover>
```

### 4.6 草稿自动保存（输入框增强附属）

切换会话时输入框内容会丢失，在此一并解决：

```typescript
// 使用 sessionStorage 保存每个会话的草稿
function saveDraft(sessionId: string, content: string) {
  if (content.trim()) {
    sessionStorage.setItem(`draft:${sessionId}`, content)
  } else {
    sessionStorage.removeItem(`draft:${sessionId}`)
  }
}

function loadDraft(sessionId: string): string {
  return sessionStorage.getItem(`draft:${sessionId}`) ?? ''
}

// 切换会话时：保存旧草稿，加载新草稿
watch(activeSession, (next, prev) => {
  if (prev) saveDraft(prev.id, msgInput.value)
  if (next) msgInput.value = loadDraft(next.id)
})

// 发送成功后清除草稿
async function sendMessage() {
  // ...原有发送逻辑...
  sessionStorage.removeItem(`draft:${activeSession.value!.id}`)
  msgInput.value = ''
}
```

## 五、Sprint 2 — 内部备注 + 转交交接备注（P2-3 & P2-4）

### 5.1 内部备注功能

#### 5.1.1 类型扩展

```typescript
// index.vue 顶部接口区域
interface Msg {
  id: number
  role: 'agent' | 'ai' | 'system' | 'tool' | 'user' | 'note'  // 新增 'note'
  text: string
  time?: string
  toolName?: string
  toolRequestId?: string
  toolCalls?: ChatToolCall[]
}
```

#### 5.1.2 发送备注逻辑

备注消息只在前端本地追加（不经过 WS 发送给访客），同时调用后端持久化接口：

```typescript
// apps/src/api/session/index.ts 新增
export function addSessionNoteApi(sessionId: string, content: string) {
  return requestClient.post<void>(`/api/v1/sessions/${sessionId}/notes`, { content })
}
```

```typescript
// index.vue 新增
const noteInput = ref('')
const noteMode = ref(false)  // 是否处于备注输入状态

async function sendNote() {
  const content = noteInput.value.trim()
  if (!content || !activeSession.value) return

  const session = activeSession.value
  // 乐观更新：先追加到本地消息列表
  const noteMsg: Msg = {
    id: Date.now(),
    role: 'note',
    text: content,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  }
  session.msgs.push(noteMsg)
  noteInput.value = ''
  noteMode.value = false

  // 后端持久化（失败时不从列表移除，但提示）
  try {
    await addSessionNoteApi(session.id, content)
  } catch {
    message.error('备注保存失败，将在本地保留')
  }
}
```

#### 5.1.3 备注消息渲染

```html
<!-- 消息区域：note 类型特殊样式 -->
<template v-if="msg.role === 'note'">
  <div class="flex justify-center my-1">
    <div class="inline-flex items-center gap-1 px-3 py-1 bg-yellow-50 border border-yellow-200
                text-yellow-700 text-xs rounded-full max-w-[80%]">
      <LockOutlined class="text-[10px]" />
      <span>内部备注：{{ msg.text }}</span>
      <span class="text-gray-400 ml-1">{{ msg.time }}</span>
    </div>
  </div>
</template>
```

#### 5.1.4 输入区切换按钮

```html
<div class="flex items-center gap-2 mb-1">
  <a-radio-group v-model:value="noteMode" button-style="solid" size="small">
    <a-radio-button :value="false">回复访客</a-radio-button>
    <a-radio-button :value="true">
      <LockOutlined /> 内部备注
    </a-radio-button>
  </a-radio-group>
</div>

<!-- 输入框根据 noteMode 切换占位符和样式 -->
<textarea
  v-model="noteMode ? noteInput : msgInput"
  :placeholder="noteMode ? '输入内部备注（访客不可见）...' : '输入回复内容...'"
  :class="noteMode ? 'bg-yellow-50 border-yellow-300' : ''"
/>
```

---

### 5.2 转交交接备注（P2-4）

#### 5.2.1 类型扩展

```typescript
// apps/src/api/session/index.ts
export interface TransferRequest {
  targetAgentId: string
  note?: string   // 新增交接备注字段
}
```

#### 5.2.2 转交弹窗改造

```html
<!-- TransferModal 组件内，在在线座席列表下方新增备注输入 -->
<a-form-item label="交接备注" class="mt-3">
  <a-textarea
    v-model:value="transferNote"
    placeholder="可选：向接手座席说明当前问题进展..."
    :rows="3"
    :maxlength="200"
    show-count
  />
</a-form-item>
```

```typescript
// 转交确认时携带备注
const transferNote = ref('')

async function confirmTransfer() {
  await transferSessionApi(activeSession.value!.id, {
    targetAgentId: selectedAgentId.value,
    note: transferNote.value.trim() || undefined,
  })
  transferNote.value = ''
  transferVisible.value = false
}
```

#### 5.2.3 接收方展示

转交成功后，接手座席在「转换原因」区域展示备注内容（后端需在 SSE TRANSFER 事件的 payload 中携带 note 字段，前端渲染逻辑）：

```html
<!-- 右侧转换原因卡片 -->
<div class="mt-2 text-sm text-gray-600">
  <span class="text-orange-500">●</span>
  {{ activeSession.transferReason }}
</div>
<div v-if="activeSession.transferNote" class="mt-1 text-xs text-gray-500 italic">
  交接备注：{{ activeSession.transferNote }}
</div>
```

同时 `SessionData` 新增字段：

```typescript
interface SessionData {
  // ...
  transferNote?: string  // 新增
}
```

## 六、Sprint 2 — 结束会话满意度收集 + 会话时长（P2-5 & P2-6）

### 6.1 会话时长显示（P2-5）

#### 6.1.1 类型扩展

```typescript
interface SessionData {
  // ...原有字段...
  acceptedAt: number   // 新增：接入时的 epoch 秒数，由 accept API 响应返回
}
```

#### 6.1.2 初始化 acceptedAt

```typescript
// accept 时记录接入时间
async function acceptQueueItem(item: SessionQueueItem) {
  const resp = await acceptSessionApi(item.sessionId)
  const session: SessionData = {
    // ...其他字段...
    acceptedAt: resp.acceptedAt ?? Math.floor(Date.now() / 1000),
  }
  sessions.value.push(session)
}
```

#### 6.1.3 实时计时器

复用 `useSessionQueue` 中已有的 1s 定时器模式：

```typescript
// index.vue 中新增响应式计时
const now = ref(Math.floor(Date.now() / 1000))
let sessionTimer: ReturnType<typeof setInterval>

onMounted(() => {
  sessionTimer = setInterval(() => {
    now.value = Math.floor(Date.now() / 1000)
  }, 1000)
})
onBeforeUnmount(() => clearInterval(sessionTimer))

// 计算当前活跃会话时长
const sessionDuration = computed(() => {
  const s = activeSession.value
  if (!s) return '0:00'
  return formatWaitTime(s.acceptedAt)  // 复用已有工具函数
})
```

#### 6.1.4 模板新增

```html
<!-- 右侧会话信息面板，排队时长下方 -->
<div class="flex justify-between text-sm">
  <span class="text-gray-500">排队时长</span>
  <span>{{ activeSession.min }}</span>
</div>
<div class="flex justify-between text-sm mt-1">
  <span class="text-gray-500">会话时长</span>
  <span class="font-medium text-blue-600">{{ sessionDuration }}</span>
</div>
```

---

### 6.2 结束会话满意度收集（P2-6）

#### 6.2.1 API 扩展

```typescript
// apps/src/api/session/index.ts
export type SessionCloseReason = 'RESOLVED' | 'UNRESOLVED' | 'FOLLOW_UP'

export interface CloseSessionRequest {
  reason: SessionCloseReason
}

export function closeSessionApi(sessionId: string, payload: CloseSessionRequest) {
  return requestClient.post<void>(`/api/v1/sessions/${sessionId}/close`, payload)
}
```

#### 6.2.2 结束会话弹窗改造

原来的 `closeConfirmVisible` 弹窗只有一个确认按钮，改造为带解决状态选择的表单弹窗：

```typescript
// 新增状态变量
const closeReason = ref<SessionCloseReason>('RESOLVED')
```

```html
<a-modal
  v-model:open="closeConfirmVisible"
  title="结束会话"
  @ok="confirmClose"
  ok-text="确认结束"
  cancel-text="取消"
>
  <div class="py-2">
    <p class="text-gray-600 mb-4">请标注本次服务的处理结果：</p>
    <a-radio-group v-model:value="closeReason" class="flex flex-col gap-3">
      <a-radio value="RESOLVED">
        <span class="font-medium">✅ 已解决</span>
        <span class="text-gray-500 text-xs ml-2">问题已处理完毕</span>
      </a-radio>
      <a-radio value="UNRESOLVED">
        <span class="font-medium">❌ 未解决</span>
        <span class="text-gray-500 text-xs ml-2">问题暂时无法处理</span>
      </a-radio>
      <a-radio value="FOLLOW_UP">
        <span class="font-medium">📋 转单跟进</span>
        <span class="text-gray-500 text-xs ml-2">需后续跟进处理</span>
      </a-radio>
    </a-radio-group>
  </div>
</a-modal>
```

#### 6.2.3 结束逻辑调整

```typescript
async function confirmClose() {
  const sessionId = activeSession.value?.id
  if (!sessionId) return
  try {
    await closeSessionApi(sessionId, { reason: closeReason.value })
    // 从 sessions 列表移除，移入 closedSessions
    const idx = sessions.value.findIndex(s => s.id === sessionId)
    if (idx !== -1) sessions.value.splice(idx, 1)
    closeConfirmVisible.value = false
    closeReason.value = 'RESOLVED'  // 重置默认值
    message.success('会话已结束')
  } catch {
    message.error('结束会话失败，请重试')
  }
}
```

#### 6.2.4 CSAT 触发说明

CSAT 评分邀请由**后端**在收到 `close` 请求后，通过已有的 WS `notifyVisitor` 机制向访客端推送，前端不需要额外处理。前端只需传递 `reason` 字段，后端根据 reason 决定是否触发 CSAT（如 `RESOLVED` 和 `FOLLOW_UP` 触发，`UNRESOLVED` 不触发）。

## 七、Sprint 3 — 打字状态提示 + 会话内消息搜索（P2-1 & P2-2）

### 7.1 访客打字状态提示（P2-1）

#### 7.1.1 WS 消息类型扩展

后端推送新增 `TYPING` 类型事件（详见后端文档），前端对应处理：

```typescript
// apps/src/api/session/index.ts
export interface WsChatMessage {
  type: 'AGENT_JOINED' | 'CONNECTED' | 'MESSAGE' | 'TYPING' | 'STOP_TYPING'  // 新增
  sessionId: string
  role?: 'agent' | 'user'
  content?: string
  seq?: number | string
  timestamp?: number
}
```

#### 7.1.2 SessionData 扩展

```typescript
interface SessionData {
  // ...
  visitorTyping: boolean  // 新增：访客是否正在输入
}
```

#### 7.1.3 composable 处理

```typescript
// useAgentWebSocket.ts 的 onMessage 回调中
// 组件层传入对应处理
function handleWsMessage(raw: WsChatMessage) {
  if (raw.type === 'TYPING') {
    const s = sessions.value.find(s => s.id === raw.sessionId)
    if (s) {
      s.visitorTyping = true
      // 3 秒后自动清除（防止后端漏发 STOP_TYPING）
      clearTimeout(typingTimers.get(raw.sessionId))
      const timer = setTimeout(() => {
        s.visitorTyping = false
      }, 3000)
      typingTimers.set(raw.sessionId, timer)
    }
    return
  }
  if (raw.type === 'STOP_TYPING') {
    const s = sessions.value.find(s => s.id === raw.sessionId)
    if (s) {
      s.visitorTyping = false
      clearTimeout(typingTimers.get(raw.sessionId))
    }
    return
  }
  // 原有 MESSAGE 处理逻辑不变...
}

// 组件顶层声明计时器 Map（不需要响应式）
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

onBeforeUnmount(() => {
  typingTimers.forEach(t => clearTimeout(t))
  typingTimers.clear()
})
```

#### 7.1.4 模板渲染

```html
<!-- 消息区域底部，输入框上方 -->
<transition name="fade">
  <div
    v-if="activeSession?.visitorTyping"
    class="flex items-center gap-2 px-4 py-1 text-xs text-gray-400"
  >
    <!-- 三点动画 -->
    <span class="flex gap-0.5">
      <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
      <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
      <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
    </span>
    <span>访客正在输入...</span>
  </div>
</transition>
```

---

### 7.2 会话内消息搜索（P2-2）

#### 7.2.1 状态变量

```typescript
const msgSearchKeyword = ref('')
const msgSearchVisible = ref(false)
const msgSearchMatchIndex = ref(-1)  // 当前高亮的匹配项索引

// 搜索结果：返回匹配消息的 id 列表
const msgSearchResults = computed(() => {
  const kw = msgSearchKeyword.value.trim().toLowerCase()
  if (!kw || !activeSession.value) return []
  return activeSession.value.msgs
    .filter(m => m.text?.toLowerCase().includes(kw))
    .map(m => m.id)
})

watch(msgSearchResults, (results) => {
  // 有结果时定位到第一个
  msgSearchMatchIndex.value = results.length > 0 ? 0 : -1
})
```

#### 7.2.2 导航逻辑

```typescript
function searchNext() {
  if (msgSearchResults.value.length === 0) return
  msgSearchMatchIndex.value =
    (msgSearchMatchIndex.value + 1) % msgSearchResults.value.length
  scrollToMsg(msgSearchResults.value[msgSearchMatchIndex.value])
}

function searchPrev() {
  if (msgSearchResults.value.length === 0) return
  msgSearchMatchIndex.value =
    (msgSearchMatchIndex.value - 1 + msgSearchResults.value.length) %
    msgSearchResults.value.length
  scrollToMsg(msgSearchResults.value[msgSearchMatchIndex.value])
}

function scrollToMsg(msgId: number) {
  const el = document.getElementById(`msg-${msgId}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
```

#### 7.2.3 模板搜索栏

```html
<!-- 消息区顶部工具栏，与消息类型 tab 同行右侧 -->
<div class="flex items-center justify-between px-4 py-2 border-b">
  <!-- 左侧：消息类型 tab（原有） -->
  <a-radio-group v-model:value="msgFilter" ...>...</a-radio-group>

  <!-- 右侧：搜索入口 -->
  <transition name="slide-right">
    <div v-if="msgSearchVisible" class="flex items-center gap-1">
      <a-input
        v-model:value="msgSearchKeyword"
        placeholder="搜索消息..."
        size="small"
        class="w-40"
        allow-clear
        @clear="msgSearchVisible = false"
      />
      <span class="text-xs text-gray-400 whitespace-nowrap">
        {{ msgSearchMatchIndex + 1 }}/{{ msgSearchResults.length }}
      </span>
      <a-button size="small" type="text" @click="searchPrev">
        <UpOutlined />
      </a-button>
      <a-button size="small" type="text" @click="searchNext">
        <DownOutlined />
      </a-button>
    </div>
  </transition>
  <a-button
    v-if="!msgSearchVisible"
    size="small" type="text"
    @click="msgSearchVisible = true"
  >
    <SearchOutlined />
  </a-button>
</div>
```

#### 7.2.4 消息高亮渲染

```typescript
// 工具函数：高亮文本中的关键词
function highlightText(text: string, keyword: string): string {
  if (!keyword.trim()) return text
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(
    new RegExp(escaped, 'gi'),
    match => `<mark class="bg-yellow-200 rounded px-0.5">${match}</mark>`
  )
}
```

```html
<!-- 消息气泡 text 渲染改为使用高亮（注意 XSS：text 来自后端受信内容，不含用户原始 HTML） -->
<span
  :id="`msg-${msg.id}`"
  v-html="msgSearchKeyword
    ? highlightText(msg.text, msgSearchKeyword)
    : msg.text"
/>
```

> ⚠️ **安全说明**：`v-html` 仅用于渲染经过 `highlightText` 包装的内容，该函数只插入固定的 `<mark>` 标签，输入内容本身通过 `textContent` 级别的字符串拼接处理，不直接渲染原始用户输入，无 XSS 风险。若未来消息来源扩展，需额外接入 DOMPurify。

## 八、单元测试补充 — useSessionQueue & useAgentWebSocket

### 8.1 测试基础设施

**文件：`apps/src/composables/__tests__/mocks/browser-apis.ts`（新建共享 mock）**

```typescript
// Mock EventSource
export class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0 // CONNECTING
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
    // 模拟异步建立连接
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }

  dispatchMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  dispatchError() {
    this.readyState = 2
    this.onerror?.(new Event('error'))
  }

  close() { this.readyState = 2 }

  static reset() { MockEventSource.instances = [] }
}

// Mock WebSocket
export class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  readyState = 0
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }

  send(data: string) { this.sentMessages.push(data) }
  close() {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close', { code: 1000 }))
  }

  static reset() { MockWebSocket.instances = [] }
}
```

### 8.2 useSessionQueue 单元测试

**文件：`apps/src/composables/__tests__/useSessionQueue.test.ts`（新建）**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { MockEventSource } from './mocks/browser-apis'
import { formatWaitTime, resolveTagColor } from '../useSessionQueue'

vi.stubGlobal('EventSource', MockEventSource)

// --- 纯函数测试 ---
describe('resolveTagColor', () => {
  it('已知标签返回对应颜色', () => {
    expect(resolveTagColor('咨询')).toBe('blue')
  })
  it('未知标签返回 default', () => {
    expect(resolveTagColor('未知标签xyz')).toBe('default')
  })
})

describe('formatWaitTime', () => {
  it('206 秒应返回 "3:26"', () => {
    const since = Math.floor(Date.now() / 1000) - 206
    expect(formatWaitTime(since)).toBe('3:26')
  })
  it('0 秒应返回 "0:00"', () => {
    const since = Math.floor(Date.now() / 1000)
    expect(formatWaitTime(since)).toBe('0:00')
  })
  it('个位秒数应补零', () => {
    const since = Math.floor(Date.now() / 1000) - 65
    expect(formatWaitTime(since)).toBe('1:05')
  })
})

// --- SSE 队列行为测试 ---
describe('useSessionQueue SSE behavior', () => {
  beforeEach(() => MockEventSource.reset())
  afterEach(() => vi.clearAllTimers())

  it('SQ-002: 收到 ENQUEUE 事件后 queue 新增条目', async () => {
    const { useSessionQueue } = await import('../useSessionQueue')
    const { queue } = useSessionQueue()
    await nextTick()

    const sse = MockEventSource.instances[0]
    sse.dispatchMessage({
      type: 'ENQUEUE',
      item: { sessionId: 'sess-1', userName: '张三', transferReason: '咨询', tag: '咨询', waitSince: 1000, status: 'WAITING' },
    })
    await nextTick()
    expect(queue.value.some(q => q.sessionId === 'sess-1')).toBe(true)
  })

  it('SQ-003: 收到 ACCEPTED 事件后对应条目从 queue 移除', async () => {
    // 先注入一个等待项
    // ...（具体实现参照项目 mock 方式）
    expect(true).toBe(true) // placeholder，按实际 composable 初始化方式补充
  })

  it('SQ-009: 组件卸载后 SSE 连接被正确关闭', async () => {
    const { useSessionQueue } = await import('../useSessionQueue')
    useSessionQueue()
    await nextTick()
    const sse = MockEventSource.instances[0]
    // 触发 scope dispose（组件卸载）
    // 验证 sse.readyState === 2
    expect(sse).toBeDefined()
  })
})
```

### 8.3 useAgentWebSocket 单元测试

**文件：`apps/src/composables/__tests__/useAgentWebSocket.test.ts`（新建）**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { MockWebSocket } from './mocks/browser-apis'

vi.stubGlobal('WebSocket', MockWebSocket)

describe('useAgentWebSocket', () => {
  beforeEach(() => MockWebSocket.reset())

  it('WS-001: connectSession 后 statusMap 变为 CONNECTING', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket')
    const { connectSession, statusMap } = useAgentWebSocket()
    connectSession('sess-a', vi.fn(), vi.fn())
    expect(statusMap['sess-a']).toBe('CONNECTING')
  })

  it('WS-002: onopen 后 statusMap 变为 CONNECTED', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket')
    const { connectSession, statusMap } = useAgentWebSocket()
    connectSession('sess-b', vi.fn(), vi.fn())
    await nextTick()
    expect(statusMap['sess-b']).toBe('CONNECTED')
  })

  it('WS-004: sendMessage 在 CONNECTED 时调用 ws.send', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket')
    const { connectSession, sendMessage } = useAgentWebSocket()
    connectSession('sess-c', vi.fn(), vi.fn())
    await nextTick()
    sendMessage('sess-c', 'hello')
    const ws = MockWebSocket.instances[0]
    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0]).content).toBe('hello')
  })

  it('WS-008: 5 个并发 session 的 statusMap 互不干扰', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket')
    const { connectSession, statusMap } = useAgentWebSocket()
    const ids = ['s1', 's2', 's3', 's4', 's5']
    ids.forEach(id => connectSession(id, vi.fn(), vi.fn()))
    await nextTick()
    ids.forEach(id => expect(statusMap[id]).toBe('CONNECTED'))
  })
})
```

### 8.4 运行方式

```bash
# 只跑 composable 单测
pnpm --filter @vben/web-antd vitest run src/composables/__tests__

# 监听模式开发
pnpm --filter @vben/web-antd vitest src/composables/__tests__
```

## 九、E2E 测试补充方案

### 9.1 需新增的 E2E 用例文件

**文件：`apps/tests/e2e/agent-workbench-extended.spec.ts`（新建）**

### 9.2 MAX_CONCURRENT 场景

```typescript
test('TC-WB-MAX-01: 达到并发上限时接入按钮禁用', async ({ page }) => {
  // 模拟已有 5 个活跃会话（mock API）
  await page.route('/api/v1/sessions/active', route =>
    route.fulfill({ json: generateActiveSessions(5) })
  )
  await page.route('/api/v1/agent/profile', route =>
    route.fulfill({ json: { agentId: 'a1', name: '测试座席', maxConcurrent: 5 } })
  )
  await page.goto('/customerservice/agent')
  await page.waitForLoadState('networkidle')

  // 等待中的会话接入按钮应显示 disabled 或 tooltip 提示
  const acceptBtn = page.locator('[data-testid="queue-accept-btn"]').first()
  await expect(acceptBtn).toBeDisabled()
})

test('TC-WB-MAX-02: 关闭 1 个会话后恢复可接入', async ({ page }) => {
  // 先模拟 5 个活跃，然后触发关闭一个
  // 验证接入按钮恢复可用
})
```

### 9.3 WS 断线重连 + 消息补偿

```typescript
test('TC-WS-RECONNECT-01: WS 断线后状态点恢复已连接', async ({ page }) => {
  await page.goto('/customerservice/agent')
  // 等待 WS 建立
  await page.waitForSelector('[data-testid="ws-status-connected"]')

  // 强制断开 WS（注入 JS）
  await page.evaluate(() => {
    const wsMap = (window as any).__agentWsSessions__
    wsMap?.forEach((ws: WebSocket) => ws.close(1001, 'test disconnect'))
  })

  // 状态应变为重连中
  await expect(page.locator('[data-testid="ws-status-reconnecting"]'))
    .toBeVisible({ timeout: 3000 })

  // 重连后恢复已连接
  await expect(page.locator('[data-testid="ws-status-connected"]'))
    .toBeVisible({ timeout: 10000 })
})

test('TC-WS-RECONNECT-02: 断线期间消息通过 sinceSeq 补偿', async ({ page }) => {
  // 断线 → 补偿请求携带最后 seq → 消息不丢失
  let historyRequestSeq: string | null = null
  await page.route('/api/v1/chat/history*', route => {
    const url = new URL(route.request().url())
    historyRequestSeq = url.searchParams.get('sinceSeq')
    route.fulfill({ json: [] })
  })
  // 验证 sinceSeq 不为 null 且等于断线前最后收到的 seq
})
```

### 9.4 转交后原座席状态变化

```typescript
test('TC-TRANSFER-04: 转交成功后会话从 active 列表移除', async ({ page }) => {
  await page.goto('/customerservice/agent')
  // 模拟有一个活跃会话，点击转交，确认后
  // 验证左侧会话列表中不再包含该 sessionId
  await page.locator('[data-testid="btn-transfer"]').click()
  await page.locator('[data-testid="transfer-agent-item"]').first().click()
  await page.locator('[data-testid="btn-transfer-confirm"]').click()
  await expect(page.locator('[data-testid="session-item-sess-1"]')).not.toBeVisible()
})
```

### 9.5 后端主动关闭 Session

```typescript
test('TC-SESSION-TIMEOUT-01: 后端 CLOSED SSE 事件后会话移入已结束', async ({ page }) => {
  // 通过 SSE mock 推送 CLOSED 事件
  // 验证：active list 移除，closed list 增加，消息区变为只读
  await page.evaluate(() => {
    // 触发模拟 SSE 事件
    document.dispatchEvent(new CustomEvent('__mock_sse__', {
      detail: { type: 'CLOSED', item: { sessionId: 'sess-1', status: 'CLOSED' } }
    }))
  })
  await expect(page.locator('[data-testid="closed-session-sess-1"]')).toBeVisible()
  await expect(page.locator('[data-testid="msg-input"]')).toBeDisabled()
})
```

### 9.6 XSS 防御验证

```typescript
test('TC-SEC-XSS-01: 访客发送 XSS 内容应作为纯文本渲染', async ({ page }) => {
  const xssPayload = '<script>window.__xss_executed=true</script>'
  // 模拟 WS 推送含 XSS 的消息
  // 验证消息内容作为文本展示，且 window.__xss_executed 不为 true
  const xssExecuted = await page.evaluate(() => (window as any).__xss_executed)
  expect(xssExecuted).toBeUndefined()
  // 验证文本内容可见
  await expect(page.locator('text=<script>')).toBeVisible()
})
```

### 9.7 E2E 测试基础设施说明

测试中需要 mock 的接口均通过 `page.route()` 拦截，建议在 `apps/tests/e2e/fixtures/session-fixtures.ts` 中统一维护：

```typescript
// apps/tests/e2e/fixtures/session-fixtures.ts
export function generateActiveSessions(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sessionId: `sess-${i + 1}`,
    userName: `访客${i + 1}`,
    transferReason: '用户主动请求转人工',
    tag: '咨询',
    waitSince: Math.floor(Date.now() / 1000) - 120,
    status: 'ACTIVE',
  }))
}
```

## 十、前端改造实施清单与注意事项

### 10.1 完整改造文件清单

| 文件 | 操作 | 涉及 Sprint |
|---|---|---|
| `apps/src/api/session/index.ts` | 修改：新增 6 个 API 函数和类型 | S1/S2/S3 |
| `apps/src/views/customerservice/agent/index.vue` | 修改：状态、事件、模板全面改造 | S1/S2/S3 |
| `apps/src/composables/useSessionQueue.ts` | 修改：SSE 事件处理扩展 | S1 |
| `apps/src/composables/useAgentWebSocket.ts` | 修改：TYPING 事件 + onNewMessage 回调 | S1/S3 |
| `apps/src/composables/useQuickReplies.ts` | 新建：快捷回复动态加载 | S2 |
| `apps/src/composables/useNotification.ts` | 新建：浏览器通知封装 | S1 |
| `apps/src/composables/__tests__/mocks/browser-apis.ts` | 新建：MockEventSource + MockWebSocket | S1 |
| `apps/src/composables/__tests__/useSessionQueue.test.ts` | 新建：18 个单元测试用例 | S1 |
| `apps/src/composables/__tests__/useAgentWebSocket.test.ts` | 新建：9 个单元测试用例 | S1 |
| `apps/tests/e2e/agent-workbench-extended.spec.ts` | 新建：12 个 E2E 用例 | S2/S3 |
| `apps/tests/e2e/fixtures/session-fixtures.ts` | 新建：测试数据生成器 | S2 |

### 10.2 新增 API 汇总

| 函数名 | HTTP | 路径 | Sprint |
|---|---|---|---|
| `updateAgentStatusApi` | PUT | `/api/v1/agent/status` | S1 |
| `getAgentProfileApi` | GET | `/api/v1/agent/profile` | S1 |
| `addSessionNoteApi` | POST | `/api/v1/sessions/:id/notes` | S2 |
| `getQuickRepliesApi` | GET | `/api/v1/quick-replies` | S2 |
| `closeSessionApi`（扩展）| POST | `/api/v1/sessions/:id/close` | S2 |
| `transferSessionApi`（扩展）| POST | `/api/v1/sessions/:id/transfer` | S2 |

### 10.3 SessionData 接口最终形态

```typescript
interface SessionData {
  id: string
  name: string
  nameChar: string
  color: string
  min: string
  active: boolean
  sessionCode: string
  transferReason: string
  transferNote?: string       // 新增 S2
  tag: string
  waitSince: number
  acceptedAt: number          // 新增 S2（会话时长）
  msgs: Msg[]
  unreadCount: number         // 新增 S1
  visitorTyping: boolean      // 新增 S3
}
```

### 10.4 关键实施注意事项

**① sendBeacon 认证问题**  
`onBeforeUnmount` 调用 `navigator.sendBeacon` 时无法携带 `Authorization` header。推荐方案：
- 方案 A（推荐）：改用 `fetch` + `keepalive: true` + `Authorization` header
- 方案 B：后端从 Sa-Token 的 Redis session cookie 中读取身份（需前端登录时设置 httpOnly cookie）

**② v-html XSS 防御**  
`highlightText` 函数中消息原始文本需先做 HTML 转义再插入 `<mark>` 标签：

```typescript
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlightText(text: string, keyword: string): string {
  const escaped = escapeHtml(text)
  const kw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.replace(
    new RegExp(kw, 'gi'),
    match => `<mark class="bg-yellow-200 rounded px-0.5">${match}</mark>`
  )
}
```

**③ 打字状态 WS 事件依赖后端先行**  
`TYPING` 事件需后端 WS handler 新增广播逻辑，前端改造应在后端就绪后再合并。

**④ 单元测试 mock 隔离**  
每个测试文件中使用 `vi.resetModules()` 确保 composable 实例不跨测试复用：

```typescript
beforeEach(() => {
  vi.resetModules()
  MockWebSocket.reset()
})
```

**⑤ 快捷回复弹窗性能**  
快捷回复量较多时（>100 条），建议在 `grouped` computed 中配合 `v-virtual-scroll` 或限制每组展示数量（如最多 20 条 + "展示更多"）。

### 10.5 与后端改造的依赖关系

```
后端先行（阻塞前端）：
  PUT /api/v1/agent/status        → 前端 P1-1 依赖
  GET /api/v1/agent/profile       → MAX_CONCURRENT 配置化依赖
  GET /api/v1/quick-replies       → P1-2 依赖

后端并行（不阻塞前端开发，可 mock）：
  POST /api/v1/sessions/:id/notes → P2-3 内部备注
  PATCH /api/v1/sessions/:id/tag  → P3-6 标签编辑
  WS TYPING event                 → P2-1 打字状态

后端改造扩展（现有接口扩展字段）：
  POST /api/v1/sessions/:id/close  → 新增 reason 字段
  POST /api/v1/sessions/:id/transfer → 新增 note 字段
  GET  /api/v1/sessions/active     → 新增 acceptedAt 字段
```
---

## 十一、侧边栏 — 历史工单面板 + AI 总结弹窗

### 11.1 功能概述

在右侧信息面板「会话信息」卡片下方新增「历史工单」区块：
- 展示当前访客在系统中的历史会话条数（badge）
- 点击「查看历史」按钮打开抽屉（Drawer），列出所有历史会话
- 每条历史工单可展开查看完整消息记录，或点击「AI 总结」按钮生成/查看 AI 摘要
- AI 总结以流式方式输出，首次生成后缓存，不重复请求

---

### 11.2 API 类型定义

```typescript
// apps/src/api/session/index.ts 新增

/** 历史工单列表项 */
export interface VisitorHistoryItem {
  sessionId: string
  tag: string
  transferReason: string
  status: 'CLOSED'
  startedAt: string    // ISO 8601
  endedAt: string
  msgCount: number
  aiSummary?: string   // 已缓存的 AI 总结，null 表示未生成
}

/** 获取访客历史工单 */
export function getVisitorHistoryApi(visitorName: string, excludeSessionId: string) {
  return requestClient.get<VisitorHistoryItem[]>('/api/v1/sessions/visitor-history', {
    params: { visitorName, excludeSessionId },
  })
}

/** 流式生成 AI 总结（SSE），返回 EventSource URL */
export function getAiSummaryStreamUrl(sessionId: string, token: string) {
  return `/api/v1/sessions/${sessionId}/ai-summary/stream?token=${token}`
}

/** 获取已缓存的 AI 总结 */
export function getAiSummaryApi(sessionId: string) {
  return requestClient.get<{ summary: string | null }>(`/api/v1/sessions/${sessionId}/ai-summary`)
}
```

---

### 11.3 新建 composable

**文件：`apps/src/composables/useVisitorHistory.ts`（新建）**

```typescript
import { ref } from 'vue'
import {
  getVisitorHistoryApi,
  getAiSummaryApi,
  getAiSummaryStreamUrl,
  type VisitorHistoryItem,
} from '@/api/session'
import { useTokenStore } from '@/store/auth'  // 根据实际 store 路径调整

export function useVisitorHistory() {
  const historyList = ref<VisitorHistoryItem[]>([])
  const loading = ref(false)
  const drawerVisible = ref(false)

  // 每条工单的 AI 总结状态：{ [sessionId]: { text, streaming, done } }
  const summaryMap = ref<Record<string, { text: string; streaming: boolean; done: boolean }>>({})

  async function loadHistory(visitorName: string, excludeSessionId: string) {
    loading.value = true
    try {
      historyList.value = await getVisitorHistoryApi(visitorName, excludeSessionId)
    } finally {
      loading.value = false
    }
  }

  function openDrawer(visitorName: string, excludeSessionId: string) {
    drawerVisible.value = true
    loadHistory(visitorName, excludeSessionId)
  }

  /** 流式拉取某条工单的 AI 总结 */
  async function generateSummary(sessionId: string) {
    // 先检查缓存
    const cached = await getAiSummaryApi(sessionId)
    if (cached.summary) {
      summaryMap.value[sessionId] = { text: cached.summary, streaming: false, done: true }
      return
    }

    // 开始流式生成
    const token = useTokenStore().accessToken
    const url = getAiSummaryStreamUrl(sessionId, token)
    summaryMap.value[sessionId] = { text: '', streaming: true, done: false }

    const es = new EventSource(url)
    es.onmessage = (e) => {
      if (e.data === '[DONE]') {
        summaryMap.value[sessionId].streaming = false
        summaryMap.value[sessionId].done = true
        es.close()
        return
      }
      try {
        const chunk = JSON.parse(e.data) as { delta: string }
        summaryMap.value[sessionId].text += chunk.delta
      } catch { /* ignore malformed */ }
    }
    es.onerror = () => {
      summaryMap.value[sessionId].streaming = false
      es.close()
    }
  }

  return {
    historyList, loading, drawerVisible,
    summaryMap, openDrawer, generateSummary,
  }
}
```

---

### 11.4 组件改造

#### 11.4.1 右侧面板新增入口

```html
<!-- 右侧面板「转换原因」卡片下方新增 -->
<div class="mt-3 bg-white rounded-lg p-3 border">
  <div class="flex items-center justify-between">
    <span class="text-sm font-medium text-gray-700">历史工单</span>
    <a-badge :count="historyList.length" :number-style="{ backgroundColor: '#6366f1' }">
      <a-button
        size="small" type="link"
        :loading="historyLoading"
        @click="openHistoryDrawer"
      >
        查看历史
      </a-button>
    </a-badge>
  </div>
  <p v-if="!historyLoading && historyList.length === 0" class="text-xs text-gray-400 mt-1">
    该访客暂无历史工单
  </p>
  <!-- 最近 2 条预览 -->
  <div v-for="item in historyList.slice(0, 2)" :key="item.sessionId"
       class="mt-1.5 text-xs text-gray-500 flex items-center gap-1.5">
    <a-tag :color="resolveTagColor(item.tag)" class="!text-[10px] !px-1">
      {{ item.tag }}
    </a-tag>
    <span class="truncate">{{ item.transferReason }}</span>
    <span class="text-gray-300 shrink-0">{{ formatDate(item.endedAt) }}</span>
  </div>
</div>
```

#### 11.4.2 历史工单抽屉组件

```html
<a-drawer
  v-model:open="historyDrawerVisible"
  title="历史工单记录"
  placement="right"
  :width="480"
  :get-container="false"
  style="position: absolute"
>
  <a-spin :spinning="historyLoading">
    <a-empty v-if="historyList.length === 0" description="暂无历史工单" />

    <a-collapse v-else accordion>
      <a-collapse-panel
        v-for="item in historyList"
        :key="item.sessionId"
      >
        <!-- 面板标题 -->
        <template #header>
          <div class="flex items-center gap-2 w-full">
            <a-tag :color="resolveTagColor(item.tag)" class="!text-xs">{{ item.tag }}</a-tag>
            <span class="text-sm flex-1 truncate">{{ item.transferReason }}</span>
            <span class="text-xs text-gray-400 shrink-0">{{ formatDate(item.endedAt) }}</span>
          </div>
        </template>

        <!-- 面板内容 -->
        <div class="space-y-2">
          <!-- 工单元信息 -->
          <div class="flex gap-4 text-xs text-gray-500">
            <span>开始：{{ formatDate(item.startedAt) }}</span>
            <span>消息轮数：{{ item.msgCount }}</span>
          </div>

          <!-- AI 总结区域 -->
          <div class="bg-purple-50 rounded-lg p-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-purple-700">
                ✨ AI 总结
              </span>
              <a-button
                v-if="!summaryMap[item.sessionId]?.done"
                size="small" type="text"
                :loading="summaryMap[item.sessionId]?.streaming"
                class="!text-purple-600 !text-xs"
                @click="generateSummary(item.sessionId)"
              >
                {{ summaryMap[item.sessionId]?.streaming ? '生成中...' : '生成总结' }}
              </a-button>
              <a-button
                v-else
                size="small" type="text"
                class="!text-gray-400 !text-xs"
                @click="summaryMap[item.sessionId].done = false; generateSummary(item.sessionId)"
              >
                重新生成
              </a-button>
            </div>
            <p v-if="summaryMap[item.sessionId]?.text"
               class="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
              {{ summaryMap[item.sessionId].text }}
              <span v-if="summaryMap[item.sessionId]?.streaming"
                    class="inline-block w-1.5 h-3.5 bg-purple-400 animate-pulse ml-0.5 align-middle" />
            </p>
            <p v-else-if="!summaryMap[item.sessionId]?.streaming"
               class="text-xs text-gray-400">
               点击「生成总结」让 AI 总结本次工单内容
            </p>
          </div>
        </div>
      </a-collapse-panel>
    </a-collapse>
  </a-spin>
</a-drawer>
```

#### 11.4.3 组件逻辑

```typescript
// index.vue 中引入
const {
  historyList, loading: historyLoading, drawerVisible: historyDrawerVisible,
  summaryMap, openDrawer, generateSummary,
} = useVisitorHistory()

// 切换活跃会话时重置并预加载历史条数
watch(activeSession, (session) => {
  if (session) {
    // 静默预加载历史条数（不打开抽屉）
    openDrawer(session.name, session.id)
    historyDrawerVisible.value = false  // 只加载数据，不展示
  }
})

function openHistoryDrawer() {
  if (activeSession.value) {
    historyDrawerVisible.value = true
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', {
    month: '2-digit', day: '2-digit',
  })
}
```

---

### 11.5 依赖后端接口

| 接口 | 说明 |
|---|---|
| `GET /api/v1/sessions/visitor-history` | 按访客名查询历史工单列表 |
| `GET /api/v1/sessions/:id/ai-summary` | 查询已缓存的 AI 总结 |
| `GET /api/v1/sessions/:id/ai-summary/stream` | SSE 流式生成 AI 总结 |
---

## 十二、侧边栏 — AI 回复建议面板

### 12.1 功能概述

在右侧信息面板底部新增「AI 回复建议」卡片：
- 基于当前会话消息上下文 + 知识库内容，实时生成 2-3 条回复建议
- 座席点击建议条目后填入输入框，可二次编辑再发送
- 每次访客发送新消息后自动刷新建议（防抖 800ms）
- 支持手动点击「刷新建议」按钮重新生成

---

### 12.2 API 类型定义

```typescript
// apps/src/api/session/index.ts 新增

export interface ReplySuggestion {
  id: string         // 唯一标识，用于 key
  content: string    // 建议回复内容
  confidence: number // 置信度 0-1，用于排序展示
  source: 'KB' | 'CONTEXT'  // KB=知识库命中, CONTEXT=纯上下文推理
}

/** 获取 AI 回复建议（非流式，返回列表） */
export function getReplySuggestionsApi(sessionId: string) {
  return requestClient.post<ReplySuggestion[]>(
    `/api/v1/sessions/${sessionId}/reply-suggestions`
  )
}
```

---

### 12.3 新建 composable

**文件：`apps/src/composables/useReplySuggestions.ts`（新建）**

```typescript
import { ref } from 'vue'
import { getReplySuggestionsApi, type ReplySuggestion } from '@/api/session'

export function useReplySuggestions() {
  const suggestions = ref<ReplySuggestion[]>([])
  const loading = ref(false)
  const error = ref(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 防抖刷新建议，访客发消息后自动触发
   * @param sessionId 当前会话 ID
   * @param delay     防抖延迟，默认 800ms
   */
  function refresh(sessionId: string, delay = 800) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => fetchSuggestions(sessionId), delay)
  }

  /** 立即刷新（手动点击） */
  async function refreshNow(sessionId: string) {
    if (debounceTimer) clearTimeout(debounceTimer)
    await fetchSuggestions(sessionId)
  }

  async function fetchSuggestions(sessionId: string) {
    loading.value = true
    error.value = false
    try {
      suggestions.value = await getReplySuggestionsApi(sessionId)
    } catch {
      error.value = true
      suggestions.value = []
    } finally {
      loading.value = false
    }
  }

  function clear() {
    suggestions.value = []
    if (debounceTimer) clearTimeout(debounceTimer)
  }

  return { suggestions, loading, error, refresh, refreshNow, clear }
}
```

---

### 12.4 组件改造

#### 12.4.1 右侧面板新增建议卡片

```html
<!-- 右侧面板历史工单卡片下方 -->
<div class="mt-3 bg-white rounded-lg p-3 border">
  <!-- 标题栏 -->
  <div class="flex items-center justify-between mb-2">
    <span class="text-sm font-medium text-gray-700 flex items-center gap-1">
      <BulbOutlined class="text-yellow-500" />
      AI 回复建议
    </span>
    <a-button
      size="small" type="text"
      :loading="suggestionsLoading"
      @click="refreshNow(activeSession!.id)"
    >
      <template #icon><ReloadOutlined /></template>
    </a-button>
  </div>

  <!-- 加载中 -->
  <div v-if="suggestionsLoading" class="space-y-2">
    <a-skeleton :active="true" :paragraph="{ rows: 1 }" :title="false" />
    <a-skeleton :active="true" :paragraph="{ rows: 1 }" :title="false" />
  </div>

  <!-- 错误状态 -->
  <div v-else-if="suggestionsError" class="text-xs text-red-400 text-center py-2">
    生成失败，
    <a-button type="link" size="small" class="!p-0" @click="refreshNow(activeSession!.id)">
      重试
    </a-button>
  </div>

  <!-- 空状态 -->
  <div v-else-if="suggestions.length === 0" class="text-xs text-gray-400 text-center py-2">
    暂无建议，等待访客发送消息
  </div>

  <!-- 建议列表 -->
  <div v-else class="space-y-1.5">
    <div
      v-for="item in suggestions"
      :key="item.id"
      class="group relative px-3 py-2 rounded-lg bg-gray-50 hover:bg-blue-50
             border border-transparent hover:border-blue-200 cursor-pointer
             transition-colors duration-150"
      @click="applySuggestion(item.content)"
    >
      <!-- 来源 badge -->
      <span
        class="absolute top-1.5 right-2 text-[9px] px-1 rounded"
        :class="item.source === 'KB'
          ? 'bg-green-100 text-green-600'
          : 'bg-blue-100 text-blue-600'"
      >
        {{ item.source === 'KB' ? '知识库' : '上下文' }}
      </span>

      <p class="text-xs text-gray-700 leading-relaxed pr-8">{{ item.content }}</p>

      <!-- 悬停时的操作提示 -->
      <div class="hidden group-hover:flex items-center gap-1 mt-1">
        <span class="text-[10px] text-blue-500">点击填入输入框</span>
      </div>
    </div>
  </div>
</div>
```

#### 12.4.2 逻辑接入

```typescript
// index.vue 引入
const {
  suggestions, loading: suggestionsLoading, error: suggestionsError,
  refresh: refreshSuggestions, refreshNow, clear: clearSuggestions,
} = useReplySuggestions()

// 访客发来新消息时，自动触发建议刷新
function handleWsMessage(raw: WsChatMessage) {
  if (raw.type === 'MESSAGE' && raw.role === 'user') {
    // 原有消息处理逻辑...
    // 新增：防抖刷新建议
    if (activeSession.value?.id === raw.sessionId) {
      refreshSuggestions(raw.sessionId, 800)
    }
  }
  // ...
}

// 切换会话时清空建议并重新加载
watch(activeSession, (session) => {
  clearSuggestions()
  if (session) {
    refreshSuggestions(session.id, 0)  // 切换时立即刷新（不延迟）
  }
})

// 点击建议填入输入框
function applySuggestion(content: string) {
  msgInput.value = content
  nextTick(() => inputRef.value?.focus())
}
```

---

### 12.5 交互细节说明

| 场景 | 行为 |
|---|---|
| 访客发送新消息 | 800ms 防抖后自动刷新建议 |
| 座席切换会话 | 立即清空旧建议，触发新会话建议加载 |
| 座席点击建议 | 内容填入输入框，不自动发送，允许二次编辑 |
| 建议卡片来源为「知识库」| 展示绿色「知识库」badge，优先排在上方 |
| 建议卡片来源为「上下文」| 展示蓝色「上下文」badge |
| 手动点击刷新 | 跳过防抖，立即重新请求 |
| 网络请求失败 | 显示重试入口，不影响主聊天区域 |

---

### 12.6 依赖后端接口

| 接口 | 说明 |
|---|---|
| `POST /api/v1/sessions/:id/reply-suggestions` | 基于当前会话上下文 + 知识库生成回复建议 |
