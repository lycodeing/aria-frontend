# System Config Management Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend for system configuration management — API layer, Pinia store with login-time preload, a shared CRUD page component used by both the "客服配置" and "系统配置" menus, and route registration.

**Architecture:** Single shared Vue page component (`views/system/config/index.vue`) reads `configType` from `route.meta` to know which category to display, avoiding code duplication. A Pinia store (`useSystemConfigStore`) loads config maps at login time and exposes a `getConfig(key, fallback)` helper for downstream consumers. The API layer follows the existing `requestClient` pattern from `apps/src/api/ai-model/index.ts`.

**Tech Stack:** Vue 3 Composition API, Pinia (setup-style defineStore), ant-design-vue, TypeScript, Vitest

## Global Constraints

- API client: use `requestClient` from `#/api/request` (baseURL already includes `/api/v1`, so paths start with `/admin/system-config`)
- Backend response shape: `R<T>` — `requestClient` response interceptor extracts `.data`, so function return types reflect the inner `T`
- Component style: `<script lang="ts" setup>`, ant-design-vue components imported individually (no barrel imports)
- Store style: setup-style `defineStore` (composable pattern), not options API
- Route authority strings: `'super_admin'`, `'kf_manager'`, `'kf_staff'`
- No new third-party dependencies
- All code must have TypeScript types; no `any` except where the existing codebase already uses it for form `reactive` state (consistent with `menu/index.vue` pattern)
- `configKey`, `configType`, `valueType` must NOT be editable in the edit modal (read-only display only)
- Rows with `isSystem=true` must have the delete button disabled
- This plan covers **frontend only**. Backend DDL, Java files, and seed SQL are implemented separately in `ai-auth`.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `apps/src/api/system-config/index.ts` | All HTTP calls for system-config |
| Create | `apps/src/store/system-config.ts` | Config map cache + `getConfig()` helper |
| Modify | `apps/src/store/index.ts` | Re-export `useSystemConfigStore` |
| Modify | `apps/src/store/auth.ts` | Call `systemConfigStore.loadAll()` after login |
| Create | `apps/src/views/system/config/index.vue` | Shared CRUD page (configType from route.meta) |
| Modify | `apps/src/router/routes/modules/system.ts` | Add `/system/config` route (super_admin) |
| Modify | `apps/src/router/routes/modules/customerservice.ts` | Add `/customerservice/config` route (super_admin + kf_manager) |
| Create | `apps/src/store/__tests__/system-config.test.ts` | Unit tests for store |

---

## Task 1: API Layer

**Files:**
- Create: `apps/src/api/system-config/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SystemConfigVO { id: number; configKey: string; configValue: string; configType: string; valueType: string; configName: string; configGroup: string; remark: string | null; isEnabled: boolean; isSystem: boolean; }
  export interface SystemConfigRequest { configKey: string; configValue: string; configType: string; valueType: string; configName: string; configGroup: string; remark?: string; }
  export interface SystemConfigListParams { configType: string; keyword?: string; page?: number; size?: number; }
  export async function listSystemConfigsApi(params: SystemConfigListParams): Promise<PageResult<SystemConfigVO>>
  export async function createSystemConfigApi(data: SystemConfigRequest): Promise<SystemConfigVO>
  export async function updateSystemConfigApi(id: number, data: Partial<Pick<SystemConfigRequest, 'configValue' | 'configName' | 'configGroup' | 'remark'>>): Promise<void>
  export async function deleteSystemConfigApi(id: number): Promise<void>
  export async function getSystemConfigMapApi(configType: string): Promise<Record<string, unknown>>
  ```

- [ ] **Step 1: Create the API file**

