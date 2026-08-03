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

// ===== 等待时长解析与优先级分级 =====

/** 从 "3 分钟" / "1 小时" 等字符串中提取分钟数 */
function parseWaitMinutes(waitMin: string): number {
  const match = waitMin.match(/(\d+)/);
  if (!match) return 0;
  const num = Number(match[1]);
  if (waitMin.includes('小时')) return num * 60;
  return num;
}

type Priority = 'medium' | 'normal' | 'urgent';

/** 根据等待分钟数返回优先级 */
function getPriority(waitMin: string): Priority {
  const mins = parseWaitMinutes(waitMin);
  if (mins > 5) return 'urgent';
  if (mins > 2) return 'medium';
  return 'normal';
}

/** 优先级对应的等待文字颜色 */
function waitColorClass(waitMin: string): string {
  const p = getPriority(waitMin);
  if (p === 'urgent') return 'text-red-600 dark:text-red-400';
  if (p === 'medium') return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

/** 优先级对应的头像状态点颜色 */
function statusDotClass(waitMin: string): string {
  const p = getPriority(waitMin);
  if (p === 'urgent') return 'bg-red-500';
  if (p === 'medium') return 'bg-amber-500';
  return 'bg-emerald-500';
}

/** 优先级对应的进度条宽度 */
function progressWidth(waitMin: string): string {
  const mins = parseWaitMinutes(waitMin);
  return `${Math.min(mins * 15, 100)}%`;
}

/** 优先级对应的进度条渐变色 */
function progressGradient(waitMin: string): string {
  const p = getPriority(waitMin);
  if (p === 'urgent')
    return 'linear-gradient(90deg, #10b981, #f59e0b, #ef4444)';
  if (p === 'medium') return 'linear-gradient(90deg, #10b981, #f59e0b)';
  return '#10b981';
}

/** 按优先级分组排序后的等待队列 */
function groupedWaitingQueue(
  items: QueueItem[],
): { dotColor: string; items: QueueItem[]; label: string }[] {
  const urgent = items.filter((i) => getPriority(i.waitMin) === 'urgent');
  const medium = items.filter((i) => getPriority(i.waitMin) === 'medium');
  const normal = items.filter((i) => getPriority(i.waitMin) === 'normal');
  const groups: { dotColor: string; items: QueueItem[]; label: string }[] = [];
  if (urgent.length > 0)
    groups.push({
      label: '紧急 (等待 > 5 分钟)',
      dotColor: 'bg-red-500',
      items: urgent,
    });
  if (medium.length > 0)
    groups.push({
      label: '中等 (2-5 分钟)',
      dotColor: 'bg-amber-500',
      items: medium,
    });
  if (normal.length > 0)
    groups.push({
      label: '新会话 (< 2 分钟)',
      dotColor: 'bg-emerald-500',
      items: normal,
    });
  return groups;
}
</script>

<template>
  <aside
    class="flex h-full w-full flex-col gap-3 bg-[#f8fafc] p-4 dark:bg-slate-900/50"
  >
    <!-- Agent status card -->
    <div class="shrink-0 rounded-xl bg-white p-3.5 dark:bg-slate-800">
      <div class="flex items-center justify-between">
        <span class="text-[14px] font-medium text-[#0a0a0b] dark:text-slate-100"
          >座席状态</span
        >
        <Switch
          :checked="agentOnline"
          checked-children="在线"
          un-checked-children="暂离"
          size="small"
          :style="agentOnline ? { backgroundColor: '#3b82f6' } : {}"
          @update:checked="(v) => emit('toggleOnline', v as boolean)"
        />
      </div>
      <div class="mt-3">
        <Progress
          :percent="Math.round((concurrent / maxConcurrent) * 100)"
          :format="() => `${concurrent}/${maxConcurrent}`"
          size="small"
          :stroke-color="concurrent >= maxConcurrent ? '#ef4444' : '#3b82f6'"
        />
      </div>
      <p class="mt-1 text-[12px] text-[#9ca3af]">
        {{ concurrent }}/{{ maxConcurrent }} 会话接待中
      </p>
    </div>

    <!-- Queue section -->
    <div class="flex min-h-0 flex-1 flex-col gap-2.5">
      <!-- Queue header -->
      <div class="flex shrink-0 items-center justify-between">
        <span class="text-[14px] font-medium text-[#0a0a0b] dark:text-slate-100"
          >会话队列</span
        >
        <div class="flex items-center gap-1.5">
          <!-- 脉冲红点徽章 -->
          <span
            v-if="waitingQueue.length > 0"
            class="relative flex h-5 min-w-5 items-center justify-center"
          >
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-40"
            ></span>
            <span
              class="relative flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white"
            >
              {{ waitingQueue.length }}
            </span>
          </span>
          <!-- SSE 状态点 -->
          <span
            class="h-2 w-2 rounded-full transition-colors"
            :class="sseConnected ? 'bg-emerald-500' : 'bg-red-500'"
            :title="sseConnected ? 'SSE 实时连接正常' : 'SSE 连接断开'"
          ></span>
          <button
            v-if="!sseConnected"
            class="text-[11px] text-blue-500 hover:underline"
            @click="emit('reconnectQueue')"
          >
            重连
          </button>
        </div>
      </div>

      <!-- Search -->
      <div
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[#9ca3af] dark:bg-slate-800"
      >
        <Icon icon="lucide:search" class="shrink-0 text-sm" />
        <input
          :value="queueSearch"
          type="text"
          placeholder="搜索名称 / 标签 / 会话ID"
          class="min-w-0 flex-1 bg-transparent text-[13px] text-[#0a0a0b] outline-none placeholder:text-[#9ca3af] dark:text-slate-100"
          @input="
            emit(
              'update:queueSearch',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
      </div>

      <!-- Tab switcher -->
      <div
        class="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-200 p-0.5 dark:bg-slate-700"
      >
        <button
          v-for="tab in queueStateTabs"
          :key="tab.key"
          :title="tab.label"
          class="flex h-[28px] flex-1 items-center justify-center gap-1 rounded-md text-[12px] transition-colors"
          :class="
            queueStateTab === tab.key
              ? 'bg-blue-500 font-medium text-white'
              : 'bg-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="
            emit(
              'update:queueStateTab',
              tab.key as 'ai' | 'active' | 'closed' | 'waiting',
            )
          "
        >
          <Icon :icon="tab.icon" class="shrink-0" />
          <!-- AI 对话 Tab 角标 -->
          <span
            v-if="tab.key === 'ai' && aiQueue.length"
            class="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]"
            :class="
              queueStateTab === 'ai'
                ? 'bg-white/30 text-white'
                : 'bg-blue-500/10 text-blue-500'
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
                : 'bg-blue-500/10 text-blue-500'
            "
            >{{ sessions.length }}</span
          >
        </button>
      </div>

      <!-- List area -->
      <div
        class="min-h-0 flex-1 overflow-y-auto"
        style="scrollbar-color: #cbd5e1 transparent; scrollbar-width: thin"
      >
        <!-- AI 对话 Tab -->
        <template v-if="queueStateTab === 'ai'">
          <div v-if="aiQueue.length" class="space-y-1.5">
            <div
              v-for="item in aiQueue"
              :key="item.id"
              class="flex cursor-pointer items-center gap-2 rounded-xl bg-white p-2.5 transition-all hover:bg-blue-50 hover:shadow-sm dark:bg-slate-800 dark:hover:bg-slate-700"
              @click="emit('viewAiSession', item)"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-medium text-white"
                :style="{ background: item.color }"
              >
                {{ item.name[0] }}
              </div>
              <div class="min-w-0 flex-1">
                <p
                  class="text-[13px] font-medium text-[#0a0a0b] dark:text-slate-100"
                >
                  {{ item.name }}
                </p>
                <p class="text-[11px] text-blue-500">
                  AI 处理中 · {{ item.waitMin }}
                </p>
              </div>
              <span class="flex h-2 w-2 shrink-0 items-center justify-center">
                <span class="relative flex h-2 w-2">
                  <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-60"
                  ></span>
                  <span
                    class="relative inline-flex h-2 w-2 rounded-full bg-blue-500"
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
              class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30"
            >
              <Icon icon="lucide:bot" class="text-lg text-blue-500" />
            </div>
            <p
              class="text-[12px] font-medium text-slate-600 dark:text-slate-300"
            >
              暂无 AI 对话
            </p>
            <p class="mt-1 text-[11px] text-[#9ca3af]">
              AI 自动处理中的会话将在此显示
            </p>
          </div>
        </template>

        <!-- 等待人工 Tab — 按优先级分组 + 增强卡片 -->
        <template v-else-if="queueStateTab === 'waiting'">
          <div v-if="visiblePagedWaitingQueue.length">
            <template
              v-for="group in groupedWaitingQueue(visiblePagedWaitingQueue)"
              :key="group.label"
            >
              <!-- 分组标题 -->
              <div
                class="mb-1.5 mt-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold text-slate-400"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="group.dotColor"
                ></span>
                {{ group.label }}
                <span class="ml-auto font-normal">{{
                  group.items.length
                }}</span>
              </div>
              <!-- 分组内卡片 -->
              <div class="mb-3 space-y-2">
                <div
                  v-for="item in group.items"
                  :key="item.id"
                  class="relative cursor-pointer overflow-hidden rounded-xl bg-white p-3 transition-all duration-200 hover:-translate-y-px hover:shadow-md dark:bg-slate-800"
                >
                  <!-- 左侧优先级色条 -->
                  <div
                    class="absolute left-0 top-0 bottom-0 w-[3px]"
                    :class="{
                      'bg-red-500': getPriority(item.waitMin) === 'urgent',
                      'bg-amber-500': getPriority(item.waitMin) === 'medium',
                      'bg-emerald-500': getPriority(item.waitMin) === 'normal',
                    }"
                  ></div>

                  <div class="flex items-center gap-2.5">
                    <!-- 头像 + 状态点 -->
                    <div class="relative shrink-0">
                      <div
                        class="flex h-9 w-9 items-center justify-center rounded-lg text-[14px] font-medium text-white"
                        :style="{ background: item.color }"
                      >
                        {{ item.name[0] }}
                      </div>
                      <span
                        class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-slate-800"
                        :class="statusDotClass(item.waitMin)"
                      ></span>
                    </div>

                    <div class="min-w-0 flex-1">
                      <!-- 名称行 -->
                      <div class="flex items-center justify-between gap-2">
                        <p
                          class="truncate text-[13px] font-semibold text-[#0a0a0b] dark:text-slate-100"
                        >
                          {{ item.name }}
                        </p>
                        <Tag
                          :color="item.tagColor"
                          class="shrink-0 !text-[10px]"
                        >
                          {{ item.tag }}
                        </Tag>
                      </div>
                      <!-- 等待时长（分级着色） -->
                      <div class="mt-0.5 flex items-center gap-1">
                        <Icon
                          icon="lucide:clock"
                          class="shrink-0 text-[10px] opacity-50"
                        />
                        <span
                          class="text-[11px] font-medium"
                          :class="waitColorClass(item.waitMin)"
                        >
                          等待 {{ item.waitMin }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- 转接原因 -->
                  <div
                    class="mt-2 flex items-start gap-1 text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    <Icon
                      icon="lucide:info"
                      class="mt-0.5 shrink-0 text-[10px] opacity-50"
                    />
                    <span class="line-clamp-2">{{ item.reason }}</span>
                  </div>

                  <!-- 等待进度条 -->
                  <div
                    class="mt-2 h-[3px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
                  >
                    <div
                      class="h-full rounded-full transition-all duration-300"
                      :style="{
                        width: progressWidth(item.waitMin),
                        background: progressGradient(item.waitMin),
                      }"
                    ></div>
                  </div>

                  <!-- 接入按钮 -->
                  <Button
                    type="primary"
                    size="small"
                    block
                    class="mt-2.5 !bg-blue-500 !border-blue-500 hover:!bg-blue-600"
                    @click="emit('acceptQueue', item)"
                  >
                    <template #icon><Icon icon="lucide:headphones" /></template>
                    接入会话
                  </Button>
                </div>
              </div>
            </template>
          </div>

          <!-- 搜索无结果 -->
          <div
            v-else-if="waitingQueue.length && !visiblePagedWaitingQueue.length"
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <Icon icon="lucide:search-x" class="mb-2 text-2xl text-slate-300" />
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
              class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/30"
            >
              <Icon icon="lucide:coffee" class="text-lg text-emerald-500" />
            </div>
            <p
              class="text-[12px] font-medium text-slate-600 dark:text-slate-300"
            >
              暂无等待用户
            </p>
            <p class="mt-1 text-[11px] text-[#9ca3af]">队列空空，轻松一下</p>
            <div class="mt-3 flex items-center gap-1.5">
              <span class="relative flex h-2 w-2">
                <span
                  class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"
                ></span>
                <span
                  class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
                ></span>
              </span>
              <span class="text-[11px] text-emerald-500">实时监听中</span>
            </div>
          </div>
        </template>

        <!-- 人工接待中 Tab -->
        <template v-else-if="queueStateTab === 'active'">
          <div v-if="visibleSessions.length" class="space-y-1.5">
            <div
              v-for="s in visibleSessions"
              :key="s.id"
              class="flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-all hover:shadow-sm"
              :class="
                s.active
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'bg-white hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700'
              "
              @click="emit('switchSession', s)"
            >
              <!-- 头像 + 未读红点 -->
              <div class="relative shrink-0">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-medium text-white"
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
                  <p
                    class="truncate text-[13px] font-medium text-[#0a0a0b] dark:text-slate-100"
                  >
                    {{ s.name }}
                  </p>
                  <span
                    v-if="lastMsgTime(s)"
                    class="shrink-0 text-[11px] text-[#9ca3af]"
                    >{{ lastMsgTime(s) }}</span
                  >
                </div>
                <!-- 访客正在输入 -->
                <p
                  v-if="visitorTypingMap[s.id]"
                  class="flex items-center gap-1 text-[11px] text-blue-500"
                >
                  <span class="flex items-center gap-0.5">
                    <span
                      class="h-1 w-1 animate-bounce rounded-full bg-blue-500"
                      style="animation-delay: 0ms"
                    ></span>
                    <span
                      class="h-1 w-1 animate-bounce rounded-full bg-blue-500"
                      style="animation-delay: 150ms"
                    ></span>
                    <span
                      class="h-1 w-1 animate-bounce rounded-full bg-blue-500"
                      style="animation-delay: 300ms"
                    ></span>
                  </span>
                  正在输入中…
                </p>
                <p
                  v-else
                  class="truncate text-[11px]"
                  :class="s.active ? 'text-blue-500' : 'text-[#9ca3af]'"
                >
                  {{ lastMsgPreview(s) }}
                </p>
              </div>
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="s.active ? 'bg-emerald-500' : 'bg-slate-300'"
              ></span>
            </div>
          </div>

          <div
            v-else-if="sessions.length && !visibleSessions.length"
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <Icon icon="lucide:search-x" class="mb-2 text-2xl text-slate-300" />
            <p class="text-[12px] text-[#9ca3af]">
              未找到匹配"{{ queueSearch }}"的会话
            </p>
          </div>

          <div
            v-else
            class="flex flex-col items-center justify-center py-8 text-center"
          >
            <Icon icon="lucide:inbox" class="mb-2 text-2xl text-slate-300" />
            <p class="text-[12px] text-[#9ca3af]">暂无进行中的会话</p>
          </div>
        </template>

        <!-- 已结束 Tab -->
        <template v-else-if="queueStateTab === 'closed'">
          <div v-if="closedSessions.length" class="space-y-1.5">
            <div
              v-for="item in closedSessions"
              :key="item.id"
              class="flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-all hover:shadow-sm"
              :class="
                closedView?.session.id === item.id
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'bg-white hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-slate-700'
              "
              @click="emit('viewClosed', item)"
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[13px] font-medium text-slate-400 dark:bg-slate-700"
              >
                {{ item.nameChar }}
              </div>
              <div class="min-w-0 flex-1">
                <p
                  class="text-[13px] font-medium text-[#0a0a0b] dark:text-slate-100"
                >
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
            <Icon icon="lucide:archive" class="mb-2 text-2xl text-slate-300" />
            <p class="text-[12px] text-[#9ca3af]">暂无已结束会话</p>
          </div>
        </template>
      </div>

      <!-- 分页 -->
      <div
        v-if="queueStateTab === 'waiting' && queueTotalPages > 1"
        class="flex shrink-0 items-center justify-center gap-1.5 pt-1"
      >
        <button
          class="rounded-md px-2.5 py-1.5 text-[12px] transition"
          :class="
            queuePage <= 1
              ? 'cursor-not-allowed bg-white text-slate-300 dark:bg-slate-800'
              : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300'
          "
          :disabled="queuePage <= 1"
          @click="queuePage > 1 && emit('update:queuePage', queuePage - 1)"
        >
          上一页
        </button>
        <span class="rounded-md bg-blue-500 px-3 py-1.5 text-[12px] text-white">
          {{ queuePage }} / {{ queueTotalPages }}
        </span>
        <button
          class="rounded-md px-2.5 py-1.5 text-[12px] transition"
          :class="
            queuePage >= queueTotalPages
              ? 'cursor-not-allowed bg-blue-500/40 text-white'
              : 'bg-blue-500 text-white hover:opacity-90'
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
