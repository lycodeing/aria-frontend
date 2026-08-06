<script lang="ts" setup>
import { computed } from 'vue';

import { Icon } from '@iconify/vue';

const props = withDefaults(
  defineProps<{
    icon: string;
    label: string;
    tone?: 'amber' | 'blue' | 'emerald' | 'red' | 'violet';
    value: number | string;
  }>(),
  { tone: 'blue' },
);

/** 图标底色 + 图标色，按 tone 取 tailwind 类 */
const toneClass = computed(() => {
  const map: Record<
    'amber' | 'blue' | 'emerald' | 'red' | 'violet',
    { bg: string; text: string }
  > = {
    amber: { bg: 'bg-amber-50 dark:bg-amber-500/15', text: 'text-amber-500' },
    blue: { bg: 'bg-blue-50 dark:bg-blue-500/15', text: 'text-blue-500' },
    emerald: {
      bg: 'bg-emerald-50 dark:bg-emerald-500/15',
      text: 'text-emerald-500',
    },
    red: { bg: 'bg-red-50 dark:bg-red-500/15', text: 'text-red-500' },
    violet: {
      bg: 'bg-violet-50 dark:bg-violet-500/15',
      text: 'text-violet-500',
    },
  };
  return map[props.tone];
});
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
  >
    <div
      class="flex h-10 w-10 items-center justify-center rounded-lg"
      :class="toneClass.bg"
    >
      <Icon :icon="icon" class="text-[18px]" :class="toneClass.text" />
    </div>
    <div>
      <div
        class="text-[20px] font-bold leading-tight text-slate-800 dark:text-slate-100"
      >
        {{ value }}
      </div>
      <div class="text-[12px] text-slate-500 dark:text-slate-400">
        {{ label }}
      </div>
    </div>
  </div>
</template>
