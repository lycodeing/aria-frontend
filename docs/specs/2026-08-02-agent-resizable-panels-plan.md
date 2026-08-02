# 座席工作台三栏可调宽 + 折叠 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将座席工作台三栏布局改为可拖拽调宽、左右两栏可折叠/展开、状态持久化到 localStorage。

**Architecture:** 使用 monorepo 内已有的 `ResizablePanelGroup / ResizablePanel / ResizableHandle`（基于 `reka-ui`），新建一个 `AgentResizeHandle.vue` 封装拖拽条 + 折叠按钮；在 `index.vue` 中替换 flex 容器，用 `auto-save-id` 持久化宽度，用 `@vueuse/core` 的 `useStorage` 持久化折叠状态。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Tailwind CSS v4、reka-ui Splitter、@vueuse/core、@iconify/vue (lucide 图标)。

## Global Constraints

- 不引入任何新 npm 依赖。`@vben-core/shadcn-ui`、`@vueuse/core`、`@iconify/vue` 均已在 monorepo 中使用。
- Resizable 组件 import 路径：`@vben-core/shadcn-ui`（包名，见 `packages/@core/ui-kit/shadcn-ui/package.json` 的 `"name"` 字段）。
- `useStorage` 从 `@vueuse/core` 导入；`onMounted`、`ref`、`watch` 从 `vue` 导入。
- 视觉规范：主色 `#1a73e8`，灰色边框 `#e4e7ed`，文本灰 `#9ca3af`，与现有 AgentLeftPanel 一致。
- 提交信息 scope 用 `agent`（现有提交如 `fix(dit):` `feat(dit):` 风格）。
- `docs/plans` 和 `docs/superpowers` 被 `.gitignore` 忽略，本计划文件保存到 `docs/specs/`。

---

### Task 1: 新建 AgentResizeHandle 组件

**Files:**
- Create: `apps/src/views/customerservice/agent/AgentResizeHandle.vue`

**Interfaces:**
- Produces: `<AgentResizeHandle>` 组件，props `direction: 'left' | 'right'` + `collapsed: boolean`，emit `toggle: []`。内部使用 `ResizableHandle`（from `@vben-core/shadcn-ui`）。

- [ ] **Step 1: 创建组件文件**

创建 `apps/src/views/customerservice/agent/AgentResizeHandle.vue`，内容如下：

```vue
<script setup lang="ts">
import { ResizableHandle } from '@vben-core/shadcn-ui';

import { Icon } from '@iconify/vue';

const props = defineProps<{
  /** chevron 语义方向：left = 折叠后内容在左侧 */
  direction: 'left' | 'right';
  /** 当前侧是否已折叠 */
  collapsed: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

/**
 * 折叠态：箭头指向内容所在侧（提示"展开回来"）。
 * 展开态：箭头指向外侧（提示"收起这一侧"）。
 * 左侧栏：折叠显示 chevron-right(→)，展开显示 chevron-left(←)
 * 右侧栏：折叠显示 chevron-left(←)，展开显示 chevron-right(→)
 */
function iconName(): string {
  if (props.direction === 'left') {
    return props.collapsed ? 'lucide:chevron-right' : 'lucide:chevron-left';
  }
  return props.collapsed ? 'lucide:chevron-left' : 'lucide:chevron-right';
}
</script>

<template>
  <ResizableHandle
    class="group relative w-px !bg-[#e4e7ed] transition-colors hover:!bg-[#1a73e8]"
  >
    <!-- 拖拽热区：透明竖条，比视觉分隔线宽，便于抓取 -->
    <div
      class="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize"
    ></div>
    <!-- 折叠/展开按钮：hover handle 时显示 -->
    <button
      type="button"
      class="absolute left-1/2 top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#e4e7ed] bg-white text-[#52525b] opacity-0 shadow-sm transition-opacity hover:border-[#1a73e8] hover:text-[#1a73e8] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      :title="collapsed ? '展开' : '收起'"
      @click.prevent="emit('toggle')"
    >
      <Icon :icon="iconName()" class="text-[12px]" />
    </button>
  </ResizableHandle>
</template>
```

- [ ] **Step 2: 验证类型检查通过**

Run: `cd /Users/lycodeing/WebstormProjects/aria-frontend && pnpm run typecheck 2>&1 | tail -5`
Expected: 无新增类型错误（可能因尚未在 index.vue 引用而暂无检查对象，只要有 `@vben-core/shadcn-ui` 解析成功即可）。

