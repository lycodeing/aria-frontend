import type { RouteRecordRaw } from 'vue-router';

/**
 * 系统管理模块路由。
 * meta.authority 限制仅 super_admin 可访问。
 * kf_manager 和 kf_staff 强制导航到此路由将被拦截至 403。
 */
const routes: RouteRecordRaw[] = [
  {
    meta: {
      authority: ['super_admin'],
      icon: 'lucide:settings',
      order: 90,
      title: '系统管理',
    },
    name: 'System',
    path: '/system',
    children: [
      {
        name: 'SystemUser',
        path: '/system/user',
        component: () => import('#/views/system/user/index.vue'),
        meta: {
          authority: ['super_admin'],
          icon: 'lucide:users',
          title: '用户管理',
        },
      },
      {
        name: 'SystemRole',
        path: '/system/role',
        component: () => import('#/views/system/role/index.vue'),
        meta: {
          authority: ['super_admin'],
          icon: 'lucide:shield',
          title: '角色管理',
        },
      },
      {
        name: 'SystemMenu',
        path: '/system/menu',
        component: () => import('#/views/system/menu/index.vue'),
        meta: {
          authority: ['super_admin'],
          icon: 'lucide:layout-list',
          title: '菜单管理',
        },
      },
      {
        name: 'SystemAiModel',
        path: '/system/ai-model',
        component: () => import('#/views/system/ai-model/index.vue'),
        meta: {
          authority: ['super_admin'],
          icon: 'lucide:cpu',
          title: 'AI 模型配置',
        },
      },
      {
        name: 'SystemConfig',
        path: '/system/config',
        component: () => import('#/views/system/config/index.vue'),
        meta: {
          authority: ['super_admin'],
          configType: 'SYSTEM',
          icon: 'lucide:settings',
          title: '系统配置',
        },
      },
      {
        name: 'SystemTags',
        path: '/system/tags',
        component: () => import('#/views/system/tags/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:tag',
          title: '标签字典',
        },
      },
      {
        name: 'SystemSla',
        path: '/system/sla',
        component: () => import('#/views/system/sla/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:gauge',
          title: 'SLA 管理',
        },
      },
      {
        name: 'SystemSlaWebhooks',
        path: '/system/sla/webhooks',
        component: () => import('#/views/system/sla/webhook.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:webhook',
          title: 'Webhook 配置',
          hideInMenu: true, // shown as tab within SLA page, not separate menu item
        },
      },
      {
        name: 'SystemSlaBreaches',
        path: '/system/sla/breaches',
        component: () => import('#/views/system/sla/breaches.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:alert-triangle',
          title: 'SLA 违规记录',
          hideInMenu: true, // shown as tab within SLA page
        },
      },
    ],
  },
];

export default routes;
