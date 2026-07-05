# Chat Widget SSE 事件增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 chat-widget 消费后端新增的 4 种 SSE 语义事件（tool_call/tool_done/slot_ask/candidates），并支持通过 URL query 参数传入 domainCode。

**Architecture:** 改造 chat-widget/index.vue，扩展 SSE 解析逻辑，新增 Msg 子类型枚举。domainCode 从 useRoute().query.domain 读取并注入每次 fetch 请求。

**Tech Stack:** Vue 3 Composition API, TypeScript, Ant Design Vue, fetch + ReadableStream SSE

---

## Task 1: 扩展 Msg 类型 + domainCode + SSE 解析

**Files:**
- Modify: `apps/src/views/chat-widget/index.vue`

- [ ] **Step 1: 在 script 顶部 import useRoute，扩展 Msg 接口**

在 `import { nextTick, onMounted, onUnmounted, ref, watch }` 这行后面追加：

```typescript
import { computed } from 'vue';
import { useRoute } from 'vue-router';
```

在 `const sessionId = ref('');` 之前加：

```typescript
const route = useRoute();
const domainCode = computed(() => (route.query.domain as string) || '');
const slotInputText = ref('');
function submitSlotInput() {
  if (!slotInputText.value.trim()) return;
  const text = slotInputText.value.trim();
  slotInputText.value = '';
  replyFor(text);
}
```

将现有 `interface Msg` 替换为：

```typescript
interface Msg {
  id: number;
  role: 'agent' | 'ai' | 'user';
  text: string;
  time?: string;
  sources?: string[];
  feedback?: 'down' | 'up' | null;
  failed?: boolean;
  retryText?: string;
  sending?: boolean;
  subType?: 'tool_call' | 'tool_done' | 'slot_ask' | 'candidates' | 'normal';
  toolName?: string;
  toolDurationMs?: number;
  candidates?: Array<{ id: string; label: string }>;
}
```

- [ ] **Step 2: fetch 请求体加入 domainCode**

找到 `body: JSON.stringify({ sessionId: sessionId.value, message: text })` 替换为：

```typescript
body: JSON.stringify({
  sessionId: sessionId.value,
  message: text,
  ...(domainCode.value ? { domainCode: domainCode.value } : {}),
}),
```

- [ ] **Step 3: 在 SSE 解析循环里追加新事件处理**

找到处理 `event:sources` 的 `else if (eventType === 'sources')` 块后追加：

```typescript
else if (eventType === 'tool_call') {
  try {
    const payload = JSON.parse(dataLine);
    const idx = msgs.value.findIndex(m => m.subType === 'tool_call' && m.toolName === payload.tool);
    const toolMsg: Msg = { id: msgId++, role: 'ai', text: `正在查询 ${payload.tool}...`,
      subType: 'tool_call', toolName: payload.tool, time: nowTime() };
    if (idx >= 0) msgs.value[idx] = toolMsg; else msgs.value.push(toolMsg);
  } catch { /* ignore */ }
} else if (eventType === 'tool_done') {
  try {
    const payload = JSON.parse(dataLine);
    const idx = msgs.value.findIndex(m => m.subType === 'tool_call' && m.toolName === payload.tool);
    if (idx >= 0) msgs.value[idx] = { ...msgs.value[idx],
      subType: 'tool_done', text: `✅ ${payload.tool} 查询完成（${payload.duration_ms}ms）`,
      toolDurationMs: payload.duration_ms };
  } catch { /* ignore */ }
} else if (eventType === 'slot_ask') {
  msgs.value.push({ id: msgId++, role: 'ai', text: dataLine, subType: 'slot_ask', time: nowTime() });
  await nextTick(); scrollToBottom();
} else if (eventType === 'candidates') {
  try {
    const list = JSON.parse(dataLine);
    msgs.value.push({ id: msgId++, role: 'ai', text: '请选择：', subType: 'candidates',
      candidates: Array.isArray(list) ? list : [], time: nowTime() });
    await nextTick(); scrollToBottom();
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: 提交脚本逻辑**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
git add apps/src/views/chat-widget/index.vue
git commit -m "feat(chat-widget): 扩展 SSE 解析支持 tool_call/tool_done/slot_ask/candidates + domainCode"
```

---

## Task 2: Template 新增气泡渲染 + 样式

**Files:**
- Modify: `apps/src/views/chat-widget/index.vue` (template + style)

- [ ] **Step 1: 在 AI 消息气泡的 template 中，原有文本渲染前按 subType 分支**

找到渲染 AI 消息内容的地方（通常是 `v-html="marked(msg.text)"` 附近），包裹成：

```html
<!-- 工具调用中 -->
<template v-if="msg.subType === 'tool_call'">
  <div class="tool-bubble tool-running">🔄 {{ msg.text }}</div>
</template>

<!-- 工具完成 -->
<template v-else-if="msg.subType === 'tool_done'">
  <div class="tool-bubble tool-done">{{ msg.text }}</div>
</template>

<!-- 槽位询问 -->
<template v-else-if="msg.subType === 'slot_ask'">
  <div class="slot-ask-bubble">
    <p>{{ msg.text }}</p>
    <div class="slot-input-row">
      <a-input v-model:value="slotInputText" placeholder="请输入..."
        size="small" style="flex:1" @press-enter="submitSlotInput" />
      <a-button type="primary" size="small" @click="submitSlotInput">确认</a-button>
    </div>
  </div>
</template>

<!-- 候选项 -->
<template v-else-if="msg.subType === 'candidates'">
  <div class="candidates-bubble">
    <p>{{ msg.text }}</p>
    <div class="candidates-list">
      <div v-for="c in msg.candidates" :key="c.id"
           class="candidate-item" @click="replyFor(c.label)">
        {{ c.label }}
      </div>
    </div>
  </div>
</template>

<!-- 普通文本（原有 marked 渲染） -->
<template v-else>
  <!-- 原有内容保持不变 -->
</template>
```

- [ ] **Step 2: 在 style 区域追加气泡样式**

```css
.tool-bubble {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 8px; font-size: 13px;
}
.tool-bubble.tool-running { background: #fff7e6; color: #d46b08; }
.tool-bubble.tool-done    { background: #f6ffed; color: #389e0d; }

.slot-ask-bubble {
  background: #e6f7ff; border: 1px solid #91d5ff;
  border-radius: 8px; padding: 10px 12px;
}
.slot-input-row { display: flex; gap: 8px; margin-top: 8px; }

.candidates-bubble {
  background: #f0f5ff; border: 1px solid #adc6ff;
  border-radius: 8px; padding: 10px 12px;
}
.candidates-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.candidate-item {
  padding: 6px 12px; background: #fff; border: 1px solid #d9d9d9;
  border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.15s;
}
.candidate-item:hover { border-color: #1677ff; color: #1677ff; background: #e6f7ff; }
```

- [ ] **Step 3: 本地验证**

访问 `http://localhost:5671/chat?domain=ecommerce`，确认页面正常加载，无 TypeScript 报错。

- [ ] **Step 4: 提交**

```bash
git add apps/src/views/chat-widget/index.vue
git commit -m "feat(chat-widget): 新增 tool/slot/candidates 气泡 UI"
```

---

## 验收标准

- [ ] URL 带 `?domain=ecommerce` 时，请求体包含 `domainCode`
- [ ] `event:tool_call` → 橙色"正在查询..."气泡
- [ ] `event:tool_done` → 绿色"查询完成（Nms）"
- [ ] `event:slot_ask` → 蓝色卡片 + 输入框，回车/点击确认发送
- [ ] `event:candidates` → 候选列表，点击直接发送选中项
