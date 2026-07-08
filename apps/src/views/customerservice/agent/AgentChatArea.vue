<script setup lang="ts">
import type { ClosedView, Msg, SessionData } from './types';

import { ref } from 'vue';

import { Icon } from '@iconify/vue';
import { Button, Spin } from 'ant-design-vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const props = defineProps<{
  activeSession: SessionData | undefined;
  activeWsStatus: 'closed' | 'connecting' | 'error' | 'open';
  closedView: ClosedView | null;
  closedViewLoading: boolean;
  concurrent: number;
  filteredMsgs: Msg[];
  maxConcurrent: number;
  msgFilter: string;
  msgInput: string;
  queue: { length: number };
  quickReplies: string[];
  toolExpanded: Record<number, boolean>;
  /** 访客输入中状态，true 时在消息列表底部显示"正在输入"动画 */
  visitorTyping?: boolean;
  wsStatusMeta: { color: string; text: string };
}>();

const emit = defineEmits<{
  closeSession: [];
  copyMsg: [text: string];
  quickReply: [q: string];
  reconnectSession: [];
  send: [];
  toggleTool: [id: number];
  transfer: [];
  'update:msgFilter': [val: string];
  'update:msgInput': [val: string];
}>();

const MSG_FILTER_OPTIONS = [
  { key: '全部', label: '全部' },
  { key: 'ai', label: 'AI 对话' },
  { key: 'agent', label: '人工回复' },
];

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(String(marked.parse(text)));
}

/** 检测是否是后端序列化的 SystemMessage { text = "..." } 格式 */
function isSystemPrompt(text: string): boolean {
  return text.trimStart().startsWith('SystemMessage {');
}

/** 提取 SystemMessage { text = "..." } 里的实际内容 */
function extractSystemPrompt(text: string): string {
  const match = text.match(/SystemMessage\s*\{\s*text\s*=\s*"([\s\S]*?)"\s*\}/);
  return match?.[1] ?? text;
}

function prettyToolPayload(raw: string): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function handleEnter(e: KeyboardEvent) {
  if (!e.shiftKey) {
    e.preventDefault();
    emit('send');
  }
}

// closedView 独立的工具展开状态（与活跃会话 toolExpanded 完全隔离）
const closedToolExpanded = ref<Record<number, boolean>>({});
function toggleClosedTool(id: number) {
  closedToolExpanded.value[id] = !closedToolExpanded.value[id];
}
</script>