- [ ] **Step 3: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/customerservice/agent/AgentResizeHandle.vue
git commit -m "feat(agent): add AgentResizeHandle component for collapsible panels"
```

---

### Task 2: 改造 index.vue 三栏布局为 ResizablePanelGroup

**Files:**
- Modify: `apps/src/views/customerservice/agent/index.vue`（script setup 段导入 + 三栏 template 段）
- Test: 手动在浏览器 http://localhost:5670/customerservice/agent 验证拖拽和折叠

**Interfaces:**
- Consumes: `AgentResizeHandle`（Task 1 产物），`ResizablePanelGroup` / `ResizablePanel`（from `@vben-core/shadcn-ui`），`useStorage`（from `@vueuse/core`）。
- Produces: 三栏可拖拽 + 可折叠布局；`leftPanelRef` / `rightPanelRef` 为 `InstanceType<typeof ResizablePanel>`，暴露 `collapse()` / `expand()`。

- [ ] **Step 1: 在 `<script setup>` 顶部添加导入**

在 `apps/src/views/customerservice/agent/index.vue` 的 `<script lang="ts" setup>` 块中，找到现有组件导入区（约第 47-49 行）：

```ts
import AgentChatArea from './AgentChatArea.vue';
import AgentLeftPanel from './AgentLeftPanel.vue';
import AgentRightPanel from './AgentRightPanel.vue';
```

在其**上方**（`#/` 导入之后、`./AgentXxx` 之前）添加：

```ts
import { ResizablePanel, ResizablePanelGroup } from '@vben-core/shadcn-ui';

import { useStorage } from '@vueuse/core';

import AgentResizeHandle from './AgentResizeHandle.vue';
```

并在 `import AgentChatArea ...` 之后保留原有三行不变。

- [ ] **Step 2: 添加 panel refs 和折叠状态**

在 `<script setup>` 中找到 `// ===== 转交 Modal =====`（约第 569 行）上方，添加：

```ts
// ===== 三栏可调宽 + 折叠 =====
const leftPanelRef = ref<InstanceType<typeof ResizablePanel>>();
const rightPanelRef = ref<InstanceType<typeof ResizablePanel>>();
const leftCollapsed = useStorage('agent-left-collapsed', false);
const rightCollapsed = useStorage('agent-right-collapsed', false);
```

- [ ] **Step 3: 在 onMounted 末尾恢复折叠状态**

找到 `onMounted(async () => {` 块（约第 759 行），在其函数体**最末尾**（`activeSessions.forEach(...)` 那行之后、`});` 之前）添加：

```ts
  // 恢复左右栏折叠状态（需等 panel 挂载后调用命令式 API）
  await nextTick();
  if (leftCollapsed.value) leftPanelRef.value?.collapse();
  if (rightCollapsed.value) rightPanelRef.value?.collapse();
```

同时在顶部 vue 导入中补充 `nextTick`（当前第 14 行 `import { computed, onMounted, onUnmounted, ref, watch } from 'vue';`）改为：

```ts
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
```

- [ ] **Step 4: 添加右栏内容存在性 watcher**

找到现有 `watch(activeSession, ...)` 块（约第 534 行），在其**之后**添加新 watcher：

```ts
// 右栏内容存在性驱动折叠：无内容自动收起，有内容尊重用户上次折叠状态
watch(
  () => !!(activeSession.value || closedView.value),
  (hasContent) => {
    if (!hasContent) {
      rightPanelRef.value?.collapse();
    } else if (rightCollapsed.value === false) {
      rightPanelRef.value?.expand();
    }
  },
);
```

- [ ] **Step 5: 替换三栏 template 容器**

找到（约第 849 行）：

```html
      <div class="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <!-- 左栏 2/10 -->
        <AgentLeftPanel
          class="flex-[2] min-w-0"
          :agent-online="agentOnline"
```

将整段三栏（从 `<div class="flex min-h-0 flex-1 gap-3 overflow-hidden">` 到对应 `</div>` 结束，即左栏 + 中栏 + 右栏的完整包裹）替换为：

