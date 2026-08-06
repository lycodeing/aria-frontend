import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

/**
 * 观测统计模块路由。
 *   - super_admin / kf_manager 可访问
 *
 * 注意：菜单为后端 DB 驱动，侧边栏显示还需在后端补充对应菜单行，
 * 其 component 路径需与此处视图路径一致。
 */
const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:activity',
      order: 25,
      title: $t('page.stats.title'),
    },
    name: 'Stats',
    path: '/stats',
    children: [
      {
        name: 'StatsIntent',
        path: '/stats/intent',
        component: () => import('#/views/stats/intent/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:git-branch',
          title: $t('page.stats.intent'),
        },
      },
      {
        name: 'StatsRag',
        path: '/stats/rag',
        component: () => import('#/views/stats/rag/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:database',
          title: $t('page.stats.rag'),
        },
      },
      {
        name: 'StatsLlmCost',
        path: '/stats/llm-cost',
        component: () => import('#/views/stats/llm-cost/index.vue'),
        meta: {
          authority: ['super_admin', 'kf_manager'],
          icon: 'lucide:coins',
          title: $t('page.stats.llmCost'),
        },
      },
    ],
  },
];

export default routes;
