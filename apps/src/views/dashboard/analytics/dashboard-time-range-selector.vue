<script lang="ts" setup>
import type { TimeRange } from '#/api/dashboard';

defineProps<{ modelValue: TimeRange }>();
defineEmits<{ 'update:modelValue': [val: TimeRange] }>();

const options = [
  { label: '本月', value: 'month' },
  { label: '本周', value: 'week' },
  { label: '近7天', value: 'days7' },
  { label: '近30天', value: 'days30' },
] as const satisfies ReadonlyArray<{ label: string; value: TimeRange }>;
</script>

<template>
  <a-radio-group
    :value="modelValue"
    button-style="solid"
    size="small"
    @change="
      $emit(
        'update:modelValue',
        ($event.target as HTMLInputElement).value as TimeRange,
      )
    "
  >
    <a-radio-button v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </a-radio-button>
  </a-radio-group>
</template>