<template>
  <!-- Active session chat -->
  <main
    v-if="activeSession"
    class="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f7f8fc]"
  >
    <!-- Header -->
    <header
      class="flex h-16 shrink-0 items-center justify-between bg-white px-5"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#e8f0ff] text-[15px] font-medium text-[#1a73e8]"
        >
          {{ activeSession.nameChar }}
        </div>
        <div class="leading-tight">
          <div class="text-[14px] font-medium text-[#0a0a0b]">
            {{ activeSession.name }}
          </div>
          <div class="text-[12px] text-[#9ca3af]">
            会话 {{ activeSession.sessionCode }} · {{ activeSession.min }}
          </div>
        </div>
      </div>

      <!-- Message filter tags -->
      <div class="flex items-center gap-1">
        <button
          v-for="opt in MSG_FILTER_OPTIONS"
          :key="opt.key"
          class="rounded-[13px] px-3 py-1.5 text-[13px] transition-colors"
          :class="
            msgFilter === opt.key
              ? 'bg-[#1a73e8] text-white'
              : 'bg-[#f7f8fc] text-[#52525b] hover:bg-[#eef1f8]'
          "
          @click="emit('update:msgFilter', opt.key)"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        <span class="flex items-center gap-1.5 text-[13px] text-[#52525b]">
          <span
            class="h-2 w-2 rounded-full transition-colors"
            :style="{ background: wsStatusMeta.color }"
          ></span>
          {{ wsStatusMeta.text }}
        </span>
        <Button
          size="small"
          class="flex items-center gap-1 !border-[#e4e7ed]"
          @click="emit('transfer')"
        >
          <template #icon><Icon icon="ant-design:swap-outlined" /></template>
          转交
        </Button>
        <Button
          type="primary"
          size="small"
          class="!bg-[#1a73e8] !border-[#1a73e8]"
          @click="emit('closeSession')"
        >
          <template #icon
            ><Icon icon="ant-design:poweroff-outlined"
          /></template>
          结束会话
        </Button>
      </div>
    </header>

    <!-- WS disconnect banner -->
    <div
      v-if="activeWsStatus !== 'open'"
      class="mx-3 mt-2 shrink-0 flex items-center gap-2.5 rounded-lg px-3.5 py-2.5"
      :class="activeWsStatus === 'connecting' ? 'bg-[#fff7e6]' : 'bg-[#fff1f0]'"
    >
      <!-- 旋转动画 icon -->
      <Icon
        :icon="
          activeWsStatus === 'connecting'
            ? 'lucide:loader-2'
            : 'lucide:wifi-off'
        "
        class="shrink-0 text-[15px]"
        :class="[
          activeWsStatus === 'connecting'
            ? 'animate-spin text-[#d46b08]'
            : 'text-[#cf1322]',
        ]"
      />
      <span
        class="flex-1 text-[12px]"
        :class="
          activeWsStatus === 'connecting' ? 'text-[#d46b08]' : 'text-[#cf1322]'
        "
      >
        {{
          activeWsStatus === 'connecting'
            ? '正在自动重连，消息可能短暂延迟…'
            : '会话连接已断开，自动重连已停止'
        }}
      </span>
      <!-- connecting 时显示脉冲点，closed 时显示手动重连按钮 -->
      <div
        v-if="activeWsStatus === 'connecting'"
        class="flex items-center gap-1"
      >
        <span class="relative flex h-2 w-2">
          <span
            class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d46b08] opacity-60"
          ></span>
          <span
            class="relative inline-flex h-2 w-2 rounded-full bg-[#d46b08]"
          ></span>
        </span>
      </div>
      <Button
        v-else
        size="small"
        class="!border-[#cf1322] !text-[#cf1322] hover:!bg-[#fff1f0]"
        @click="emit('reconnectSession')"
      >
        立即重连
      </Button>
    </div>

    <!-- Message list -->
    <div
      class="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4"
      style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
    >
      <!-- Round count -->
      <div class="flex justify-center">
        <span
          class="rounded-full bg-[#eef1f8] px-3 py-1 text-[11px] text-[#9ca3af]"
        >
          共
          {{ activeSession.msgs.filter((m) => m.role !== 'agent').length }}
          轮对话
        </span>
      </div>

      <template v-for="m in filteredMsgs" :key="m.id">
        <!-- System message: centered pill -->
        <div v-if="m.role === 'system'" class="flex justify-center">
          <div class="rounded-xl bg-white px-4 py-3">
            <div class="flex items-center gap-2">
              <Icon icon="lucide:info" class="shrink-0 text-[#1a73e8]" />
              <span class="text-[13px] text-[#52525b]">{{ m.text }}</span>
            </div>
          </div>
        </div>

        <!-- Tool call card -->
        <div v-else-if="m.role === 'tool'" class="flex justify-center">
          <div
            class="w-full max-w-[min(90%,42rem)] overflow-hidden rounded-xl bg-white"
          >
            <button
              type="button"
              class="flex w-full items-center justify-between bg-[#f8fafc] px-3.5 py-2.5 text-left hover:bg-[#eef1f8]"
              @click="emit('toggleTool', m.id)"
            >
              <div class="flex items-center gap-2">
                <Icon icon="lucide:wrench" class="text-[#1a73e8]" />
                <span class="text-[13px] font-medium text-[#0a0a0b]"
                  >工具调用</span
                >
                <code
                  v-if="m.toolName"
                  class="rounded bg-[#e8f0ff] px-1.5 py-0.5 font-mono text-[11px] text-[#1a73e8]"
                  >{{ m.toolName }}</code
                >
              </div>
              <div class="flex items-center gap-1.5">
                <span
                  class="rounded-full bg-[#e8f0ff] px-2 py-0.5 text-[11px] text-[#1a73e8]"
                  >成功</span
                >
                <Icon
                  :icon="
                    toolExpanded[m.id]
                      ? 'lucide:chevron-up'
                      : 'lucide:chevron-down'
                  "
                  class="text-[#9ca3af]"
                />
              </div>
            </button>
            <div v-if="toolExpanded[m.id]" class="p-3.5">
              <pre
                class="max-h-64 overflow-auto rounded-lg bg-[#f7f8fc] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#52525b]"
                >{{ prettyToolPayload(m.text) }}</pre
              >
              <div class="mt-2 flex justify-end">
                <button
                  class="text-[11px] text-[#9ca3af] transition hover:text-[#1a73e8]"
                  @click.stop="emit('copyMsg', m.text)"
                >
                  <Icon
                    icon="lucide:copy"
                    class="mr-0.5 inline h-3 w-3"
                  />复制原文
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- SystemMessage 系统提示卡片（后端 role=user 但内容为 SystemMessage{...} 格式） -->
        <div
          v-else-if="m.role === 'user' && isSystemPrompt(m.text)"
          class="rounded-xl bg-white p-4"
        >
          <div class="flex items-center gap-2">
            <Icon icon="lucide:star" class="shrink-0 text-[#1a73e8]" />
            <span class="text-[13px] font-medium text-[#0a0a0b]"
              >SystemMessage</span
            >
          </div>
          <p class="mt-2.5 text-[13px] leading-[1.6] text-[#52525b]">
            {{ extractSystemPrompt(m.text) }}
          </p>
        </div>

        <!-- Regular message bubble -->
        <div
          v-else-if="m.text || (m.role === 'ai' && m.toolCalls?.length)"
          class="flex gap-2.5"
          :class="m.role !== 'user' ? 'flex-row-reverse' : ''"
        >
          <!-- Avatar -->
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium"
            :class="
              m.role === 'ai' ? 'bg-[#eef1f8] text-[#1a73e8]' : 'text-white'
            "
            :style="
              m.role === 'user'
                ? { background: '#a78bfa' }
                : m.role === 'agent'
                  ? { background: '#f97316' }
                  : {}
            "
          >
            {{
              m.role === 'user'
                ? activeSession.nameChar
                : m.role === 'agent'
                  ? '席'
                  : 'AI'
            }}
          </div>

          <div class="max-w-[min(85%,36rem)]">
            <!-- Tool call badges (AI only) -->
            <div
              v-if="m.role === 'ai' && m.toolCalls?.length"
              class="mb-1 flex flex-wrap justify-end gap-1"
            >
              <span
                v-for="(tc, i) in m.toolCalls"
                :key="tc.id ?? i"
                class="inline-flex items-center gap-1 rounded-full border border-[#e8f0ff] bg-white px-2 py-0.5 text-[11px] text-[#1a73e8]"
              >
                <Icon icon="lucide:wrench" class="text-[10px]" />
                {{ tc.name || '未命名工具' }}
              </span>
            </div>

            <!-- Bubble -->
            <div
              v-if="m.text"
              class="rounded-xl px-3.5 py-3 text-[14px] leading-[1.6]"
              :class="
                m.role === 'user'
                  ? 'rounded-tl-none bg-white text-[#0a0a0b]'
                  : m.role === 'agent'
                    ? 'rounded-tr-none bg-[#1a73e8] text-white'
                    : 'rounded-tr-none bg-white text-[#0a0a0b]'
              "
            >
              <div
                v-if="m.role === 'ai'"
                class="agent-ai-md"
                v-html="renderMarkdown(m.text)"
              ></div>
              <span
                v-else
                style="overflow-wrap: break-word; white-space: pre-wrap"
                >{{ m.text }}</span
              >
            </div>

            <!-- Timestamp + copy -->
            <div
              v-if="m.time"
              class="mt-0.5 flex items-center gap-1.5"
              :class="m.role === 'user' ? 'justify-start' : 'justify-end'"
            >
              <span class="text-[11px] text-[#d4d8e3]">{{ m.time }}</span>
              <button
                v-if="m.text"
                class="text-[#d4d8e3] transition hover:text-[#9ca3af]"
                title="复制"
                @click.stop="emit('copyMsg', m.text)"
              >
                <Icon icon="lucide:copy" class="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- 访客输入中气泡 -->
      <div v-if="visitorTyping" class="flex gap-2.5">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#a78bfa] text-[13px] font-medium text-white"
        >
          {{ activeSession?.nameChar }}
        </div>
        <div
          class="flex items-center gap-1 rounded-xl rounded-tl-none bg-white px-3.5 py-3"
        >
          <span
            class="h-2 w-2 animate-bounce rounded-full bg-[#9ca3af]"
            style="animation-delay: 0ms"
          ></span>
          <span
            class="h-2 w-2 animate-bounce rounded-full bg-[#9ca3af]"
            style="animation-delay: 150ms"
          ></span>
          <span
            class="h-2 w-2 animate-bounce rounded-full bg-[#9ca3af]"
            style="animation-delay: 300ms"
          ></span>
        </div>
      </div>

      <div data-msgs-end></div>
    </div>

    <!-- Quick replies -->
    <div
      class="flex shrink-0 gap-1.5 overflow-x-auto border-t border-[#e4e7ed] bg-white px-4 py-2"
    >
      <button
        v-for="q in quickReplies"
        :key="q"
        class="shrink-0 rounded-md bg-[#f7f8fc] px-3 py-1.5 text-[12px] text-[#52525b] transition hover:bg-[#eef1f8]"
        @click="emit('quickReply', q)"
      >
        {{ q }}
      </button>
    </div>

    <!-- Input area -->
    <footer
      class="flex shrink-0 items-center gap-3 border-t border-[#e4e7ed] bg-white px-5 py-3"
    >
      <textarea
        :value="msgInput"
        rows="2"
        placeholder="输入回复内容…（Enter 发送，Shift+Enter 换行）"
        class="min-h-[44px] flex-1 resize-none rounded-lg bg-[#f7f8fc] px-3.5 py-2.5 text-[14px] text-[#0a0a0b] outline-none placeholder:text-[#9ca3af] focus:ring-1 focus:ring-[#1a73e8]"
        style="scrollbar-width: thin"
        @input="
          emit('update:msgInput', ($event.target as HTMLTextAreaElement).value)
        "
        @keydown.enter="handleEnter"
      ></textarea>
      <button
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#1a73e8] text-white hover:opacity-90"
        @click="emit('send')"
      >
        <Icon icon="ant-design:send-outlined" style="font-size: 16px" />
      </button>
    </footer>
  </main>

  <!-- Closed session read-only view -->
  <main
    v-else-if="closedView"
    class="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f7f8fc]"
  >
    <header class="flex h-16 shrink-0 items-center gap-3 bg-white px-5">
      <div
        class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#f0f2f5] text-[15px] font-medium text-[#9ca3af]"
      >
        {{ closedView.session.nameChar }}
      </div>
      <div class="leading-tight">
        <div class="text-[14px] font-medium text-[#0a0a0b]">
          {{ closedView.session.name }}
        </div>
        <div class="text-[12px] text-[#9ca3af]">
          会话 #{{ closedView.session.id }} · 结束于
          {{ closedView.session.endedAt }}
        </div>
      </div>
      <div class="ml-auto">
        <span
          class="rounded bg-[#f0f2f5] px-2 py-0.5 text-[12px] text-[#9ca3af]"
          >已结束</span
        >
      </div>
    </header>

    <div
      class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
    >
      <div v-if="closedViewLoading" class="flex justify-center py-10">
        <Spin />
      </div>
      <template v-else>
        <div class="flex justify-center">
          <span
            class="rounded-full bg-[#eef1f8] px-3 py-1 text-[11px] text-[#9ca3af]"
          >
            共
            {{ closedView.msgs.filter((m) => m.role !== 'agent').length }}
            轮对话
          </span>
        </div>

        <template v-for="m in closedView.msgs" :key="m.id">
          <div v-if="m.role === 'system'" class="flex justify-center">
            <span
              class="rounded-full bg-[#f0f2f5] px-3 py-1 text-[11px] text-[#9ca3af]"
              >{{ m.text }}</span
            >
          </div>
          <div v-else-if="m.role === 'tool'" class="flex justify-center">
            <div
              class="w-full max-w-[min(90%,42rem)] overflow-hidden rounded-xl bg-white"
            >
              <button
                type="button"
                class="flex w-full items-center justify-between bg-[#f8fafc] px-3.5 py-2.5 text-left"
                @click="toggleClosedTool(m.id)"
              >
                <div class="flex items-center gap-2">
                  <Icon icon="lucide:wrench" class="text-[#1a73e8]" />
                  <span class="text-[13px] font-medium text-[#0a0a0b]"
                    >工具调用</span
                  >
                  <code
                    v-if="m.toolName"
                    class="rounded bg-[#e8f0ff] px-1.5 py-0.5 font-mono text-[11px] text-[#1a73e8]"
                    >{{ m.toolName }}</code
                  >
                </div>
                <Icon
                  :icon="
                    closedToolExpanded[m.id]
                      ? 'lucide:chevron-up'
                      : 'lucide:chevron-down'
                  "
                  class="text-[#9ca3af]"
                />
              </button>
              <div v-if="closedToolExpanded[m.id]" class="p-3.5">
                <pre
                  class="max-h-64 overflow-auto rounded-lg bg-[#f7f8fc] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#52525b]"
                  >{{ prettyToolPayload(m.text) }}</pre
                >
              </div>
            </div>
          </div>
          <!-- SystemMessage 卡片（closedView） -->
          <div
            v-else-if="m.role === 'user' && isSystemPrompt(m.text)"
            class="rounded-xl bg-white p-4"
          >
            <div class="flex items-center gap-2">
              <Icon icon="lucide:star" class="shrink-0 text-[#1a73e8]" />
              <span class="text-[13px] font-medium text-[#0a0a0b]"
                >SystemMessage</span
              >
            </div>
            <p class="mt-2.5 text-[13px] leading-[1.6] text-[#52525b]">
              {{ extractSystemPrompt(m.text) }}
            </p>
          </div>
          <div
            v-else-if="m.text || (m.role === 'ai' && m.toolCalls?.length)"
            class="flex gap-2.5"
            :class="m.role !== 'user' ? 'flex-row-reverse' : ''"
          >
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium"
              :class="
                m.role === 'ai' ? 'bg-[#eef1f8] text-[#1a73e8]' : 'text-white'
              "
              :style="
                m.role === 'user'
                  ? { background: '#a78bfa' }
                  : m.role === 'agent'
                    ? { background: '#f97316' }
                    : {}
              "
            >
              {{
                m.role === 'user'
                  ? closedView.session.nameChar
                  : m.role === 'agent'
                    ? '席'
                    : 'AI'
              }}
            </div>
            <div class="max-w-[min(85%,36rem)]">
              <div
                v-if="m.text"
                class="rounded-xl px-3.5 py-3 text-[14px] leading-[1.6]"
                :class="
                  m.role === 'user'
                    ? 'rounded-tl-none bg-white text-[#0a0a0b]'
                    : m.role === 'agent'
                      ? 'rounded-tr-none bg-[#1a73e8] text-white'
                      : 'rounded-tr-none bg-white text-[#0a0a0b]'
                "
              >
                <div
                  v-if="m.role === 'ai'"
                  class="agent-ai-md"
                  v-html="renderMarkdown(m.text)"
                ></div>
                <span
                  v-else
                  style="overflow-wrap: break-word; white-space: pre-wrap"
                  >{{ m.text }}</span
                >
              </div>
            </div>
          </div>
        </template> </template
      ><!-- end v-else (not loading) -->
    </div>
  </main>

  <!-- Empty state: no active session -->
  <main
    v-else
    class="flex min-w-0 flex-1 flex-col items-center justify-center bg-white"
  >
    <div
      class="flex h-20 w-20 items-center justify-center rounded-full bg-[#eef1f8]"
    >
      <Icon
        icon="lucide:message-square-dashed"
        class="text-4xl text-[#1a73e8]/30"
      />
    </div>
    <h3 class="mt-5 text-[16px] font-semibold text-[#52525b]">
      暂无进行中的会话
    </h3>
    <p
      class="mt-2 max-w-xs text-center text-[13px] leading-relaxed text-[#9ca3af]"
    >
      左侧「等待人工」队列中有用户时，<br />点击「接入会话」即可开始服务
    </p>
    <div class="mt-6 flex gap-3">
      <div
        class="flex flex-col items-center rounded-xl border border-[#e4e7ed] bg-[#f7f8fc] px-5 py-3"
      >
        <span class="text-xl font-bold text-[#1a73e8]">{{ queue.length }}</span>
        <span class="mt-0.5 text-[11px] text-[#9ca3af]">等待接入</span>
      </div>
      <div
        class="flex flex-col items-center rounded-xl border border-[#e4e7ed] bg-[#f7f8fc] px-5 py-3"
      >
        <span class="text-xl font-bold text-[#10b981]">{{
          maxConcurrent - concurrent
        }}</span>
        <span class="mt-0.5 text-[11px] text-[#9ca3af]">可接入数</span>
      </div>
    </div>
    <div class="mt-5 flex items-center gap-1.5">
      <span class="relative flex h-2 w-2">
        <span
          class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10b981] opacity-75"
        ></span>
        <span
          class="relative inline-flex h-2 w-2 rounded-full bg-[#10b981]"
        ></span>
      </span>
      <span class="text-[12px] text-[#10b981]"
        >实时监听中，新会话将自动推送</span
      >
    </div>
  </main>
