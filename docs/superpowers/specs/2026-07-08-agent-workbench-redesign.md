# 座席工作台页面重设计 — 设计文档

**日期**: 2026-07-08  
**路由**: `/customerservice/agent`  
**文件**: `apps/src/views/customerservice/agent/index.vue`  
**方案**: B — 视觉重设计 + 组件拆分，保留 Ant Design Vue + Tailwind 技术栈

---

## 1. 背景与目标

现状：`agent/index.vue` 为单文件巨型组件（约 2100 行），所有视图逻辑混在一起，难以维护。  
参考：`/Users/lycodeing/Downloads/vue-workbench` 为设计稿出码原型，提供了更清晰的视觉语言和组件划分思路。

目标：
- 将页面拆分为 5 个职责单一的子组件
- 全面应用 vue-workbench 的设计 token（主色、背景、圆角、间距）
- 所有业务逻辑（composable、API 调用）**一行不动**，只搬迁到合适位置或通过 props/emits 传递
- 保持 Ant Design Vue + Tailwind 技术栈

---

## 2. 组件拆分结构

```
apps/src/views/customerservice/agent/
  index.vue              # 外壳：Page 容器 + 状态汇总 + 所有 composable 调用 + Modal/Drawer
  AgentLeftPanel.vue     # 左栏：座席状态卡片 + 会话队列（等待/接待中/已结束三 Tab）
  AgentChatArea.vue      # 中栏：对话消息流 + 快捷回复 + 输入区
  AgentRightPanel.vue    # 右栏：会话信息 + 转接原因 + 历史工单入口
  AISuggestPanel.vue     # AI 回复建议独立组件（从右栏抽出）
```

### Props / Emits 边界

**AgentLeftPanel**
```ts
props: {
  agentOnline: boolean
  concurrent: number
  maxConcurrent: number
  sseConnected: boolean
  queueStateTab: 'waiting' | 'active' | 'closed'
  queue: QueueItem[]
  pagedQueue: QueueItem[]
  queuePage: number
  queueTotalPages: number
  queueSearch: string
  sessions: SessionData[]
  visiblePagedQueue: QueueItem[]
  visibleSessions: SessionData[]
  closedSessions: ClosedSessionItem[]
  closedLoading: boolean
  closedView: ClosedView | null
}
emits: [
  'update:agentOnline',
  'update:queueStateTab',
  'update:queuePage',
  'update:queueSearch',
  'accept-queue',     // (item: QueueItem)
  'switch-session',   // (s: SessionData)
  'view-closed',      // (item: ClosedSessionItem)
  'reconnect-queue',
]
```

**AgentChatArea**
```ts
props: {
  activeSession: SessionData | undefined
  closedView: ClosedView | null
  msgFilter: string
  filteredMsgs: Msg[]
  msgInput: string
  activeWsStatus: 'open' | 'connecting' | 'closed'
  wsStatusMeta: { color: string; text: string }
  toolExpanded: Record<number, boolean>
  quickReply: string[]
  queue: QueueItem[]
  maxConcurrent: number
  concurrent: number
}
emits: [
  'update:msgInput',
  'update:msgFilter',
  'send',
  'quick-reply',      // (q: string)
  'toggle-tool',      // (id: number)
  'transfer',
  'close-session',
  'reconnect-session',
  'copy-msg',         // (text: string)
]
```

**AgentRightPanel**
```ts
props: {
  activeSession: SessionData | undefined
  visitorHistoryList: HistoryItem[]
  visitorHistoryLoading: boolean
}
emits: [
  'open-history-drawer',
]
// AISuggestPanel 内嵌，通过自身 props 接收建议相关状态
```

**AISuggestPanel**
```ts
props: {
  sessionId: string
  suggestions: ReplySuggestion[]
  loading: boolean
  hasError: boolean
}
emits: [
  'apply',            // (content: string)
  'refresh',          // ()
]
```

---

## 3. 设计 Token（对齐 vue-workbench）

| Token | 值 | 用途 |
|-------|----|------|
| `--wb-canvas` | `#f7f8fc` | 页面背景 |
| `--wb-aside` | `#eef1f8` | 左侧栏背景 |
| `--wb-primary` | `#1a73e8` | 主色（替换现有 `#4f46e5`） |
| `--wb-text` | `#0a0a0b` | 主文字 |
| `--wb-text-sub` | `#52525b` | 次级文字 |
| `--wb-divider` | `#e4e7ed` | 分隔线 |
| `--wb-warn-bg` | `#fff0eb` | 警告橙背景 |
| `--wb-warn-text` | `#923b0e` | 警告橙文字 |

在 `agent/index.vue` 顶部 `<style scoped>` 内声明，供所有子组件通过 `inherit` 访问；或直接在 Tailwind 行内 class 中使用十六进制值（与现有代码风格保持一致）。

---

## 4. 各区域视觉变更

### 4.1 整体布局

- 左栏：`w-56`（224px）→ `w-[240px]`
- 右栏：`w-64`（256px）→ `w-[300px]`
- 左栏背景：白色 → `#eef1f8`（与 vue-workbench 一致）
- 页面背景：保持 `#f7f8fc`

### 4.2 左栏 — AgentLeftPanel

**座席状态卡片**
- 外观：圆角 `rounded-xl`，`bg-white`，`p-3.5`
- 在线/暂离 Switch 保持 ADesign，checked 颜色改为 `#1a73e8`
- Progress 条颜色：`#1a73e8`（满载时 `#ef4444`）
- 负载文字：`{n}/{max} 在线`

