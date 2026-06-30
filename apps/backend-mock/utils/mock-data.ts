export interface UserInfo {
  id: number;
  password: string;
  realName: string;
  roles: string[];
  username: string;
  homePath?: string;
}

export interface TimezoneOption {
  offset: number;
  timezone: string;
}

export const MOCK_USERS: UserInfo[] = [
  {
    id: 0,
    password: '123456',
    realName: 'Vben',
    roles: ['super'],
    username: 'vben',
  },
  {
    id: 1,
    password: '123456',
    realName: 'Admin',
    roles: ['admin'],
    username: 'admin',
    homePath: '/workspace',
  },
  {
    id: 2,
    password: '123456',
    realName: 'Jack',
    roles: ['user'],
    username: 'jack',
    homePath: '/analytics',
  },
  // ===== 智能客服多角色测试用户 =====
  {
    id: 10,
    password: 'Test@123456',
    realName: '超级管理员',
    roles: ['super_admin'],
    username: 'superadmin',
    homePath: '/analytics',
  },
  {
    id: 11,
    password: 'Test@123456',
    realName: '客服管理员',
    roles: ['kf_manager'],
    username: 'kfmanager',
    homePath: '/customerservice/chat',
  },
  {
    id: 12,
    password: 'Test@123456',
    realName: '普通客服',
    roles: ['kf_staff'],
    username: 'kfstaff',
    homePath: '/customerservice/chat',
  },
];

export const MOCK_CODES = [
  // super
  {
    codes: ['AC_100100', 'AC_100110', 'AC_100120', 'AC_100010'],
    username: 'vben',
  },
  {
    // admin
    codes: ['AC_100010', 'AC_100020', 'AC_100030'],
    username: 'admin',
  },
  {
    // user
    codes: ['AC_1000001', 'AC_1000002'],
    username: 'jack',
  },
  // ===== 智能客服测试用户权限码 =====
  {
    // 超级管理员：全部按钮权限
    username: 'superadmin',
    codes: [
      'knowledge:doc:upload', 'knowledge:doc:review', 'knowledge:doc:offline', 'knowledge:doc:delete',
      'agent:session:accept', 'agent:session:close', 'agent:session:transfer',
      'system:user:create', 'system:user:update', 'system:user:delete', 'system:user:reset-pwd', 'system:user:assign-role',
      'system:role:create', 'system:role:update', 'system:role:delete', 'system:role:assign-menu',
    ],
  },
  {
    // 客服管理员：知识库+座席操作权限，无系统管理
    username: 'kfmanager',
    codes: [
      'knowledge:doc:upload', 'knowledge:doc:review', 'knowledge:doc:offline',
      'agent:session:accept', 'agent:session:close', 'agent:session:transfer',
    ],
  },
  {
    // 普通客服：无按钮权限
    username: 'kfstaff',
    codes: [],
  },
];

const dashboardMenus = [
  {
    meta: {
      order: -1,
      title: 'page.dashboard.title',
    },
    name: 'Dashboard',
    path: '/dashboard',
    redirect: '/analytics',
    children: [
      {
        name: 'Analytics',
        path: '/analytics',
        component: '/dashboard/analytics/index',
        meta: {
          affixTab: true,
          title: 'page.dashboard.analytics',
        },
      },
      {
        name: 'Workspace',
        path: '/workspace',
        component: '/dashboard/workspace/index',
        meta: {
          title: 'page.dashboard.workspace',
        },
      },
    ],
  },
];