```typescript
// apps/src/api/system-config/index.ts
import { requestClient } from '#/api/request';

export interface SystemConfigVO {
  id: number;
  configKey: string;
  configValue: string;
  configType: string;    // CUSTOMER_SERVICE | SYSTEM
  valueType: string;     // NUMBER | STRING | BOOLEAN | JSON
  configName: string;
  configGroup: string;
  remark: string | null;
  isEnabled: boolean;
  isSystem: boolean;
}

export interface SystemConfigRequest {
  configKey: string;
  configValue: string;
  configType: string;
  valueType: string;
  configName: string;
  configGroup: string;
  remark?: string;
}

export interface SystemConfigListParams {
  configType: string;
  keyword?: string;
  page?: number;
  size?: number;
}

export interface PageResult<T> {
  total: number;
  page: number;
  size: number;
  items: T[];
}

export async function listSystemConfigsApi(
  params: SystemConfigListParams,
): Promise<PageResult<SystemConfigVO>> {
  return requestClient.get('/admin/system-config', { params });
}

export async function createSystemConfigApi(
  data: SystemConfigRequest,
): Promise<SystemConfigVO> {
  return requestClient.post('/admin/system-config', data);
}

export async function updateSystemConfigApi(
  id: number,
  data: Partial<Pick<SystemConfigRequest, 'configValue' | 'configName' | 'configGroup' | 'remark'>>,
): Promise<void> {
  return requestClient.put(`/admin/system-config/${id}`, data);
}

export async function deleteSystemConfigApi(id: number): Promise<void> {
  return requestClient.delete(`/admin/system-config/${id}`);
}

export async function getSystemConfigMapApi(
  configType: string,
): Promise<Record<string, unknown>> {
  return requestClient.get('/admin/system-config/map', { params: { configType } });
}
```

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd exec tsc --noEmit 2>&1 | head -20
```
Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/src/api/system-config/index.ts
git commit -m "feat(@vben/web-antd): 新增 system-config API 层"
```

---

## Task 2: Pinia Store + Login Integration

**Files:**
- Create: `apps/src/store/system-config.ts`
- Modify: `apps/src/store/index.ts`
- Modify: `apps/src/store/auth.ts`

**Interfaces:**
- Consumes: `getSystemConfigMapApi` from `#/api/system-config`
- Produces:
  ```ts
  export const useSystemConfigStore: () => {
    configMap: Ref<Record<string, unknown>>;
    loadAll(): Promise<void>;
    getConfig<T>(key: string, fallback: T): T;
  }
  ```

- [ ] **Step 1: Write failing store test first**

Create `apps/src/store/__tests__/system-config.test.ts`:

```typescript
// apps/src/store/__tests__/system-config.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('#/api/system-config', () => ({
  getSystemConfigMapApi: vi.fn(),
}));

import { getSystemConfigMapApi } from '#/api/system-config';
import { useSystemConfigStore } from '../system-config';

describe('useSystemConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loadAll merges CUSTOMER_SERVICE and SYSTEM maps', async () => {
    vi.mocked(getSystemConfigMapApi)
      .mockResolvedValueOnce({ 'agent.maxConcurrent': 5, 'agent.welcomeMessage': '您好' })
      .mockResolvedValueOnce({ 'dashboard.recentLimit': 10 });

    const store = useSystemConfigStore();
    await store.loadAll();

    expect(store.configMap['agent.maxConcurrent']).toBe(5);
    expect(store.configMap['agent.welcomeMessage']).toBe('您好');
    expect(store.configMap['dashboard.recentLimit']).toBe(10);
  });

  it('getConfig returns value when key exists', async () => {
    vi.mocked(getSystemConfigMapApi)
      .mockResolvedValueOnce({ 'knowledge.searchTopK': 5 })
      .mockResolvedValueOnce({});

    const store = useSystemConfigStore();
    await store.loadAll();

    expect(store.getConfig('knowledge.searchTopK', 3)).toBe(5);
  });

  it('getConfig returns fallback when key missing', () => {
    const store = useSystemConfigStore();
    expect(store.getConfig('nonexistent.key', 42)).toBe(42);
  });

  it('getConfig returns fallback when value is undefined', async () => {
    vi.mocked(getSystemConfigMapApi)
      .mockResolvedValueOnce({ 'some.key': undefined })
      .mockResolvedValueOnce({});

    const store = useSystemConfigStore();
    await store.loadAll();

    expect(store.getConfig('some.key', 99)).toBe(99);
  });

  it('loadAll silently handles API failure', async () => {
    vi.mocked(getSystemConfigMapApi).mockRejectedValue(new Error('network error'));

    const store = useSystemConfigStore();
    await expect(store.loadAll()).resolves.not.toThrow();
    expect(store.configMap).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend/apps
npx vitest run src/store/__tests__/system-config.test.ts 2>&1 | tail -10
```
Expected: FAIL — `useSystemConfigStore` not found.

