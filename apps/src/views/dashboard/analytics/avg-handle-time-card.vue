<script lang="ts" setup>
defineProps<{
  /** 平均处理时长（秒），来自 overviewData.avgHandleSeconds */
  seconds: number;
}>();
</script>

<template>
  <div
    class="flex h-full flex-col rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
  >
    <p class="mb-3 text-sm font-medium">平均处理时长</p>
    <div class="flex flex-1 flex-col items-center justify-center">
      <p class="text-4xl font-semibold leading-none tabular-nums">
        {{ (seconds / 60).toFixed(1) }}
        <span class="ml-1 text-base font-normal text-muted-foreground"
          >分钟</span
        >
      </p>
      <p class="mt-3 text-xs text-muted-foreground">基于已结束会话均值</p>
    </div>
  </div>
</template>