const createDemosMenus = (role: 'admin' | 'super' | 'user') => {
  const roleWithMenus = {
    admin: {
      component: '/demos/access/admin-visible',
      meta: {
        icon: 'mdi:button-cursor',
        title: 'demos.access.adminVisible',
      },
      name: 'AccessAdminVisibleDemo',
      path: '/demos/access/admin-visible',
    },
    super: {
      component: '/demos/access/super-visible',
      meta: {
        icon: 'mdi:button-cursor',
        title: 'demos.access.superVisible',
      },
      name: 'AccessSuperVisibleDemo',
      path: '/demos/access/super-visible',
    },
    user: {
      component: '/demos/access/user-visible',
      meta: {
        icon: 'mdi:button-cursor',
        title: 'demos.access.userVisible',
      },
      name: 'AccessUserVisibleDemo',
      path: '/demos/access/user-visible',
    },
  };

  return [
    {
      meta: {
        icon: 'ic:baseline-view-in-ar',
        keepAlive: true,
        order: 1000,
        title: 'demos.title',
      },
      name: 'Demos',
      path: '/demos',
      redirect: '/demos/access',
      children: [
        {
          name: 'AccessDemos',
          path: '/demosaccess',
          meta: {
            icon: 'mdi:cloud-key-outline',
            title: 'demos.access.backendPermissions',
          },
          redirect: '/demos/access/page-control',
          children: [
            {
              name: 'AccessPageControlDemo',
              path: '/demos/access/page-control',
              component: '/demos/access/index',
              meta: {
                icon: 'mdi:page-previous-outline',
                title: 'demos.access.pageAccess',
              },
            },
            {
              name: 'AccessButtonControlDemo',
              path: '/demos/access/button-control',
              component: '/demos/access/button-control',
              meta: {
                icon: 'mdi:button-cursor',
                title: 'demos.access.buttonControl',
              },
            },
            {
              name: 'AccessMenuVisible403Demo',
              path: '/demos/access/menu-visible-403',
              component: '/demos/access/menu-visible-403',
              meta: {
                authority: ['no-body'],
                icon: 'mdi:button-cursor',
                menuVisibleWithForbidden: true,
                title: 'demos.access.menuVisible403',
              },
            },
            roleWithMenus[role],
          ],
        },
      ],
    },
  ];
};

// ===== 智能客服菜单定义 =====
const customerServiceMenus = {
  // 完整智能客服菜单（含全部子菜单）
  full: {
    meta: { icon: 'lucide:bot', order: 10, title: '智能客服' },
    name: 'CustomerService',
    path: '/customerservice',
    children: [
      {
        name: 'CustomerServiceChat',
        path: '/customerservice/chat',
        component: '/customerservice/chat/index',
        meta: { icon: 'lucide:message-circle', title: '对话', keepAlive: true },
      },
      {
        name: 'CustomerServiceKnowledge',
        path: '/customerservice/knowledge',
        component: '/customerservice/knowledge/index',
        meta: { icon: 'lucide:book-open', title: '知识库', keepAlive: true },
      },
      {
        name: 'CustomerServiceAgent',
        path: '/customerservice/agent',
        component: '/customerservice/agent/index',
        meta: { icon: 'lucide:headphones', title: '座席工作台', keepAlive: true },
      },
    ],
  },
  // 仅对话（普通客服）
  chatOnly: {
    meta: { icon: 'lucide:bot', order: 10, title: '智能客服' },
    name: 'CustomerService',
    path: '/customerservice',
    children: [
      {
        name: 'CustomerServiceChat',
        path: '/customerservice/chat',
        component: '/customerservice/chat/index',
        meta: { icon: 'lucide:message-circle', title: '对话', keepAlive: true },
      },
    ],
  },
};

const systemMenus = {
  meta: { icon: 'lucide:settings', order: 90, title: '系统管理' },
  name: 'System',
  path: '/system',
  children: [
    {
      name: 'SystemUser',
      path: '/system/user',
      component: '/system/user/index',
      meta: { icon: 'lucide:users', title: '用户管理' },
    },
    {
      name: 'SystemRole',
      path: '/system/role',
      component: '/system/role/index',
      meta: { icon: 'lucide:shield', title: '角色管理' },
    },
  ],
};

export const MOCK_MENUS = [
  {
    menus: [...dashboardMenus, ...createDemosMenus('super')],
    username: 'vben',
  },
  {
    menus: [...dashboardMenus, ...createDemosMenus('admin')],
    username: 'admin',
  },
  {
    menus: [...dashboardMenus, ...createDemosMenus('user')],
    username: 'jack',
  },
  // ===== 智能客服测试用户菜单 =====
  {
    // 超级管理员：仪表板 + 智能客服全部 + 系统管理
    username: 'superadmin',
    menus: [
      ...dashboardMenus,
      customerServiceMenus.full,
      systemMenus,
    ],
  },
  {
    // 客服管理员：智能客服全部（无系统管理、无仪表板）
    username: 'kfmanager',
    menus: [
      customerServiceMenus.full,
    ],
  },
  {
    // 普通客服：仅对话
    username: 'kfstaff',
    menus: [
      customerServiceMenus.chatOnly,
    ],
  },
];