- [ ] **Step 3: Implement the store**

Create `apps/src/store/system-config.ts`:

```typescript
// apps/src/store/system-config.ts
import { ref } from 'vue';

import { defineStore } from 'pinia';

import { getSystemConfigMapApi } from '#/api/system-config';

export const useSystemConfigStore = defineStore('systemConfig', () => {
  const configMap = ref<Record<string, unknown>>({});

  async function loadAll(): Promise<void> {
    try {
      const [csMap, sysMap] = await Promise.all([
        getSystemConfigMapApi('CUSTOMER_SERVICE'),
        getSystemConfigMapApi('SYSTEM'),
      ]);
      configMap.value = { ...csMap, ...sysMap };
    } catch (error) {
      console.error('[useSystemConfigStore] loadAll 失败:', error);
      // 失败时保留空 map；消费方通过 getConfig fallback 保证行为不变
    }
  }

  function getConfig<T>(key: string, fallback: T): T {
    const val = configMap.value[key];
    return val !== undefined && val !== null ? (val as T) : fallback;
  }

  function $reset() {
    configMap.value = {};
  }

  return { $reset, configMap, getConfig, loadAll };
});
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend/apps
npx vitest run src/store/__tests__/system-config.test.ts 2>&1 | tail -10
```
Expected: 5/5 PASS.

- [ ] **Step 5: Re-export from store/index.ts**

Edit `apps/src/store/index.ts` — append one line:

```typescript
export * from './auth';
export * from './system-config';
```

- [ ] **Step 6: Integrate into auth.ts — call loadAll() after login**

Read `apps/src/store/auth.ts` first, then find the line `userStore.setUserInfo(userInfo);` inside `authLogin()`. Add the store call after it:

```typescript
// After: userStore.setUserInfo(userInfo);
// Add:
const { useSystemConfigStore } = await import('#/store/system-config');
useSystemConfigStore().loadAll().catch(() => {});  // 非阻塞，失败不影响登录流程
```

Note: use dynamic import to avoid circular dependency (auth store → system-config store → api).

- [ ] **Step 7: Run tsc and tests**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd exec tsc --noEmit 2>&1 | head -20
cd apps && npx vitest run src/store/__tests__/system-config.test.ts 2>&1 | tail -5
```
Expected: 0 new type errors, 5/5 tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/src/store/system-config.ts \
        apps/src/store/__tests__/system-config.test.ts \
        apps/src/store/index.ts \
        apps/src/store/auth.ts
git commit -m "feat(@vben/web-antd): 新增 useSystemConfigStore，登录后预加载系统配置"
```

---

## Task 3: Shared CRUD Page Component

**Files:**
- Create: `apps/src/views/system/config/index.vue`

**Interfaces:**
- Consumes: `listSystemConfigsApi`, `createSystemConfigApi`, `updateSystemConfigApi`, `deleteSystemConfigApi` from `#/api/system-config`
- Consumes: `route.meta.configType` (string — `'CUSTOMER_SERVICE'` | `'SYSTEM'`) injected by router
- Produces: standalone page component, no exports needed

- [ ] **Step 1: Create the page component**

