<script lang="ts" setup>
import type { StatsPeriod } from '#/api/stats';

const props = defineProps<{ value: StatsPeriod }>();
const emit = defineEmits<{ 'update:value': [StatsPeriod] }>();

const presets: { key: StatsPeriod; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: '7d', label: '近7天' },
  { key: '30d', label: '近30天' },
];

function pick(key: StatsPeriod) {
  if (key !== props.value) emit('update:value', key);
}
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      v-for="p in presets"
      :key="p.key"
      type="button"
      class="h-7 rounded-md px-3 text-[12px] font-medium transition-colors"
      :class="
        value === p.key
          ? 'bg-blue-500 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300'
      "
      @click="pick(p.key)"
    >
      {{ p.label }}
    </button>
  </div>
</template>