```html
      <ResizablePanelGroup
        direction="horizontal"
        auto-save-id="agent-workspace-layout"
        class="min-h-0 flex-1"
      >
        <!-- 左栏：会话队列 -->
        <ResizablePanel
          ref="leftPanelRef"
          :default-size="20"
          :min-size="12"
          :max-size="30"
          collapsible
          @collapse="leftCollapsed = true"
          @expand="leftCollapsed = false"
        >
          <AgentLeftPanel
            :agent-online="agentOnline"
            :concurrent="concurrent"
            :max-concurrent="MAX_CONCURRENT"
            :sse-connected="sseConnected"
            :queue-state-tab="queueStateTab"
            :ai-queue="aiQueue"
            :waiting-queue="waitingQueue"
            :queue-page="queuePage"
            :queue-total-pages="queueTotalPages"
            :queue-search="queueSearch"
            :visible-paged-waiting-queue="visiblePagedWaitingQueue"
            :visible-sessions="visibleSessions"
            :sessions="sessions"
            :closed-sessions="closedSessions"
            :closed-view="closedView"
            :visitor-typing-map="visitorTypingMap"
            @toggle-online="agentOnline = $event"
            @update:queue-state-tab="queueStateTab = $event"
            @update:queue-page="queuePage = $event"
            @update:queue-search="queueSearch = $event"
            @accept-queue="acceptQueue"
            @switch-session="switchSession"
            @view-closed="viewClosedSession"
            @view-ai-session="viewAiSession"
            @reconnect-queue="reconnectQueue"
          />
        </ResizablePanel>

        <AgentResizeHandle
          direction="left"
          :collapsed="leftCollapsed"
          @toggle="
            leftCollapsed
              ? leftPanelRef?.expand()
              : leftPanelRef?.collapse()
          "
        />

        <!-- 中栏：聊天区 -->
        <ResizablePanel :default-size="60" :min-size="35">
          <AgentChatArea
            :active-session="activeSession"
            :closed-view="closedView"
            :closed-view-loading="closedViewLoading"
            :msg-filter="msgFilter"
            :filtered-msgs="filteredMsgs"
            :msg-input="msgInput"
            :active-ws-status="activeWsStatus"
            :ws-status-meta="wsStatusMeta"
            :tool-expanded="toolExpanded"
            :queue="waitingQueue"
            :max-concurrent="MAX_CONCURRENT"
            :concurrent="concurrent"
            :visitor-typing="
              activeSession
                ? (visitorTypingMap[activeSession.id] ?? false)
                : false
            "
            @update:msg-input="msgInput = $event"
            @update:msg-filter="msgFilter = $event"
            @send="sendAgent"
            @toggle-tool="toggleTool"
            @transfer="transferVisible = true"
            @close-session="requestCloseSession"
            @reconnect-session="reconnectActiveSession"
            @exit-closed="closedView = null"
            @takeover-ai="takeoverAiSession"
            @copy-msg="copyMsgText"
          />
        </ResizablePanel>

        <AgentResizeHandle
          direction="right"
          :collapsed="rightCollapsed"
          @toggle="
            rightCollapsed
              ? rightPanelRef?.expand()
              : rightPanelRef?.collapse()
          "
        />

        <!-- 右栏：会话信息 -->
        <ResizablePanel
          ref="rightPanelRef"
          :default-size="20"
          :min-size="12"
          :max-size="30"
          collapsible
          @collapse="rightCollapsed = true"
          @expand="rightCollapsed = false"
        >
          <AgentRightPanel
            v-show="activeSession || closedView"
            :active-session="activeSession"
            :closed-view="closedView"
            :visitor-history-list="visitorHistoryList"
            :visitor-history-loading="visitorHistoryLoading"
            :reply-suggestions="replySuggestions"
            :suggestions-loading="suggestionsLoading"
            :suggestions-error="suggestionsError"
            :summary-map="summaryMap"
            @open-history-drawer="
              activeSession &&
              openHistoryDrawer(activeSession.name, activeSession.id)
            "
            @apply-suggestion="applySuggestion"
            @insert-suggestion="insertSuggestion"
            @regenerate-summary="regenerateSummary"
          />
        </ResizablePanel>
      </ResizablePanelGroup>
```

**注意：** 上面只列出了三栏本身的替换。原 `</div>` 之后紧接的 `<Drawer>` 历史抽屉等外部结构保持不变。如果原 `<div class="flex min-h-0 flex-1 gap-3 overflow-hidden">` 内除了三栏还有其它子元素，保留它们在三栏之后。实际替换时，先读取第 849-940 行确认右栏 `<AgentRightPanel ... />` 的 props/emits 与上面一致，以避免遗漏新增的 prop（如 `@regenerate-summary` 等）。

- [ ] **Step 6: 运行 typecheck**

Run: `cd /Users/lycodeing/WebstormProjects/aria-frontend && pnpm run typecheck 2>&1 | tail -20`
Expected: PASS（无类型错误）。若有 "Property 'collapse' does not exist" 类报错，确认 `leftPanelRef` 类型为 `InstanceType<typeof ResizablePanel>` 且 `ResizablePanel` 已 `defineExpose` 了 `collapse/expand`（已确认源码有）。

- [ ] **Step 7: 浏览器手动验证**

