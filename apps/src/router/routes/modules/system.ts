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
        name: 'SystemAiModel',
        path: '/system/ai-model',
        component: () => import('#/views/system/ai-model/index.vue'),
        meta: {
          authority: ['super_admin'],
          icon: 'lucide:cpu',
          title: 'AI 模型配置',
        },
      },
    ],
  },
];

export default routes;