</template>

<style scoped>
:deep(.agent-ai-md) p {
  margin: 0.3em 0;
}

:deep(.agent-ai-md) p:first-child {
  margin-top: 0;
}

:deep(.agent-ai-md) p:last-child {
  margin-bottom: 0;
}

:deep(.agent-ai-md) ul,
:deep(.agent-ai-md) ol {
  padding-left: 1.3em;
  margin: 0.3em 0;
}

:deep(.agent-ai-md) li {
  margin: 0.15em 0;
}

:deep(.agent-ai-md) code {
  padding: 1px 4px;
  font-family: monospace;
  font-size: 11px;
  background: #e8f0ff;
  border-radius: 3px;
}

:deep(.agent-ai-md) pre {
  padding: 8px;
  margin: 0.3em 0;
  overflow-x: auto;
  font-size: 11px;
  background: #f0f4ff;
  border-radius: 4px;
}

:deep(.agent-ai-md) pre code {
  padding: 0;
  background: none;
}

:deep(.agent-ai-md) strong {
  font-weight: 600;
}

:deep(.agent-ai-md) h1,
:deep(.agent-ai-md) h2,
:deep(.agent-ai-md) h3 {
  margin: 0.4em 0 0.2em;
  font-weight: 600;
}

:deep(.agent-ai-md) blockquote {
  padding-left: 8px;
  margin: 0.3em 0;
  color: #1a73e8;
  border-left: 2px solid #1a73e8;
  opacity: 0.8;
}

:deep(.agent-ai-md) table {
  margin: 0.3em 0;
  font-size: 11px;
  border-collapse: collapse;
}

:deep(.agent-ai-md) th,
:deep(.agent-ai-md) td {
  padding: 3px 6px;
  border: 1px solid #e8f0ff;
}

:deep(.agent-ai-md) th {
  background: #eef1f8;
}
</style>