```vue
<!-- apps/src/views/system/config/index.vue -->
<script lang="ts" setup>
import type { TableColumnsType } from 'ant-design-vue';

import type { SystemConfigVO } from '#/api/system-config';

import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Form,
  FormItem,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  SelectOption,
  Switch,
  Table,
  Tag,
  Textarea,
} from 'ant-design-vue';

import {
  createSystemConfigApi,
  deleteSystemConfigApi,
  listSystemConfigsApi,
  updateSystemConfigApi,
} from '#/api/system-config';

// ===== Route meta: configType 由路由注入 =====
const route = useRoute();
const configType = (route.meta.configType as string) ?? 'CUSTOMER_SERVICE';
const pageTitle = configType === 'CUSTOMER_SERVICE' ? '客服配置' : '系统配置';

// ===== 列表状态 =====
const list = ref<SystemConfigVO[]>([]);
const total = ref(0);
const loading = ref(false);
const keyword = ref('');
const currentPage = ref(1);
const pageSize = ref(20);

// ===== 弹窗状态 =====
const modalOpen = ref(false);
const editingId = ref<null | number>(null);
const submitting = ref(false);

// ===== 表单状态 =====
const VALUE_TYPES = ['NUMBER', 'STRING', 'BOOLEAN', 'JSON'] as const;

const emptyForm = () => ({
  configKey: '',
  configValue: '',
  configType,
  valueType: 'STRING' as string,
  configName: '',
  configGroup: '',
  remark: '',
});
const form = reactive<ReturnType<typeof emptyForm>>(emptyForm());

// ===== 表格列定义 =====
const columns: TableColumnsType = [
  { title: '配置键', dataIndex: 'configKey', width: 220, ellipsis: true },
  { title: '配置名称', dataIndex: 'configName', width: 160, ellipsis: true },
  { title: '分组', dataIndex: 'configGroup', width: 100 },
  { title: '值类型', dataIndex: 'valueType', width: 90 },
  { title: '配置值', dataIndex: 'configValue', ellipsis: true },
  { title: '启用', dataIndex: 'isEnabled', width: 70 },
  { title: '内置', dataIndex: 'isSystem', width: 70 },
  { title: '操作', key: 'action', width: 120, fixed: 'right' },
];

// ===== 加载列表 =====
async function loadList() {
  loading.value = true;
  try {
    const result = await listSystemConfigsApi({
      configType,
      keyword: keyword.value || undefined,
      page: currentPage.value - 1, // 0-based
      size: pageSize.value,
    });
    list.value = result.items;
    total.value = result.total;
  } catch (error: any) {
    message.error(error?.response?.data?.msg ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  currentPage.value = 1;
  loadList();
}

// ===== 新增 =====
function openCreate() {
  editingId.value = null;
  Object.assign(form, emptyForm());
  modalOpen.value = true;
}

// ===== 编辑 =====
function openEdit(row: SystemConfigVO) {
  editingId.value = row.id;
  Object.assign(form, {
    configKey: row.configKey,
    configValue: row.configValue ?? '',
    configType: row.configType,
    valueType: row.valueType,
    configName: row.configName ?? '',
    configGroup: row.configGroup ?? '',
    remark: row.remark ?? '',
  });
  modalOpen.value = true;
}

// ===== 提交（新增 / 编辑） =====
async function submit() {
  if (!form.configKey.trim() && !editingId.value) {
    message.warning('配置键不能为空');
    return;
  }
  submitting.value = true;
  try {
    if (editingId.value === null) {
      await createSystemConfigApi({ ...form });
      message.success('新增成功');
    } else {
      await updateSystemConfigApi(editingId.value, {
        configValue: form.configValue,
        configName: form.configName,
        configGroup: form.configGroup,
        remark: form.remark,
      });
      message.success('编辑成功');
    }
    modalOpen.value = false;
    loadList();
  } catch (error: any) {
    message.error(error?.response?.data?.msg ?? '操作失败');
  } finally {
    submitting.value = false;
  }
}

// ===== 删除 =====
function confirmDelete(row: SystemConfigVO) {
  Modal.confirm({
    title: `确认删除「${row.configName || row.configKey}」？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await deleteSystemConfigApi(row.id);
        message.success('删除成功');
        loadList();
      } catch (error: any) {
        message.error(error?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

onMounted(loadList);
</script>

<template>
  <Page :title="pageTitle" :description="`管理 ${pageTitle} 类配置项`">
    <!-- 搜索栏 -->
    <div class="mb-3 flex items-center gap-2">
      <Input
        v-model:value="keyword"
        allow-clear
        placeholder="搜索配置键或名称"
        style="width: 240px"
        @press-enter="onSearch"
      />
      <Button type="primary" @click="onSearch">搜索</Button>
      <Button style="margin-left: auto" type="primary" @click="openCreate">新增配置</Button>
    </div>

    <!-- 列表 -->
    <Table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      :pagination="{
        current: currentPage,
        pageSize,
        total,
        showTotal: (t: number) => `共 ${t} 条`,
        onChange: (p: number) => { currentPage = p; loadList(); },
      }"
      row-key="id"
      scroll="{ x: 900 }"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'isEnabled'">
          <Tag :color="record.isEnabled ? 'green' : 'default'">
            {{ record.isEnabled ? '启用' : '停用' }}
          </Tag>
        </template>
        <template v-else-if="column.dataIndex === 'isSystem'">
          <Tag v-if="record.isSystem" color="blue">内置</Tag>
          <span v-else class="text-gray-400">—</span>
        </template>
        <template v-else-if="column.key === 'action'">
          <Button size="small" type="link" @click="openEdit(record)">编辑</Button>
          <Button
            :disabled="record.isSystem"
            danger
            size="small"
            type="link"
            @click="confirmDelete(record)"
          >
            删除
          </Button>
        </template>
      </template>
    </Table>

    <!-- 新增 / 编辑弹窗 -->
    <Modal
      v-model:open="modalOpen"
      :confirm-loading="submitting"
      :title="editingId ? '编辑配置' : '新增配置'"
      width="520px"
      @ok="submit"
    >
      <Form class="mt-4 space-y-1" layout="vertical">
        <!-- 新增时显示只读字段 -->
        <template v-if="!editingId">
          <FormItem label="配置键" required>
            <Input v-model:value="form.configKey" placeholder="如 agent.xxx（创建后不可改）" />
          </FormItem>
          <FormItem label="值类型" required>
            <Select v-model:value="form.valueType" style="width: 100%">
              <SelectOption v-for="vt in VALUE_TYPES" :key="vt" :value="vt">{{ vt }}</SelectOption>
            </Select>
          </FormItem>
          <FormItem label="分组">
            <Input v-model:value="form.configGroup" placeholder="如 座席 / 知识库 / 提示词" />
          </FormItem>
        </template>

        <!-- 编辑时只读展示 configKey / valueType -->
        <template v-else>
          <FormItem label="配置键">
            <Input :value="form.configKey" disabled />
          </FormItem>
          <FormItem label="值类型">
            <Input :value="form.valueType" disabled />
          </FormItem>
        </template>

        <FormItem label="配置名称">
          <Input v-model:value="form.configName" placeholder="可选，便于识别" />
        </FormItem>
        <FormItem label="配置值">
          <Textarea
            v-model:value="form.configValue"
            :auto-size="{ minRows: 2, maxRows: 8 }"
            placeholder="NUMBER/STRING/BOOLEAN 填原始值；JSON 填合法 JSON 字符串"
          />
        </FormItem>
        <FormItem label="备注">
          <Input v-model:value="form.remark" />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
```

- [ ] **Step 2: Run tsc to verify types**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd exec tsc --noEmit 2>&1 | head -30
```
Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/src/views/system/config/index.vue
git commit -m "feat(@vben/web-antd): 新增系统配置/客服配置共用 CRUD 页面"
```

---

## Task 4: Route Registration

**Files:**
- Modify: `apps/src/router/routes/modules/system.ts`
- Modify: `apps/src/router/routes/modules/customerservice.ts`

**Interfaces:**
- Consumes: `views/system/config/index.vue` (lazy import)
- Produces: two navigable routes, each injecting `configType` via `route.meta`

- [ ] **Step 1: Add system config route to system.ts**

Open `apps/src/router/routes/modules/system.ts`. Add a new child after the `SystemAiModel` entry:

```typescript
// apps/src/router/routes/modules/system.ts
import type { RouteRecordRaw } from 'vue-router';

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
        meta: { authority: ['super_admin'], icon: 'lucide:users', title: '用户管理' },
      },
      {
        name: 'SystemRole',
        path: '/system/role',
        component: () => import('#/views/system/role/index.vue'),
        meta: { authority: ['super_admin'], icon: 'lucide:shield', title: '角色管理' },
      },
      {
        name: 'SystemMenu',
        path: '/system/menu',
        component: () => import('#/views/system/menu/index.vue'),
        meta: { authority: ['super_admin'], icon: 'lucide:layout-list', title: '菜单管理' },
      },
      {
        name: 'SystemAiModel',
        path: '/system/ai-model',
        component: () => import('#/views/system/ai-model/index.vue'),
        meta: { authority: ['super_admin'], icon: 'lucide:cpu', title: 'AI 模型配置' },
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
    ],
  },
];

