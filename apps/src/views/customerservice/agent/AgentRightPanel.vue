<script setup lang="ts">
import type { ClosedView, SessionData } from './types';

import type { ReplySuggestion, VisitorHistorySession } from '#/api/session';
import type { SummaryState } from '#/composables/useVisitorHistory';

import { Icon } from '@iconify/vue';
import { Button } from 'ant-design-vue';

import { formatWaitTime, resolveTagColor } from '#/composables/useSessionQueue';

import AISuggestPanel from './AISuggestPanel.vue';

const props = defineProps<{
  activeSession: SessionData | undefined;
  closedView: ClosedView | null;
  replySuggestions: ReplySuggestion[];
  suggestionsError: boolean;
  suggestionsLoading: boolean;
  summaryMap: Record<string, SummaryState>;
  visitorHistoryList: VisitorHistorySession[];
  visitorHistoryLoading: boolean;
}>();

const emit = defineEmits<{
  applySuggestion: [content: string];
  insertSuggestion: [content: string];
  openHistoryDrawer: [];
  refreshSuggestions: [];
  refreshSuggestionsWithPrompt: [prompt: string];
}>();

function formatShortDate(isoString: string | undefined): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}
</script>

<template>
  <aside
    class="flex h-full flex-col gap-3.5 overflow-y-auto bg-white p-4"
    style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
  >
    <!-- ===== 进行中会话视图 ===== -->
    <template v-if="activeSession">
      <!-- Session info card -->
      <div class="rounded-xl bg-[#f7f8fc] p-3.5">
        <div class="flex items-center justify-between">
          <span class="text-[15px] font-medium text-[#0a0a0b]">会话信息</span>
          <span
            class="rounded bg-[#eef1f8] px-2 py-0.5 text-[12px] text-[#1a73e8]"
            >进行中</span
          >
        </div>

        <div class="mt-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[13px] text-[#52525b]">访客姓名</span>
            <span class="text-[13px] font-medium text-[#0a0a0b]">{{
              activeSession.name
            }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[13px] text-[#52525b]">会话编号</span>
            <span class="text-[13px] font-medium text-[#0a0a0b]">{{
              activeSession.sessionCode
            }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[13px] text-[#52525b]">问题标签</span>
            <span
              class="rounded px-2 py-0.5 text-[11px]"
              :style="
                resolveTagColor(activeSession.tag) === 'red'
                  ? 'background:#fff1f0;color:#cf1322'
                  : resolveTagColor(activeSession.tag) === 'orange'
                    ? 'background:#fff7e6;color:#d46b08'
                    : 'background:#e8f0ff;color:#1a73e8'
              "
            >
              {{ activeSession.tag || '未标记' }}
            </span>
          </div>
        </div>

        <!-- Stats row -->
        <div class="mt-3 flex gap-2">
          <div class="flex flex-1 flex-col gap-0.5 rounded-lg bg-white p-2.5">
            <span class="text-[11px] text-[#9ca3af]">排队时长</span>
            <span class="text-[14px] font-semibold text-[#0a0a0b]">
              {{
                activeSession.waitSince > 0
                  ? formatWaitTime(activeSession.waitSince)
                  : '—'
              }}
            </span>
          </div>
          <div class="flex flex-1 flex-col gap-0.5 rounded-lg bg-white p-2.5">
            <span class="text-[11px] text-[#9ca3af]">消息数</span>
            <span class="text-[14px] font-semibold text-[#0a0a0b]">
              {{ activeSession.msgs.filter((m) => m.role !== 'agent').length }}
            </span>
          </div>
          <div class="flex flex-1 flex-col gap-0.5 rounded-lg bg-white p-2.5">
            <span class="text-[11px] text-[#9ca3af]">接入状态</span>
            <span class="text-[13px] font-medium text-[#1a73e8]">进行中</span>
          </div>
        </div>
      </div>

      <div class="h-px w-full bg-[#e4e7ed]"></div>

      <!-- Transfer reason -->
      <div class="flex flex-col gap-2">
        <span class="text-[14px] font-medium text-[#0a0a0b]">转接原因</span>
        <div class="flex items-start gap-2.5 rounded-lg bg-[#fff0eb] p-3">
          <div
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fff2c7] text-[14px]"
          >
            💡
          </div>
          <p class="text-[12px] leading-[1.5] text-[#923b0e]">
            {{ activeSession.transferReason || '用户主动请求转人工' }}
          </p>
        </div>
      </div>

      <!-- History sessions -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-[14px] font-medium text-[#0a0a0b]">历史会话</span>
          <span
            class="rounded-[9px] bg-[#f7f8fc] px-2 py-0.5 text-[12px] text-[#52525b]"
          >
            {{ visitorHistoryList.length }} 条记录
          </span>
        </div>

        <!-- Preview: latest 2 entries -->
        <div
          v-if="!visitorHistoryLoading && visitorHistoryList.length > 0"
          class="space-y-1.5"
        >
          <div
            v-for="item in visitorHistoryList.slice(0, 2)"
            :key="item.sessionId"
            class="flex items-center gap-1.5 rounded-lg bg-[#f7f8fc] px-2.5 py-2 text-[12px]"
          >
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              :style="
                resolveTagColor(item.tag) === 'red'
                  ? 'background:#fff1f0;color:#cf1322'
                  : resolveTagColor(item.tag) === 'orange'
                    ? 'background:#fff7e6;color:#d46b08'
                    : 'background:#e8f0ff;color:#1a73e8'
              "
              >{{ item.tag }}</span
            >
            <span class="min-w-0 flex-1 truncate text-[#52525b]">{{
              item.transferReason
            }}</span>
            <span class="shrink-0 text-[#9ca3af]">{{
              formatShortDate(item.endedAt)
            }}</span>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-else-if="!visitorHistoryLoading"
          class="flex items-center gap-3 rounded-xl bg-[#fafbff] p-3.5"
        >
          <div
            class="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0f2f5] text-[16px]"
          >
            💬
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-medium text-[#0a0a0b]">暂无历史会话</p>
            <p class="mt-0.5 text-[11px] text-[#9ca3af]">
              该访客此前未发起过会话
            </p>
          </div>
        </div>

        <Button
          block
          size="small"
          :loading="visitorHistoryLoading"
          class="mt-0.5"
          @click="emit('openHistoryDrawer')"
        >
          <template #icon><Icon icon="lucide:history" /></template>
          查看全部会话
        </Button>
      </div>

      <!-- AI suggest panel (fills remaining space) -->
      <AISuggestPanel
        :session-id="activeSession.id"
        :suggestions="replySuggestions"
        :loading="suggestionsLoading"
        :has-error="suggestionsError"
        class="min-h-0 flex-1"
        @apply="emit('applySuggestion', $event)"
        @insert="emit('insertSuggestion', $event)"
        @refresh="emit('refreshSuggestions')"
        @refresh-with-prompt="emit('refreshSuggestionsWithPrompt', $event)"
      />
    </template>

    <!-- ===== 已结束 / AI 旁观 只读信息 ===== -->
    <template v-else-if="closedView">
      <div class="rounded-xl bg-[#f7f8fc] p-3.5">
        <div class="flex items-center justify-between">
          <span class="text-[15px] font-medium text-[#0a0a0b]">会话信息</span>
          <span
            v-if="closedView.kind === 'ai'"
            class="rounded bg-[#e8f0ff] px-2 py-0.5 text-[12px] text-[#1a73e8]"
            >AI 处理中</span
          >
          <span
            v-else
            class="rounded bg-[#f0f2f5] px-2 py-0.5 text-[12px] text-[#9ca3af]"
            >已结束</span
          >
        </div>
        <div class="mt-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[13px] text-[#52525b]">访客姓名</span>
            <span class="text-[13px] font-medium text-[#0a0a0b]">{{
              closedView.session.name
            }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[13px] text-[#52525b]">会话编号</span>
            <span class="text-[13px] font-medium text-[#0a0a0b]"
              >#{{ closedView.session.id }}</span
            >
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[13px] text-[#52525b]">问题标签</span>
            <span
              class="rounded bg-[#f0f2f5] px-2 py-0.5 text-[11px] text-[#9ca3af]"
            >
              {{ closedView.session.tag || '未标记' }}
            </span>
          </div>
          <div
            v-if="closedView.kind !== 'ai'"
            class="flex items-center justify-between"
          >
            <span class="text-[13px] text-[#52525b]">结束时间</span>
            <span class="text-[13px] font-medium text-[#0a0a0b]">{{
              closedView.session.endedAt
            }}</span>
          </div>
        </div>
      </div>
      <div class="h-px w-full bg-[#e4e7ed]"></div>
      <div class="flex flex-col gap-2">
        <span class="text-[14px] font-medium text-[#0a0a0b]">转接原因</span>
        <div class="flex items-start gap-2.5 rounded-lg bg-[#fff0eb] p-3">
          <div
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fff2c7] text-[14px]"
          >
            💡
          </div>
          <p class="text-[12px] leading-[1.5] text-[#923b0e]">
            {{ closedView.session.transferReason || '—' }}
          </p>
        </div>
      </div>
    </template>
  </aside>
</template>