export const MOCK_MENU_LIST = [
  {
    id: 1,
    name: 'Workspace',
    status: 1,
    type: 'menu',
    icon: 'mdi:dashboard',
    path: '/workspace',
    component: '/dashboard/workspace/index',
    meta: {
      icon: 'carbon:workspace',
      title: 'page.dashboard.workspace',
      affixTab: true,
      order: 0,
    },
  },
  {
    id: 2,
    meta: {
      icon: 'carbon:settings',
      order: 9997,
      title: 'system.title',
      badge: 'new',
      badgeType: 'normal',
      badgeVariants: 'primary',
    },
    status: 1,
    type: 'catalog',
    name: 'System',
    path: '/system',
    children: [
      {
        id: 201,
        pid: 2,
        path: '/system/menu',
        name: 'SystemMenu',
        authCode: 'System:Menu:List',
        status: 1,
        type: 'menu',
        meta: {
          icon: 'carbon:menu',
          title: 'system.menu.title',
        },
        component: '/system/menu/list',
        children: [
          {
            id: 20_101,
            pid: 201,
            name: 'SystemMenuCreate',
            status: 1,
            type: 'button',
            authCode: 'System:Menu:Create',
            meta: { title: 'common.create' },
          },
          {
            id: 20_102,
            pid: 201,
            name: 'SystemMenuEdit',
            status: 1,
            type: 'button',
            authCode: 'System:Menu:Edit',
            meta: { title: 'common.edit' },
          },
          {
            id: 20_103,
            pid: 201,
            name: 'SystemMenuDelete',
            status: 1,
            type: 'button',
            authCode: 'System:Menu:Delete',
            meta: { title: 'common.delete' },
          },
        ],
      },
      {
        id: 202,
        pid: 2,
        path: '/system/dept',
        name: 'SystemDept',
        status: 1,
        type: 'menu',
        authCode: 'System:Dept:List',
        meta: {
          icon: 'carbon:container-services',
          title: 'system.dept.title',
        },
        component: '/system/dept/list',
        children: [
          {
            id: 20_401,
            pid: 202,
            name: 'SystemDeptCreate',
            status: 1,
            type: 'button',
            authCode: 'System:Dept:Create',
            meta: { title: 'common.create' },
          },
          {
            id: 20_402,
            pid: 202,
            name: 'SystemDeptEdit',
            status: 1,
            type: 'button',
            authCode: 'System:Dept:Edit',
            meta: { title: 'common.edit' },
          },
          {
            id: 20_403,
            pid: 202,
            name: 'SystemDeptDelete',
            status: 1,
            type: 'button',
            authCode: 'System:Dept:Delete',
            meta: { title: 'common.delete' },
          },
        ],
      },
    ],
  },
  {
    id: 9,
    meta: {
      badgeType: 'dot',
      order: 9998,
      title: 'demos.vben.title',
      icon: 'carbon:data-center',
    },
    name: 'Project',
    path: '/vben-admin',
    type: 'catalog',
    status: 1,
    children: [
      {
        id: 901,
        pid: 9,
        name: 'VbenDocument',
        path: '/vben-admin/document',
        component: 'IFrameView',
        type: 'embedded',
        status: 1,
        meta: {
          icon: 'carbon:book',
          iframeSrc: 'https://doc.vben.pro',
          title: 'demos.vben.document',
        },
      },
      {
        id: 902,
        pid: 9,
        name: 'VbenGithub',
        path: '/vben-admin/github',
        component: 'IFrameView',
        type: 'link',
        status: 1,
        meta: {
          icon: 'carbon:logo-github',
          link: 'https://github.com/vbenjs/vue-vben-admin',
          title: 'Github',
        },
      },
      {
        id: 903,
        pid: 9,
        name: 'VbenAntdv',
        path: '/vben-admin/antdv',
        component: 'IFrameView',
        type: 'link',
        status: 0,
        meta: {
          icon: 'carbon:hexagon-vertical-solid',
          badgeType: 'dot',
          link: 'https://ant.vben.pro',
          title: 'demos.vben.antdv',
        },
      },
    ],
  },
  {
    id: 10,
    component: '_core/about/index',
    type: 'menu',
    status: 1,
    meta: {
      icon: 'lucide:copyright',
      order: 9999,
      title: 'demos.vben.about',
    },
    name: 'About',
    path: '/about',
  },
];

export function getMenuIds(menus: any[]) {
  const ids: number[] = [];
  menus.forEach((item) => {
    ids.push(item.id);
    if (item.children && item.children.length > 0) {
      ids.push(...getMenuIds(item.children));
    }
  });
  return ids;
}

/**
 * 时区选项
 */
export const TIME_ZONE_OPTIONS: TimezoneOption[] = [
  {
    offset: -5,
    timezone: 'America/New_York',
  },
  {
    offset: 0,
    timezone: 'Europe/London',
  },
  {
    offset: 8,
    timezone: 'Asia/Shanghai',
  },
  {
    offset: 9,
    timezone: 'Asia/Tokyo',
  },
  {
    offset: 9,
    timezone: 'Asia/Seoul',
  },
];