export default routes;
```

- [ ] **Step 2: Add customer-service config route to customerservice.ts**

Open `apps/src/router/routes/modules/customerservice.ts`. Add a new child to the `CustomerService` children array (after `CustomerServiceAgent`, before `CustomerServiceDIT`):

```typescript
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
```

- [ ] **Step 3: Extend RouteMeta type to include configType (if needed)**

Check if the project has a custom `RouteMeta` augmentation. Search:

```bash
grep -r "configType" /Users/lycodeing/WebstormProjects/ai-customerservice-frontend/apps/src/router/ 2>/dev/null
grep -r "RouteMeta" /Users/lycodeing/WebstormProjects/ai-customerservice-frontend/apps/src/router/ 2>/dev/null | head -5
```

If `RouteMeta` is extended somewhere (e.g., in a `types/router.d.ts`), add `configType?: string` to it. If there is no augmentation and tsc reports an error about unknown property `configType`, add:

```typescript
// apps/src/router/types.ts  (create if needed, or add to existing augmentation file)
import 'vue-router';
declare module 'vue-router' {
  interface RouteMeta {
    configType?: string;
  }
}
```

- [ ] **Step 4: Run tsc**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm --filter @vben/web-antd exec tsc --noEmit 2>&1 | head -20
```
Expected: 0 new errors.

