<script setup lang="ts">
import type { ClosedSessionItem, ClosedView, SessionData } from './types';

import type { QueueItem } from '#/composables/useSessionQueue';

import { Icon } from '@iconify/vue';
import { Button, Progress, Switch, Tag } from 'ant-design-vue';

const props = defineProps<{
  agentOnline: boolean;
  aiQueue: QueueItem[];
  closedSessions: ClosedSessionItem[];
  closedView: ClosedView | null;
  concurrent: number;
  maxConcurrent: number;
  queuePage: number;
  queueSearch: string;
  queueStateTab: 'active' | 'ai' | 'closed' | 'waiting';
  queueTotalPages: number;
  sessions: SessionData[];
  sseConnected: boolean;
  visiblePagedWaitingQueue: QueueItem[];
  visibleSessions: SessionData[];
  visitorTypingMap: Record<string, boolean>;
  waitingQueue: QueueItem[];
}>();

const emit = defineEmits<{
  acceptQueue: [item: QueueItem];
  reconnectQueue: [];
  switchSession: [s: SessionData];
  toggleOnline: [val: boolean];
  'update:queuePage': [val: number];
  'update:queueSearch': [val: string];
  'update:queueStateTab': [val: 'active' | 'ai' | 'closed' | 'waiting'];
  viewAiSession: [item: QueueItem];
  viewClosed: [item: ClosedSessionItem];
}>();

const queueStateTabs = [
  { key: 'ai', label: 'AI 对话', icon: 'lucide:bot' },
  { key: 'waiting', label: '等待人工', icon: 'lucide:clock' },
  { key: 'active', label: '人工', icon: 'lucide:headphones' },
  { key: 'closed', label: '结束', icon: 'lucide:archive' },
];

/**
 * 取会话最后一条可展示的消息预览（跳过 system/tool），用于左栏列表项副标题。
 * 没有任何可展示消息时回退到 s.min（如"刚接入"）。
 */
function lastMsgPreview(s: SessionData): string {
  for (let i = s.msgs.length - 1; i >= 0; i--) {
    const m = s.msgs[i];
    if (!m) continue;
    if (!m.text || m.role === 'system' || m.role === 'tool') continue;
    const prefix = m.role === 'agent' ? '我：' : m.role === 'ai' ? 'AI：' : '';
    const text = m.text.length > 22 ? `${m.text.slice(0, 22)}…` : m.text;
    return `${prefix}${text}`;
  }
  return s.min;
}

/** 智能格式化时间戳：今天 HH:MM / 昨天 / 更早 MM-DD */
function formatChatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

/** 取会话最后一条消息的时间，优先用 ts 智能格式化，旧消息兜底 time 字符串 */
function lastMsgTime(s: SessionData): string {
  for (let i = s.msgs.length - 1; i >= 0; i--) {
    const m = s.msgs[i];
    if (!m) continue;
    if (m.ts) return formatChatTime(m.ts);
    if (m.time) return m.time;
  }
  return '';
}
</script>

