<script lang="ts" setup>
import type { SessionMessage, SessionRecord } from '#/api/session/index';

import { ref, watch } from 'vue';

import { Icon } from '@iconify/vue';
import { Drawer, message, Spin, Tag } from 'ant-design-vue';

import { getAiSummaryApi, getSessionMessagesApi } from '#/api/session/index';

import {
  CLOSED_BY_MAP,
  formatDuration,
  formatMsgTime,
  formatTime,
  ROLE_META,
  STATUS_MAP,
  tagColor,
} from '../constants';

const props = defineProps<{
  open: boolean;
  record: null | SessionRecord;
  sessionId: string;
}>();

const emit = defineEmits<{
  'update:open': [val: boolean];
}>();

const loading = ref(false);
const msgs = ref<SessionMessage[]>([]);
const aiSummary = ref<null | string>(null);

async function loadDetail(sessionId: string) {
  loading.value = true;
  msgs.value = [];
  aiSummary.value = null;
  try {
    const [messages, summaryRes] = await Promise.all([
      getSessionMessagesApi(sessionId).catch(() => []),
      getAiSummaryApi(sessionId).catch(() => null),
    ]);
    msgs.value = messages.filter((m) => m.content);
    aiSummary.value = summaryRes?.summary ?? null;
  } catch {
    message.error('会话详情加载失败，请重试');
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.sessionId] as const,
  ([isOpen, sid]) => {
    if (isOpen && sid) {
      loadDetail(sid);
    }
  },
);

function closeDrawer() {
  emit('update:open', false);
}
</script>