- [ ] **Step 5: Run all unit tests**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend/apps
npx vitest run src/store/__tests__/system-config.test.ts 2>&1 | tail -8
```
Expected: 5/5 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/src/router/routes/modules/system.ts \
        apps/src/router/routes/modules/customerservice.ts
git commit -m "feat(@vben/web-antd): 注册系统配置和客服配置路由"
```

---

## 自检：Spec 覆盖 & Placeholder 扫描

### Spec 覆盖检查

| 需求（来自技术设计文档） | 覆盖任务 |
|---|---|
| `apps/src/api/system-config/index.ts` — 5 个函数 | Task 1 |
| `apps/src/store/system-config.ts` — loadAll / getConfig | Task 2 |
| 登录后预热 store | Task 2 Step 6 |
| 两个管理页面共用组件 | Task 3 |
| `configKey`/`valueType` 编辑时只读 | Task 3 Step 1（disabled Input） |
| `isSystem=true` 的行删除按钮 disabled | Task 3 Step 1（`:disabled="record.isSystem"`） |
| `/system/config` 路由（super_admin） | Task 4 Step 1 |
| `/customerservice/config` 路由（super_admin + kf_manager） | Task 4 Step 2 |
| `route.meta.configType` 传入页面 | Task 3 Step 1 + Task 4 Steps 1-2 |
| 不替换前端 UI 写死常量 | 未涉及（按规范不做） |
| 不替换 WS/SSE 连接常量 | 未涉及（按规范不做） |

### Placeholder 扫描结果

无 TBD / TODO / "implement later"。所有步骤均含完整代码块。

### 类型一致性

- `SystemConfigVO.id` 是 `number`（Task 1），Task 3 中 `editingId: Ref<null | number>` — 一致。
- `updateSystemConfigApi(id: number, ...)` 参数类型与 Task 3 中 `editingId.value` 调用一致。
- `listSystemConfigsApi` 返回 `PageResult<SystemConfigVO>`，Task 3 中 `list.value = result.items` — 一致。
- `getConfig<T>(key, fallback: T): T` 在 Task 2 定义，Task 3 中未直接使用（页面只调 API，store 供后续业务消费）— 无矛盾。
