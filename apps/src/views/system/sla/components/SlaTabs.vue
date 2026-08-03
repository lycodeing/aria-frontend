<script lang="ts" setup>
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { TabPane, Tabs } from 'ant-design-vue';

/**
 * SLA 管理子页签导航：SLA 策略 / Webhook 配置 / 违规记录。
 *
 * <p>三个子页面共用此组件，通过路由路径切换；当前路由不在三者内时回退到策略页。
 * 路由配置中 webhooks/breaches 均为 hideInMenu（作为本页内 tab 展示），
 * 此组件即它们的唯一菜单入口。
 */
const route = useRoute();
const router = useRouter();

const tabItems = [
  { key: '/system/sla', label: 'SLA 策略' },
  { key: '/system/sla/webhooks', label: 'Webhook 配置' },
  { key: '/system/sla/breaches', label: '违规记录' },
];

const activeKey = ref(route.path);

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
