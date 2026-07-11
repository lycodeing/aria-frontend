<script lang="ts" setup>
import type { TimeRange } from '#/api/dashboard';

import { RadioButton, RadioGroup } from 'ant-design-vue';

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
  <RadioGroup
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
    <RadioButton v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </RadioButton>
  </RadioGroup>
</template>