<template>
  <aside class="flex h-full flex-col gap-3 bg-[#eef1f8] p-4">
    <!-- Agent status card -->
    <div class="rounded-xl bg-white p-3.5">
      <div class="flex items-center justify-between">
        <span class="text-[14px] font-medium text-[#0a0a0b]">座席状态</span>
        <Switch
          :checked="agentOnline"
          checked-children="在线"
          un-checked-children="暂离"
          size="small"
          :style="agentOnline ? { backgroundColor: '#1a73e8' } : {}"
          @update:checked="(v) => emit('toggleOnline', v as boolean)"
        />
      </div>
      <div class="mt-3">
        <Progress
          :percent="Math.round((concurrent / maxConcurrent) * 100)"
          :format="() => `${concurrent}/${maxConcurrent}`"
          size="small"
          :stroke-color="concurrent >= maxConcurrent ? '#ef4444' : '#1a73e8'"
        />
      </div>
      <p class="mt-1 text-[12px] text-[#9ca3af]">
        {{ concurrent }}/{{ maxConcurrent }} 会话接待中
      </p>
    </div>

    <!-- Queue section -->
    <div class="flex min-h-0 flex-1 flex-col gap-2.5">
      <!-- Queue header -->
      <div class="flex items-center justify-between">
        <span class="text-[14px] font-medium text-[#0a0a0b]">会话队列</span>
        <div class="flex items-center gap-1.5">
          <span
            v-if="waitingQueue.length > 0"
            class="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#1a73e8] px-1 text-[11px] text-white"
          >
            {{ waitingQueue.length }}
          </span>
          <!-- SSE 状态点 -->
          <span
            class="h-2 w-2 rounded-full transition-colors"
            :class="sseConnected ? 'bg-[#10b981]' : 'bg-[#ef4444]'"
            :title="sseConnected ? 'SSE 实时连接正常' : 'SSE 连接断开'"
          ></span>
          <button
            v-if="!sseConnected"
            class="text-[11px] text-[#1a73e8] hover:underline"
            @click="emit('reconnectQueue')"
          >
            重连
          </button>
        </div>
      </div>

      <!-- Search -->
      <div
        class="flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[#9ca3af]"
      >
        <Icon icon="lucide:search" class="shrink-0 text-sm" />
        <input
          :value="queueSearch"
          type="text"
          placeholder="搜索名称 / 标签 / 会话ID"
          class="flex-1 bg-transparent text-[13px] text-[#0a0a0b] outline-none placeholder:text-[#9ca3af]"
          @input="
            emit(
              'update:queueSearch',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
      </div>

      <!-- Tab switcher -->
      <div class="flex items-center gap-0.5 rounded-lg bg-[#e4e7ed] p-0.5">
        <button
          v-for="tab in queueStateTabs"
          :key="tab.key"
          class="flex h-[28px] flex-1 items-center justify-center gap-1 rounded-md text-[11px] transition-colors"
          :class="
            queueStateTab === tab.key
              ? 'bg-[#1a73e8] font-medium text-white'
              : 'bg-transparent text-[#52525b] hover:text-[#0a0a0b]'
          "
          @click="
            emit(
              'update:queueStateTab',
              tab.key as 'ai' | 'active' | 'closed' | 'waiting',
            )
          "
        >
          <Icon :icon="tab.icon" class="shrink-0 text-[12px]" />
          <!-- AI 对话 Tab 角标 -->
          <span
            v-if="tab.key === 'ai' && aiQueue.length"
            class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
            :class="
              queueStateTab === 'ai'
                ? 'bg-white/30 text-white'
                : 'bg-[#1a73e8]/10 text-[#1a73e8]'
            "
            >{{ aiQueue.length }}</span
          >
          <!-- 等待人工 Tab 红点 -->
          <span
            v-else-if="tab.key === 'waiting' && waitingQueue.length"
            class="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] text-white"
            >{{ waitingQueue.length }}</span
          >
          <!-- 人工接待中 Tab 角标 -->
          <span
            v-else-if="tab.key === 'active' && sessions.length"
            class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
            :class="
              queueStateTab === 'active'
                ? 'bg-white/30 text-white'
                : 'bg-[#1a73e8]/10 text-[#1a73e8]'
            "
            >{{ sessions.length }}</span
          >
          <span class="hidden sm:inline">{{ tab.label }}</span>
        </button>
      </div>

      <!-- List area -->
      <div
        class="min-h-0 flex-1 overflow-y-auto"
        style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
      >
        <!-- AI 对话 Tab：展示当前 AI 自动处理中的队列项 -->
        <template v-if="queueStateTab === 'ai'">
          <div v-if="aiQueue.length" class="space-y-1.5">
            <div
              v-for="item in aiQueue"
              :key="item.id"
              class="flex cursor-pointer items-center gap-2 rounded-xl bg-white p-2.5 transition-colors hover:bg-[#f5fafe]"
              @click="emit('viewAiSession', item)"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white"
                :style="{ background: item.color }"
              >
                {{ item.name[0] }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-medium text-[#0a0a0b]">
                  {{ item.name }}
                </p>
                <p class="text-[11px] text-[#1a73e8]">
                  AI 处理中 · {{ item.waitMin }}
                </p>
              </div>
              <span class="flex h-2 w-2 shrink-0 items-center justify-center">
                <span class="relative flex h-2 w-2">
                  <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1a73e8] opacity-60"
                  ></span>
                  <span
                    class="relative inline-flex h-2 w-2 rounded-full bg-[#1a73e8]"
                  ></span>
                </span>
              </span>
            </div>
          </div>
          <div
            v-else
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <div
              class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#e8f0ff]"
            >
              <Icon icon="lucide:bot" class="text-lg text-[#1a73e8]" />
            </div>
            <p class="text-[12px] font-medium text-[#52525b]">暂无 AI 对话</p>
            <p class="mt-1 text-[11px] text-[#9ca3af]">
              AI 自动处理中的会话将在此显示
            </p>
          </div>
        </template>

        <!-- 等待人工 Tab -->
        <template v-else-if="queueStateTab === 'waiting'">
          <div v-if="visiblePagedWaitingQueue.length" class="space-y-2">
            <div
              v-for="item in visiblePagedWaitingQueue"
              :key="item.id"
              class="rounded-xl bg-white p-2.5"
            >
              <div class="flex items-center gap-2">
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white"
                  :style="{ background: item.color }"
                >
                  {{ item.name[0] }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-medium text-[#0a0a0b]">
                    {{ item.name }}
                  </p>
                  <p class="text-[11px] text-[#f59e0b]">
                    等待 {{ item.waitMin }}
                  </p>
                </div>
                <Tag :color="item.tagColor" class="shrink-0 !text-[11px]">
                  {{ item.tag }}
                </Tag>
              </div>
              <p class="mt-1.5 truncate text-[11px] text-[#52525b]">
                {{ item.reason }}
              </p>
              <Button
                type="primary"
                size="small"
                block
                class="mt-2 !bg-[#1a73e8] !border-[#1a73e8]"
                @click="emit('acceptQueue', item)"
              >
                <template #icon><Icon icon="lucide:headphones" /></template>
                接入会话
              </Button>
            </div>

            <!-- Pagination — 移至列表外部，见下方 -->
          </div>

          <!-- 搜索无结果 -->
          <div
            v-else-if="waitingQueue.length && !visiblePagedWaitingQueue.length"
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <Icon icon="lucide:search-x" class="mb-2 text-2xl text-[#e4e7ed]" />
            <p class="text-[12px] text-[#9ca3af]">
              未找到匹配"{{ queueSearch }}"的会话
            </p>
          </div>

          <!-- 队列为空 -->
          <div
            v-else
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <div
              class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#f0fdf4]"
            >
              <Icon icon="lucide:coffee" class="text-lg text-[#10b981]" />
            </div>
            <p class="text-[12px] font-medium text-[#52525b]">暂无等待用户</p>
            <p class="mt-1 text-[11px] text-[#9ca3af]">队列空空，轻松一下</p>
            <div class="mt-3 flex items-center gap-1.5">
              <span class="relative flex h-2 w-2">
                <span
                  class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10b981] opacity-75"
                ></span>
                <span
                  class="relative inline-flex h-2 w-2 rounded-full bg-[#10b981]"
                ></span>
              </span>
              <span class="text-[11px] text-[#10b981]">实时监听中</span>
            </div>
          </div>
        </template>

        <!-- 人工接待中 Tab -->
        <template v-else-if="queueStateTab === 'active'">
          <div v-if="visibleSessions.length" class="space-y-1.5">
            <div
              v-for="s in visibleSessions"
              :key="s.id"
              class="flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-colors"
              :class="s.active ? 'bg-[#f5fafe]' : 'bg-white hover:bg-[#f5fafe]'"
              @click="emit('switchSession', s)"
            >
              <!-- 头像 + 未读红点 -->
              <div class="relative shrink-0">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium text-white"
                  :style="{ background: s.color }"
                >
                  {{ s.nameChar }}
                </div>
                <span
                  v-if="!s.active && s.unread > 0"
                  class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white"
                >
                  {{ s.unread > 99 ? '99+' : s.unread }}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate text-[13px] font-medium text-[#0a0a0b]">
                    {{ s.name }}
                  </p>
                  <span
                    v-if="lastMsgTime(s)"
                    class="shrink-0 text-[11px] text-[#9ca3af]"
                    >{{ lastMsgTime(s) }}</span
                  >
                </div>
                <!-- 访客正在输入：蓝色跳动点 + 文案，盖过默认副标题 -->
                <p
                  v-if="visitorTypingMap[s.id]"
                  class="flex items-center gap-1 text-[11px] text-[#1a73e8]"
                >
                  <span class="flex items-center gap-0.5">
                    <span
                      class="h-1 w-1 animate-bounce rounded-full bg-[#1a73e8]"
                      style="animation-delay: 0ms"
                    ></span>
                    <span
                      class="h-1 w-1 animate-bounce rounded-full bg-[#1a73e8]"
                      style="animation-delay: 150ms"
                    ></span>
                    <span
                      class="h-1 w-1 animate-bounce rounded-full bg-[#1a73e8]"
                      style="animation-delay: 300ms"
                    ></span>
                  </span>
                  正在输入中…
                </p>
                <p
                  v-else
                  class="truncate text-[11px]"
                  :class="s.active ? 'text-[#1a73e8]' : 'text-[#9ca3af]'"
                >
                  {{ lastMsgPreview(s) }}
                </p>
              </div>
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="s.active ? 'bg-[#10b981]' : 'bg-[#e4e7ed]'"
              ></span>
            </div>
          </div>

          <div
            v-else-if="sessions.length && !visibleSessions.length"
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <Icon icon="lucide:search-x" class="mb-2 text-2xl text-[#e4e7ed]" />
            <p class="text-[12px] text-[#9ca3af]">
              未找到匹配"{{ queueSearch }}"的会话
            </p>
          </div>

          <div
            v-else
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <Icon icon="lucide:inbox" class="mb-2 text-2xl text-[#e4e7ed]" />
            <p class="text-[12px] text-[#9ca3af]">暂无进行中的会话</p>
          </div>
        </template>

        <!-- 已结束 Tab -->
        <template v-else-if="queueStateTab === 'closed'">
          <div v-if="closedSessions.length" class="space-y-1.5">
            <div
              v-for="item in closedSessions"
              :key="item.id"
              class="flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-colors"
              :class="
                closedView?.session.id === item.id
                  ? 'bg-[#f5fafe]'
                  : 'bg-white hover:bg-[#f5fafe]'
              "
              @click="emit('viewClosed', item)"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0f2f5] text-[13px] font-medium text-[#9ca3af]"
              >
                {{ item.nameChar }}
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-medium text-[#0a0a0b]">
                  {{ item.name }}
                </p>
                <p class="text-[11px] text-[#9ca3af]">{{ item.endedAt }}</p>
              </div>
              <Tag color="default" class="shrink-0 !text-[11px]">{{
                item.tag
              }}</Tag>
            </div>
          </div>
          <div
            v-else
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <Icon icon="lucide:archive" class="mb-2 text-2xl text-[#e4e7ed]" />
            <p class="text-[12px] text-[#9ca3af]">暂无已结束会话</p>
          </div>
        </template>
      </div>

      <!-- 分页：固定在左栏底部，仅等待人工 Tab 且多页时显示 -->
      <div
        v-if="queueStateTab === 'waiting' && queueTotalPages > 1"
        class="flex shrink-0 items-center justify-center gap-1.5 pt-1"
      >
        <button
          class="rounded-md px-2.5 py-1.5 text-[12px] transition"
          :class="
            queuePage <= 1
              ? 'cursor-not-allowed bg-white text-[#d4d8e3]'
              : 'bg-white text-[#52525b] hover:bg-[#eef1f8]'
          "
          :disabled="queuePage <= 1"
          @click="queuePage > 1 && emit('update:queuePage', queuePage - 1)"
        >
          上一页
        </button>
        <span
          class="rounded-md bg-[#1a73e8] px-3 py-1.5 text-[12px] text-white"
        >
          {{ queuePage }} / {{ queueTotalPages }}
        </span>
        <button
          class="rounded-md px-2.5 py-1.5 text-[12px] transition"
          :class="
            queuePage >= queueTotalPages
              ? 'cursor-not-allowed bg-[#1a73e8]/40 text-white'
              : 'bg-[#1a73e8] text-white hover:opacity-90'
          "
          :disabled="queuePage >= queueTotalPages"
          @click="
            queuePage < queueTotalPages &&
            emit('update:queuePage', queuePage + 1)
          "
        >
          下一页
        </button>
      </div>
    </div>
  </aside>
</template>
