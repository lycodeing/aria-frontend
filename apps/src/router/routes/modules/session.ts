import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

/**
 * 会话管理模块路由。
 *   - super_admin: 全部可访问
 *   - kf_manager:  座席工作台、SLA、Webhook、违规记录、会话查询
 *   - kf_staff:    座席工作台
 */
const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:messages-square',
      order: 20,
      title: $t('page.session.title'),
    },
    name: 'Session',
    path: '/session',
    children: [
      {
        name: 'SessionAgent',
        path: '/session/agent',
        component: () => import('#/views/session/agent/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager', 'kf_staff'],
          icon: 'lucide:headphones',
          title: $t('page.session.agent'),
        },
      },
      {
        name: 'SessionHistory',
        path: '/session/history',
        component: () => import('#/views/_core/fallback/coming-soon.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:message-square',
          title: $t('page.session.history'),
        },
      },
    ],
  },
];

export default routes;
