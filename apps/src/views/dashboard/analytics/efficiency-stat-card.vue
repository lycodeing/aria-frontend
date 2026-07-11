<script lang="ts" setup>
defineProps<{
  /** 指标名称，如"平均等待时长" */
  title: string;
  /** 已格式化的值字符串，如"45秒"或"--" */
  value: string;
}>();
</script>

<template>
  <div class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
    <p class="text-muted-foreground text-sm">{{ title }}</p>
    <p class="mt-1 text-2xl font-semibold tabular-nums">{{ value }}</p>
  </div>
</template>
