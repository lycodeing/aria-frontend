# 座席工作台三栏可调宽 + 折叠功能设计文档

**日期：** 2026-08-02  
**状态：** 已批准，待实现  
**作者：** ZCode

---

## 背景

座席工作台（`/customerservice/agent`）采用三栏布局：左栏（会话队列）2:中栏（聊天区）6:右栏（会话信息）2，通过 Tailwind `flex-[2/6/2]` 固定比例。用户无法调整各栏宽度，在不同屏幕尺寸或不同工作习惯下体验受限。

目标：
1. 三栏均可通过拖拽分隔线自由调宽，宽度持久化到 localStorage。
2. 左栏可折叠（收起至 0）/ 展开，折叠状态持久化。
3. 右栏同样可折叠 / 展开，折叠状态持久化。
4. 左栏设置最小宽度约束（约 150px）。

---

## 技术方案

使用 monorepo 内已有的 `ResizablePanelGroup / ResizablePanel / ResizableHandle`（位于 `packages/@core/ui-kit/shadcn-ui/src/ui/resizable/`，基于 `reka-ui` 的 `SplitterGroup/SplitterPanel`），不引入新依赖。折叠状态通过 `@vueuse/core` 的 `useStorage` 持久化，项目已在多处使用该库。

---

## 组件设计

### 布局容器：`ResizablePanelGroup`

替换 `index.vue` 中当前三栏外层的 flex div：

```html
<!-- 旧 -->
<div class="flex min-h-0 flex-1 gap-3 overflow-hidden">

<!-- 新 -->
<ResizablePanelGroup
  direction="horizontal"
  auto-save-id="agent-workspace-layout"
  class="min-h-0 flex-1"
>
```

`auto-save-id` 由 `reka-ui` 原生支持，自动将各栏尺寸百分比序列化到 `localStorage['agent-workspace-layout']`，无需额外代码。

### 三个 `ResizablePanel` 配置

| 栏 | `default-size` | `min-size` | `max-size` | `collapsible` |
|---|---|---|---|---|
| 左（AgentLeftPanel） | 20 | 12 | 30 | `true` |
| 中（AgentChatArea） | 60 | 35 | — | `false` |
| 右（AgentRightPanel） | 20 | 12 | 30 | `true` |

- `min-size="12"` 对应视口 1280px 时约 154px，满足左栏最小可用宽度。
- 中栏不设 `max-size`，吸收两侧拖拽释放的空间。
- `collapsible` 开启后，`reka-ui` 会在拖拽到 `min-size` 以下时自动折叠至 0。

### 新组件：`AgentResizeHandle.vue`

路径：`apps/src/views/customerservice/agent/AgentResizeHandle.vue`

职责：封装 `ResizableHandle` 拖拽条 + 居中的折叠/展开 chevron 按钮，对外提供简洁接口。

**Props：**
```ts
defineProps<{
  direction: 'left' | 'right'  // 控制 chevron 方向语义
  collapsed: boolean            // 当前侧是否已折叠
}>()
```

**Emits：**
```ts
defineEmits<{ toggle: [] }>()
```

**视觉：**
- `ResizableHandle` 本体：4px 宽透明可交互区，hover 时显示 2px 蓝色竖线（`#1a73e8`）。
- chevron 按钮：绝对定位居中，16×16px 圆形白底 + 蓝色边框，图标为 `lucide:chevron-left` 或 `lucide:chevron-right`，根据 `direction` 和 `collapsed` 计算朝向。
- 按钮仅在 handle hover 或按钮 hover 时显示（`opacity-0 group-hover:opacity-100`），避免干扰正常浏览。

### `index.vue` 改动

1. 引入 `ResizablePanelGroup`、`ResizablePanel`、`AgentResizeHandle`。
2. 声明 panel refs：
   ```ts
   const leftPanelRef = ref<InstanceType<typeof ResizablePanel>>()
   const rightPanelRef = ref<InstanceType<typeof ResizablePanel>>()
   ```
3. 使用 `useStorage` 持久化折叠状态：
   ```ts
   const leftCollapsed = useStorage('agent-left-collapsed', false)
   const rightCollapsed = useStorage('agent-right-collapsed', false)
   ```
4. `onMounted` 时恢复折叠状态：
   ```ts
   onMounted(() => {
     if (leftCollapsed.value) leftPanelRef.value?.collapse()
     if (rightCollapsed.value) rightPanelRef.value?.collapse()
   })
   ```
5. 监听 `@collapse` / `@expand` 事件同步状态：
   ```ts
   // 左栏
   @collapse="leftCollapsed = true"
   @expand="leftCollapsed = false"
   // 右栏
   @collapse="rightCollapsed = true"
   @expand="rightCollapsed = false"
   ```
6. 原右栏 `v-if="activeSession || closedView"` 改为 `v-show`，通过 watcher 命令式控制折叠/展开：
   ```ts
   watch(
     () => !!(activeSession.value || closedView.value),
     (hasContent) => {
       if (!hasContent) rightPanelRef.value?.collapse()
       else if (rightCollapsed.value === false) rightPanelRef.value?.expand()
     },
   )
   ```
   这样在无活动会话时自动折叠右栏，有会话时按用户上次状态决定是否展开，不强行覆盖用户手动折叠的意图。

### `AgentLeftPanel.vue` / `AgentChatArea.vue` / `AgentRightPanel.vue`

**无需修改。** 各组件根元素保持 `h-full`，宽度由外层 `ResizablePanel` 约束，内部布局不感知容器宽度变化。

---

## 持久化策略

| 数据 | 存储 key | 来源 |
|---|---|---|
| 三栏宽度百分比 | `agent-workspace-layout` | `auto-save-id`（reka-ui 原生） |
| 左栏折叠状态 | `agent-left-collapsed` | `useStorage` |
| 右栏折叠状态 | `agent-right-collapsed` | `useStorage` |

---

## 边界情况

- **初次访问（无 localStorage 记录）**：使用 `default-size` 比例 20:60:20，左右均展开。
- **视口过窄（< 900px）**：`min-size="35"` 对中栏生效，两侧受挤时用户可手动折叠侧栏。
- **右栏无内容时**：watcher 自动折叠右栏，不影响左栏状态。
- **右栏有内容且用户已手动折叠**：`rightCollapsed` 为 `true`，watcher 中 `else if (rightCollapsed.value === false)` 条件不成立，不强行展开，尊重用户意图。

---

## 变更文件清单

| 文件 | 类型 |
|---|---|
| `apps/src/views/customerservice/agent/index.vue` | 修改 |
| `apps/src/views/customerservice/agent/AgentResizeHandle.vue` | 新建 |

其余文件（`AgentLeftPanel.vue`、`AgentChatArea.vue`、`AgentRightPanel.vue`）不变。
