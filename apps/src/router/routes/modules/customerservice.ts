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
        name: 'CustomerServiceConfig',
        path: '/customerservice/config',
        component: () => import('#/views/system/config/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          configType: 'CUSTOMER_SERVICE',
          icon: 'lucide:settings-2',
          title: '客服配置',
        },
      },
      {
        name: 'CustomerServiceCannedResponse',
        path: '/customerservice/canned-response',
        component: () =>
          import('#/views/customerservice/canned-response/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:message-square-text',
          title: '快捷回复',
        },
      },
      {
        name: 'CustomerServiceBusinessHours',
        path: '/customerservice/business-hours',
        component: () =>
          import('#/views/customerservice/business-hours/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:clock',
          title: '业务时间',
        },
      },
      {
        name: 'CustomerServiceDIT',
        path: '/customerservice/dit',
        meta: {
          icon: 'lucide:settings-2',
          order: 40,
          title: 'DIT配置',
        },
        children: [
          {
            name: 'CustomerServiceDITDomains',
            path: '/customerservice/dit/domains',
            component: () =>
              import('#/views/customerservice/dit/domains/index.vue'),
            meta: {
              authority: ['super_admin', 'kf_manager'],
              icon: 'lucide:layers',
              title: '领域与意图',
            },
          },
          {
            name: 'CustomerServiceDITTools',
            path: '/customerservice/dit/tools',
            component: () =>
              import('#/views/customerservice/dit/tools/index.vue'),
            meta: {
              authority: ['super_admin', 'kf_manager'],
              icon: 'lucide:wrench',
              title: '工具注册中心',
            },
          },
        ],
      },
    ],
  },
];

export default routes;
