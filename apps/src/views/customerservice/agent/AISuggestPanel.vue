<script setup lang="ts">
import type { ReplySuggestion } from '#/api/session';

import { computed, ref } from 'vue';

import { Icon } from '@iconify/vue';
import { Button, Skeleton } from 'ant-design-vue';

const props = defineProps<{
  hasError: boolean;
  loading: boolean;
  sessionId: string;
  suggestions: ReplySuggestion[];
}>();

const emit = defineEmits<{
  apply: [content: string];
  refresh: [];
  refreshWithPrompt: [prompt: string];
}>();

const counts = [2, 3, 4, 5];
const activeCount = ref(5);
const promptInput = ref('');

const visibleSuggestions = computed(() =>
  props.suggestions.slice(0, activeCount.value),
);
</script>

<template>
  <section class="flex min-h-0 flex-col gap-1.5 rounded-xl bg-[#eef1f8] p-3.5">
    <!-- Header -->
    <div class="flex shrink-0 items-center gap-2">
      <Icon icon="lucide:zap" class="text-[#1a73e8]" />
      <span class="text-[15px] font-medium text-[#0a0a0b]">AI 回复建议</span>
      <Button
        type="text"
        size="small"
        :loading="loading"
        class="ml-auto !text-[#9ca3af] hover:!text-[#1a73e8]"
        title="重新生成"
        @click="emit('refresh')"
      >
        <template #icon>
          <Icon icon="lucide:refresh-cw" />
        </template>
      </Button>
    </div>

    <!-- Count selector -->
    <div class="flex shrink-0 items-center justify-between">
      <span class="text-[13px] text-[#9ca3af]">显示条数</span>
      <div class="flex items-center gap-1">
        <button
          v-for="c in counts"
          :key="c"
          class="h-6 w-7 rounded-md text-[13px] transition-colors"
          :class="
            activeCount === c
              ? 'bg-[#1a73e8] text-white'
              : 'bg-transparent text-[#52525b] hover:bg-white'
          "
          @click="activeCount = c"
        >
          {{ c }}
        </button>
      </div>
    </div>

    <!-- Suggestion list -->
    <div
      class="min-h-0 flex-1 space-y-2 overflow-y-auto py-1"
      style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
    >
      <!-- Loading skeleton -->
      <template v-if="loading">
        <div v-for="i in 3" :key="i" class="rounded-lg bg-white p-3">
          <Skeleton :active="true" :title="false" :paragraph="{ rows: 2 }" />
        </div>
      </template>

      <!-- Error state -->
      <div
        v-else-if="hasError"
        class="flex flex-col items-center justify-center py-4 text-center"
      >
        <Icon icon="lucide:alert-circle" class="mb-2 text-xl text-red-300" />
        <p class="text-[12px] text-red-400">生成失败</p>
        <button
          class="mt-1 text-[12px] text-[#1a73e8] hover:underline"
          @click="emit('refresh')"
        >
          点击重试
        </button>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="suggestions.length === 0"
        class="flex flex-col items-center justify-center py-4 text-center"
      >
        <Icon
          icon="lucide:message-square-dashed"
          class="mb-2 text-xl text-[#d4d8e3]"
        />
        <p class="text-[12px] text-[#9ca3af]">等待访客发送消息后自动生成…</p>
      </div>

      <!-- Suggestion cards -->
      <template v-else>
        <div
          v-for="item in visibleSuggestions"
          :key="item.id"
          class="group cursor-pointer rounded-lg bg-white p-3 transition-colors hover:bg-[#f5fafe]"
          @click="emit('apply', item.content)"
        >
          <p class="text-[12px] leading-[1.6] text-[#0a0a0b]">
            {{ item.content }}
          </p>
          <div
            class="mt-2 flex items-center gap-1.5 rounded-[5px] bg-[#f0f4ff] px-2 py-1.5"
          >
            <span
              class="text-[10px] font-medium"
              :class="
                item.source === 'KB' ? 'text-[#1a73e8]' : 'text-[#8b5cf6]'
              "
            >
              {{ item.source === 'KB' ? '知识库' : '上下文' }}
            </span>
            <span class="text-[10px] text-[#9ca3af]">· 点击填入输入框</span>
          </div>
        </div>
      </template>
    </div>

    <!-- Floating footer input -->
    <div
      class="flex shrink-0 items-center gap-2 rounded-[10px] bg-white p-2 shadow-[0_-3px_12px_rgba(0,0,0,0.08)]"
    >
      <input
        v-model="promptInput"
        type="text"
        placeholder="如：语气更正式 / 引用退换货政策"
        class="h-[34px] flex-1 rounded-lg bg-[#f7f8fc] px-2.5 text-[13px] text-[#0a0a0b] outline-none placeholder:text-[#9ca3af] focus:ring-1 focus:ring-[#1a73e8]"
      />
      <button
        class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[#1a73e8] text-white hover:opacity-90"
        @click="
          () => {
            if (promptInput.trim()) {
              emit('refreshWithPrompt', promptInput.trim());
              promptInput = '';
            } else {
              emit('refresh');
            }
          }
        "
      >
        <Icon icon="ant-design:send-outlined" style="font-size: 15px" />
      </button>
    </div>
  </section>
</template>