1. 打开 http://localhost:5670/customerservice/agent
2. 验证：拖动左/中分隔线，左栏宽度变化，中栏吸收空间
3. 验证：拖动右/中分隔线，右栏宽度变化
4. 验证：点击左分隔线上的圆形按钮，左栏收起至 0，按钮变为 `>`
5. 验证：再次点击，左栏展开回原宽度
6. 验证：右栏同理
7. 验证：刷新页面，宽度和折叠状态被记住
8. 验证：无活动会话时右栏自动折叠；选中会话后右栏按上次状态展开

- [ ] **Step 8: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/customerservice/agent/index.vue
git commit -m "feat(agent): make three-column layout resizable and collapsible with persistence"
```

---

### Task 3: 调整 AgentLeftPanel aside 根元素适配外层 ResizablePanel

**Files:**
- Modify: `apps/src/views/customerservice/agent/AgentLeftPanel.vue`（第 93 行 aside 根元素）

**说明：** 原 `<aside class="flex h-full flex-col gap-3 bg-[#eef1f8] p-4">` 在 flex 容器中工作正常。移入 `ResizablePanel` 后，panel 本身已是 flex 子项并撑满高度，aside 需确保 `w-full h-full` 填满 panel，避免出现 panel 有宽度但 aside 未撑开导致白边。

- [ ] **Step 1: 调整 aside 根元素 class**

打开 `apps/src/views/customerservice/agent/AgentLeftPanel.vue`，第 93 行：

```html
  <aside class="flex h-full flex-col gap-3 bg-[#eef1f8] p-4">
```

改为：

```html
  <aside class="flex h-full w-full flex-col gap-3 bg-[#eef1f8] p-4">
```

仅添加 `w-full`。

- [ ] **Step 2: 同样检查 AgentRightPanel 根元素**

打开 `apps/src/views/customerservice/agent/AgentRightPanel.vue`，第 244-247 行的 `<aside>`：

```html
  <aside
    class="relative flex h-full flex-col gap-3.5 overflow-hidden bg-white"
    style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
  >
```

确认已有 `h-full`；若没有 `w-full` 则添加。改为：

```html
  <aside
    class="relative flex h-full w-full flex-col gap-3.5 overflow-hidden bg-white"
    style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
  >
```

- [ ] **Step 3: 检查 AgentChatArea 根元素**

打开 `apps/src/views/customerservice/agent/AgentChatArea.vue`，第 268 行的 `<main>`，确认根元素有 `h-full w-full`。若无 `w-full` 则添加（不破坏现有布局）。

- [ ] **Step 4: typecheck + 浏览器复验**

Run: `cd /Users/lycodeing/WebstormProjects/aria-frontend && pnpm run typecheck 2>&1 | tail -5`
Expected: PASS

浏览器刷新后确认：左栏内容铺满 panel 宽度，无白边；中栏和右栏同理。

- [ ] **Step 5: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/aria-frontend
git add apps/src/views/customerservice/agent/AgentLeftPanel.vue apps/src/views/customerservice/agent/AgentRightPanel.vue apps/src/views/customerservice/agent/AgentChatArea.vue
git commit -m "fix(agent): ensure panel root elements fill ResizablePanel width"
```

---

## Self-Review 结果

**1. Spec coverage:**
- 三栏均可拖拽调宽 → Task 2 Step 5（ResizablePanelGroup + 两条 AgentResizeHandle）✓
- 宽度持久化 → Task 2 Step 5（`auto-save-id="agent-workspace-layout"`）✓
- 左栏可折叠/展开，状态持久化 → Task 2 Step 2/3/5（`leftCollapsed` useStorage + collapse/expand 事件 + onMounted 恢复）✓
- 右栏可折叠/展开，状态持久化 → Task 2 同上（`rightCollapsed`）✓
- 左栏最小宽度约束 → Task 2 Step 5（`:min-size="12"` ≈ 154px@1280）✓
- 左栏完全收起，边缘留触发条 → Task 1（AgentResizeHandle 折叠按钮）✓
- 右栏无内容自动折叠 → Task 2 Step 4（watcher）✓

**2. Placeholder scan:** 无 TBD/TODO，所有代码块完整 ✓

**3. Type consistency:**
- `leftPanelRef` / `rightPanelRef` 类型在 Task 2 Step 2 定义为 `InstanceType<typeof ResizablePanel>`，与 Task 1 中 ResizablePanel 的 `defineExpose({ collapse, expand, getSize, resize })` 一致 ✓
- `AgentResizeHandle` props `direction: 'left' | 'right'`、`collapsed: boolean`、emit `toggle` 在 Task 1 定义，Task 2 使用一致 ✓
- `useStorage` 返回 `RemovableRef<boolean>`，赋值 `true`/`false` 类型正确 ✓
