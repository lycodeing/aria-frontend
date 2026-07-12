# 座席工作台重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `agent/index.vue`（2100行单文件）拆分为5个子组件，同步应用 vue-workbench 设计语言（主色 #1a73e8，背景 #eef1f8），保留所有业务逻辑零改动。

**Architecture:** index.vue 保留所有 composable 调用、API 调用和 Modal/Drawer；通过 props/emits 向4个子组件传递状态。子组件纯负责展示和事件上报，不引入任何新依赖。

**Tech Stack:** Vue 3 + TypeScript + Ant Design Vue 4 + Tailwind CSS + @iconify/vue

## Global Constraints

- 主色统一改为 `#1a73e8`，移除所有 `indigo-500`/`#4f46e5` 颜色引用
- 左栏宽度 `w-[240px]`，右栏宽度 `w-[300px]`
- 左栏背景 `#eef1f8`，页面背景 `#f7f8fc`
- 所有 composable、API 函数、工具函数**不修改**，只搬迁位置
- 保持 `ant-design-vue` 的 Modal / Drawer / Spin / Skeleton / Collapse 用于复杂交互
- Tailwind 行内 class 优先，不新增 CSS 文件
- 构建命令：`pnpm --filter @vben/web-antd build`（或 dev server 验证）

---

### Task 1: 创建共享类型文件 agent/types.ts

**Files:**
- Create: `apps/src/views/customerservice/agent/types.ts`

- [ ] 创建类型文件，导出所有子组件共享的接口

```typescript
// apps/src/views/customerservice/agent/types.ts
import type { ChatToolCall } from '#/api/session'

export interface Msg {
  id: number
  role: 'agent' | 'ai' | 'system' | 'tool' | 'user'
  text: string
  time?: string
  toolName?: string
  toolRequestId?: string
  toolCalls?: ChatToolCall[]
}

export interface SessionData {
  id: string
  name: string
  nameChar: string
  color: string
  min: string
  active: boolean
  sessionCode: string
  transferReason: string
  tag: string
  waitSince: number
  msgs: Msg[]
}

export interface ClosedSessionItem {
  id: string
  name: string
  nameChar: string
  endedAt: string
  transferReason: string
  tag: string
}

export interface ClosedView {
  msgs: Msg[]
  session: ClosedSessionItem
}
```

- [ ] 验证文件创建成功

---

### Task 2: 创建 AISuggestPanel.vue

**Files:**
- Create: `apps/src/views/customerservice/agent/AISuggestPanel.vue`

**Interfaces:**
- Consumes: `ReplySuggestion`（来自 `useReplySuggestions` composable 的类型）
- Produces: `apply` emit (content: string)，`refresh` emit ()

- [ ] 创建 AISuggestPanel 组件（纯展示，无业务逻辑）

完整代码见实施时生成。关键设计点：
- 容器：`bg-[#eef1f8] rounded-xl p-3.5 flex flex-col gap-1.5`
- 标题行：⚡图标 + "AI 回复建议" + 刷新按钮
- 条数选择器：2/3/4/5，激活态 `bg-[#1a73e8] text-white`
- 建议卡片：`bg-white rounded-lg p-3`，来源文档 `bg-[#f0f4ff]`
- 底部悬浮输入栏：`bg-white rounded-[10px] shadow`

- [ ] 验证组件语法正确

---

### Task 3: 创建 AgentLeftPanel.vue

**Files:**
- Create: `apps/src/views/customerservice/agent/AgentLeftPanel.vue`

**Interfaces:**
- Consumes: `SessionData`, `ClosedSessionItem`, `ClosedView`, `QueueItem` 类型
- Produces: emits `accept-queue`, `switch-session`, `view-closed`, `reconnect-queue`, `update:*`

关键设计点：
- 外层：`h-full flex flex-col bg-[#eef1f8] rounded-xl p-3`
- 座席状态卡：`bg-white rounded-xl p-3.5`，Progress `strokeColor="#1a73e8"`
- Tab：纯 Tailwind segmented，激活 `bg-[#1a73e8] text-white rounded-md`
- 等待列表项：`bg-white rounded-xl p-2.5`，无 amber 边框
- 接待中列表项激活：`bg-[#f5fafe]`，状态点绿色 `#10b981`