**会话队列 Tab**
- 4 段 Segmented 样式（纯 Tailwind 手写，不用 ADesign Segmented）
- Tab 排列：AI 对话 / 等待人工 / 人工 / 结束（现有为 3 tab，新增 AI 对话）
  - 注：现有代码实际 tab 为：等待人工 / 人工接待中 / 已结束，保持逻辑不变，视觉重写
- 激活态：`bg-[#1a73e8] text-white`，圆角 `rounded-md`
- 背景容器：`bg-[#eef1f8] rounded-lg p-0.5`

**等待人工列表项**
- 背景：`bg-white rounded-xl p-2.5`，hover：`bg-[#f5fafe]`
- 取消现有橙色 `amber` 边框，改为无边框白底
- 接入按钮：`bg-[#1a73e8]` primary 蓝色

**接待中列表项**
- 激活：`bg-[#f5fafe]`（与 vue-workbench active 态一致），取消 indigo 系
- 状态点颜色：激活 `#10b981`，其余 `#e4e7ed`

### 4.3 中栏 — AgentChatArea

**顶栏 header**
- 高度：`h-16`，背景 `bg-white`
- 访客头像：`bg-[#e8f0ff] text-[#1a73e8]`
- 消息类型 Tag 筛选：圆角胶囊 `rounded-[13px]`，激活 `bg-[#1a73e8] text-white`
- 连接状态点 + WS 状态文字
- 转交按钮：`border border-[#e4e7ed]` 边框样式
- 结束会话按钮：`bg-[#1a73e8]`

**消息流背景**：`bg-[#f7f8fc]`（现为 `bg-gray-50`）

**消息气泡**
- 用户消息：`bg-white rounded-xl rounded-tl-none`，无边框（现为 `border border-gray-200`）
- AI 消息：`bg-white rounded-xl rounded-tr-none`（现为 `bg-indigo-50`），文字 `text-[#0a0a0b]`
- 座席消息：`bg-[#1a73e8] rounded-xl rounded-tr-none text-white`（现为 indigo-500）

**工具调用卡片** — 对齐 vue-workbench 天气卡片风格
- 头部：`bg-[#f8fafc]`，工具名 + 成功/失败状态药丸标签
- 内容区：支持展开/收起，默认收起（保留现有 `toggleTool` 逻辑）
- 可展开后显示 JSON 预格式化内容

**系统消息**：`bg-white rounded-xl p-4`（现为 `bg-gray-100 rounded-full`）

**快捷回复**：`bg-white rounded-md px-3 py-1.5`，hover `bg-[#eef1f8]`

**输入区**
- 输入框：`bg-[#f7f8fc] rounded-lg`，`focus:ring-[#1a73e8]`
- 发送按钮：`bg-[#1a73e8] rounded-[10px]`

### 4.4 右栏 — AgentRightPanel

**会话信息卡**
- 背景：`bg-[#f7f8fc] rounded-xl p-3.5`（脱离 ADesign Card）
- 标题右侧 badge：`bg-[#eef1f8] text-[#1a73e8] rounded text-xs`
- 统计数字区（排队时长 / 消息数 / 会话时长）：小卡片 `bg-white rounded-md p-2.5`，三列等宽

**转接建议**（现为"转接原因"）
- 关闭按钮：圆形 `bg-[#fff2c7] text-[#923b0e]`
- 内容区：`bg-[#fff0eb] rounded-lg p-3`，左侧 💡 图标

**历史工单**
- 暂无时：空状态图标 + "暂无历史会话" + "查看全部会话 →" 链接按钮

### 4.5 右栏 — AISuggestPanel

- 整体容器：`bg-[#eef1f8] rounded-xl p-3.5`
- 标题：⚡ 图标 + "AI 回复建议" + 右侧刷新按钮
- 显示条数选择器：`2 / 3 / 4 / 5`，激活 `bg-[#1a73e8]`
- 建议卡片：`bg-white rounded-lg p-3`，点击即填入输入框
- 来源文档引用：`bg-[#f0f4ff] rounded-[5px] px-2 py-1.5`，文档名 + 页码
- 底部悬浮输入栏：`bg-white rounded-[10px] shadow-[0_-3px_12px_rgba(0,0,0,0.08)]`，输入框 + 发送按钮

---

## 5. 保留不变的内容

以下业务逻辑**零改动**：

- `useAgentWebSocket` — WS 连接管理
- `useSessionQueue` — 等待队列 + SSE 订阅
- `useReplySuggestions` — AI 回复建议防抖 + AbortController
- `useVisitorHistory` — 历史工单 + 流式 AI 总结
- `useSSEStream` / `useTransfer` — 其他 composable
- 所有 API 调用（`getActiveSessionsApi`、`closeSessionApi` 等）
- `historyItemToMsg`、`renderMarkdown`、`fetchMissingForSession` 等工具函数
- WS 重连逻辑、lastSeq 持久化
- 转交 Modal、结束会话确认 Modal、历史工单 Drawer（保留在 `index.vue`）

---

## 6. 不在本次范围内

- 修改后端接口
- 新增业务功能
- 修改 composable 内部逻辑
- 修改路由权限
- 暗色模式适配

---

## 7. 验收标准

1. 页面在 http://localhost:5670/customerservice/agent 正常加载，无控制台 error
2. 三栏布局与 vue-workbench 截图视觉一致
3. 所有现有功能正常：接入会话、发送消息、转交、结束、AI 建议、历史工单
4. WS/SSE 连接正常，断线重连功能可用
5. `vite build` 无类型错误
