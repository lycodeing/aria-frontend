import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

/**
 * 智能客服模块路由。
 * meta.authority 控制路由级访问权限，防止非授权角色通过 URL 直接访问。
 *   - super_admin: 全部可访问
 *   - kf_manager:  对话、知识库、座席工作台
 *   - kf_staff:    仅对话
 */
const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:bot',
      order: 10,
      title: $t('page.customerservice.title'),
    },
    name: 'CustomerService',
    path: '/customerservice',
    children: [
      {
        name: 'CustomerServiceChat',
        path: '/customerservice/chat',
        component: () => import('#/views/customerservice/chat/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager', 'kf_staff'],
          icon: 'lucide:message-circle',
          title: $t('page.customerservice.chat'),
        },
      },
      {
        name: 'CustomerServiceKnowledge',
        path: '/customerservice/knowledge',
        component: () => import('#/views/customerservice/knowledge/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:book-open',
          title: $t('page.customerservice.knowledge'),
        },
      },
      {
        name: 'CustomerServiceAgent',
        path: '/customerservice/agent',
        component: () => import('#/views/customerservice/agent/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:headphones',
          title: $t('page.customerservice.agent'),
        },
      },
      {
        name: 'CustomerServiceAiModels',
        path: '/customerservice/ai-models',
        component: () => import('#/views/customerservice/ai-models/index.vue'),
        meta: {
          authority: ['super_admin'],
          icon: 'lucide:cpu',
          title: $t('page.customerservice.aiModels'),
        },
      },
    ],
  },
];

export default routes;