---

### Task 4: 创建 AgentChatArea.vue

**Files:**
- Create: `apps/src/views/customerservice/agent/AgentChatArea.vue`

**Interfaces:**
- Consumes: `SessionData`, `ClosedView`, `Msg` 类型
- Produces: emits `send`, `quick-reply`, `toggle-tool`, `transfer`, `close-session`, `copy-msg`, `update:msgInput`, `update:msgFilter`, `reconnect-session`

关键设计点：
- header：`h-16 bg-white px-5`，访客头像 `bg-[#e8f0ff] text-[#1a73e8]`
- 筛选 Tag：`rounded-[13px]`，激活 `bg-[#1a73e8] text-white`
- 转交按钮：`border border-[#e4e7ed]`，结束：`bg-[#1a73e8]`
- 消息背景：`bg-[#f7f8fc]`
- 用户气泡：`bg-white rounded-xl rounded-tl-none`
- AI 气泡：`bg-white rounded-xl rounded-tr-none`
- 座席气泡：`bg-[#1a73e8] text-white rounded-xl rounded-tr-none`
- 工具卡头部：`bg-[#f8fafc]`，成功药丸 `bg-[#e8f0ff] text-[#1a73e8]`
- 快捷回复：`bg-white rounded-md hover:bg-[#eef1f8]`
- 输入框：`bg-[#f7f8fc] rounded-lg focus:ring-[#1a73e8]`
- 发送按钮：`bg-[#1a73e8] rounded-[10px]`
- 系统消息：居中 `bg-[#f7f8fc] rounded-full px-3 py-1 text-xs`
- 空状态保留现有逻辑（等待接入的统计卡片 + 实时监听动效）

---

### Task 5: 创建 AgentRightPanel.vue

**Files:**
- Create: `apps/src/views/customerservice/agent/AgentRightPanel.vue`

**Interfaces:**
- Consumes: `SessionData`, `VisitorHistoryItem` 类型，`AISuggestPanel` 组件
- Produces: emits `open-history-drawer`, `apply-suggestion`, `refresh-suggestions`

关键设计点：
- 外层：`h-full flex flex-col gap-3.5 bg-white p-4 overflow-y-auto`
- 会话信息：`bg-[#f7f8fc] rounded-xl p-3.5`，badge `bg-[#eef1f8] text-[#1a73e8]`
- 三个统计数字：`bg-white rounded-md p-2.5` 三等分
- 转接建议：`bg-[#fff0eb] rounded-lg p-3`，💡图标，关闭按钮 `bg-[#fff2c7]`
- 历史工单：空状态 + 查看全部链接按钮
- AISuggestPanel 占据剩余空间 `min-h-0 flex-1`

---

### Task 6: 重构 index.vue

**Files:**
- Modify: `apps/src/views/customerservice/agent/index.vue`

- [ ] 在 `<script setup>` 顶部：从 `./types` 导入类型替换内联定义
- [ ] 导入4个子组件
- [ ] 删除 template 中左/中/右三栏的全部 HTML（约1200行）
- [ ] 替换为子组件标签，绑定所有 props 和 emits
- [ ] 保留：Modal（转交）、Modal（结束确认）、Drawer（历史工单）、Alert（SSE 断线）
- [ ] 保留：所有 `<style scoped>` 中的 `.agent-ai-md` 规则
- [ ] `Page` 组件标题：`title="座席工作台"` 保持不变

---

### Task 7: 构建验证

- [ ] 运行 TypeScript 类型检查
  ```bash
  cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
  pnpm --filter @vben/web-antd typecheck 2>&1 | tail -30
  ```
- [ ] 若有类型错误逐一修复
- [ ] 启动开发服务器确认页面正常渲染
  ```bash
  pnpm --filter @vben/web-antd dev
  ```
- [ ] 浏览器访问 http://localhost:5670/customerservice/agent 验证三栏布局

---

## 验收标准

1. 页面三栏布局与截图视觉一致（主色蓝 #1a73e8，左栏 #eef1f8 背景）
2. TypeScript 构建无 error（警告可接受）
3. 会话接入、发送消息、转交、结束、AI 建议点击填入输入框功能正常
4. WS/SSE 连接状态指示灯正常显示
