<script lang="ts" setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { TabPane, Tabs } from 'ant-design-vue';

/**
 * SLA 管理子页签导航：SLA 策略 / 违规记录。
 *
 * <p>Webhook 配置已独立为系统级菜单，不再作为 SLA 子页签。
 *
 * <p>⚠️ 后端为 backend 权限模式（见 apps/src/preferences.ts accessMode），
 * 菜单路由由数据库 cs_auth.sys_menu 动态生成，本组件硬编码的两个 path
 * 必须与 sys_menu.path 字段保持一致（对应 id=206 / id=246），
 * 若在菜单管理页修改了这两条记录的 path，需同步修改此处。
 */
const route = useRoute();
const router = useRouter();

const tabItems = [
  { key: '/session/sla', label: 'SLA 策略' },
  { key: '/session/breaches', label: '违规记录' },
];

const activeKey = computed(() =>
  tabItems.some((t) => t.key === route.path) ? route.path : '/session/sla',
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