<template>
  <Drawer
    :open="props.open"
    title="会话详情"
    placement="right"
    width="640"
    :body-style="{
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }"
    @close="closeDrawer"
  >
    <!-- ① 基础信息（内容撑高，不滚动） -->
    <div
      v-if="props.record"
      class="shrink-0 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-800"
    >
      <!-- 访客名称作为标题 -->
      <div class="mb-3 flex items-center gap-2">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-lg text-[14px] font-semibold text-white"
          :style="{
            background: `hsl(${(props.record.sessionId.charCodeAt(0) * 7) % 360}, 60%, 55%)`,
          }"
        >
          {{ props.record.visitorName?.charAt(0) ?? '?' }}
        </div>
        <div class="min-w-0 flex-1">
          <div
            class="text-[15px] font-semibold text-slate-800 dark:text-slate-100"
          >
            {{ props.record.visitorName }}
          </div>
          <div class="mt-0.5 flex items-center gap-1.5">
            <Tag
              :color="STATUS_MAP[props.record.status]?.color ?? 'default'"
              class="!text-[10px] !leading-none"
            >
              {{
                STATUS_MAP[props.record.status]?.label ?? props.record.status
              }}
            </Tag>
            <Tag
              v-if="props.record.tag"
              :color="tagColor(props.record.tag)"
              class="!text-[10px] !leading-none"
            >
              {{ props.record.tag }}
            </Tag>
          </div>
        </div>
      </div>

      <!-- 信息网格 -->
      <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div class="flex items-center gap-1.5 text-[13px]">
          <span class="shrink-0 text-slate-400">客服</span>
          <span
            v-if="props.record.agentName"
            class="font-medium text-slate-700 dark:text-slate-200"
            >{{ props.record.agentName }}</span
          >
          <Tag v-else color="blue" class="!text-[10px]">AI</Tag>
        </div>
        <div class="flex items-center gap-1.5 text-[13px]">
          <span class="shrink-0 text-slate-400">结束方</span>
          <Tag
            v-if="props.record.closedBy"
            :color="CLOSED_BY_MAP[props.record.closedBy]?.color ?? 'default'"
            class="!text-[10px] !leading-none"
          >
            {{
              CLOSED_BY_MAP[props.record.closedBy]?.label ??
              props.record.closedBy
            }}
          </Tag>
          <span v-else class="text-slate-300">—</span>
        </div>
        <div class="flex items-center gap-1.5 text-[13px]">
          <span class="shrink-0 text-slate-400">开始</span>
          <span class="text-slate-600 dark:text-slate-300">{{
            formatTime(props.record.startedAt)
          }}</span>
        </div>
        <div class="flex items-center gap-1.5 text-[13px]">
          <span class="shrink-0 text-slate-400">结束</span>
          <span class="text-slate-600 dark:text-slate-300">{{
            formatTime(props.record.endedAt)
          }}</span>
        </div>
        <div class="flex items-center gap-1.5 text-[13px]">
          <span class="shrink-0 text-slate-400">时长</span>
          <span class="font-medium text-slate-600 dark:text-slate-300">{{
            formatDuration(props.record.durationSec)
          }}</span>
        </div>
        <div class="flex items-center gap-1.5 text-[13px]">
          <span class="shrink-0 text-slate-400">消息数</span>
          <span class="font-medium text-slate-600 dark:text-slate-300">{{
            props.record.msgCount
          }}</span>
        </div>
      </div>

      <!-- 转接原因 -->
      <div
        v-if="props.record.transferReason"
        class="mt-2 flex items-start gap-1.5 text-[12px] text-slate-500 dark:text-slate-400"
      >
        <Icon
          icon="lucide:corner-down-right"
          class="mt-0.5 shrink-0 text-[11px]"
        />
        <span>转接原因：{{ props.record.transferReason }}</span>
      </div>
    </div>

    <!-- ② 对话记录（中间区域，内容多时独立滚动） -->
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        class="flex shrink-0 items-center gap-1.5 border-y border-slate-100 bg-slate-50 px-5 py-2.5 dark:border-slate-700 dark:bg-slate-800/50"
      >
        <Icon icon="lucide:message-square" class="text-[14px] text-slate-500" />
        <span
          class="text-[13px] font-semibold text-slate-700 dark:text-slate-200"
          >对话记录</span
        >
        <span v-if="msgs.length" class="ml-auto text-[11px] text-slate-400"
          >{{ msgs.length }} 条</span
        >
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <Spin :spinning="loading">
          <div v-if="msgs.length" class="space-y-3 px-5 py-4">
            <div v-for="(msg, idx) in msgs" :key="idx" class="flex gap-2.5">
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                :style="{ background: ROLE_META[msg.role]?.bg ?? '#f3f4f6' }"
              >
                <Icon
                  :icon="ROLE_META[msg.role]?.icon ?? 'lucide:user'"
                  class="text-[14px]"
                  :style="{ color: ROLE_META[msg.role]?.color ?? '#6b7280' }"
                />
              </div>
              <div class="min-w-0 flex-1">
                <div class="mb-0.5 flex items-center gap-2">
                  <span
                    class="text-[12px] font-medium text-slate-600 dark:text-slate-300"
                  >
                    {{ ROLE_META[msg.role]?.label ?? msg.role }}
                  </span>
                  <span v-if="msg.timestamp" class="text-[11px] text-slate-400">
                    {{ formatMsgTime(Number(msg.timestamp)) }}
                  </span>
                  <Tag v-if="msg.toolName" color="purple" class="!text-[10px]">
                    {{ msg.toolName }}
                  </Tag>
                </div>
                <div
                  class="rounded-lg px-3 py-2 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200"
                  :style="{ background: ROLE_META[msg.role]?.bg ?? '#f3f4f6' }"
                >
                  {{ msg.content }}
                </div>
              </div>
            </div>
          </div>

          <div
            v-else-if="!loading"
            class="flex items-center justify-center py-12 text-[13px] text-slate-400"
          >
            暂无对话记录
          </div>
        </Spin>
      </div>
    </div>

    <!-- ③ AI 摘要（内容撑高，不滚动） -->
    <div
      v-if="aiSummary"
      class="shrink-0 border-t border-slate-200 bg-amber-50 px-5 py-3 dark:border-slate-700 dark:bg-amber-900/10"
    >
      <div
        class="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-amber-700 dark:text-amber-300"
      >
        <Icon icon="lucide:sparkles" class="text-[15px]" />
        AI 摘要
      </div>
      <div
        class="text-[13px] leading-relaxed text-amber-900 dark:text-amber-200"
      >
        {{ aiSummary }}
      </div>
    </div>
  </Drawer>
</template>
