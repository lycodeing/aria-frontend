<script lang="ts" setup>
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { TabPane, Tabs } from 'ant-design-vue';

/**
 * SLA 管理子页签导航：SLA 策略 / 违规记录。
 *
 * <p>Webhook 配置已独立为系统级菜单，不再作为 SLA 子页签。
 */
const route = useRoute();
const router = useRouter();

const tabItems = [
  { key: '/system/sla', label: 'SLA 策略' },
  { key: '/system/sla/breaches', label: '违规记录' },
];

const activeKey = ref(
  tabItems.some((t) => t.key === route.path) ? route.path : '/system/sla',
);

watch(
  () => route.path,
  (path) => {
    activeKey.value = tabItems.some((t) => t.key === path)
      ? path
      : '/system/sla';
  },
  { immediate: true },
);

function onChange(key: number | string) {
  const target = String(key);
  if (target !== route.path) {
    router.push(target);
  }
}
</script>

<template>
  <Tabs
    :active-key="activeKey"
    class="sla-tabs"
    style="margin-bottom: 8px"
    @change="onChange"
  >
    <TabPane v-for="item in tabItems" :key="item.key" :tab="item.label" />
  </Tabs>
</template>
