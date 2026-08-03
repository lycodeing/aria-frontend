<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue';

import { IconPicker, Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
  Drawer,
  Form,
  FormItem,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  SelectOption,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  TreeSelect,
} from 'ant-design-vue';

import {
  createMenuApi,
  deleteMenuApi,
  getAllMenuTreeApi,
  updateMenuApi,
} from '#/api/core/menu';

interface MenuVO {
  id: number;
  parentId: number;
  menuType: string;
  menuName: string;
  menuKey: string;
  path?: string;
  component?: string;
  icon?: string;
  sortOrder: number;
  isVisible: boolean;
  isCache: boolean;
  isExternal: boolean;
  redirect?: string;
  permissionKey?: string;
  status: string;
  remark?: string;
  children?: MenuVO[];
}

const list = ref<MenuVO[]>([]);
const loading = ref(false);
const expandedRowKeys = ref<number[]>([]);

// ===== 搜索与过滤 =====
const searchKeyword = ref('');
const filterType = ref<string>('');

// 递归收集所有节点 id
function collectIds(items: MenuVO[]): number[] {
  return items.flatMap((m) => [m.id, ...collectIds(m.children ?? [])]);
}

// 只收集一级节点 id（默认只展开顶层，减少首屏 DOM 量）
function collectFirstLevelIds(items: MenuVO[]): number[] {
  return items.map((m) => m.id);
}

// 递归统计各类型数量
function countByType(items: MenuVO[]): {
  button: number;
  directory: number;
  menu: number;
} {
  let directory = 0;
  let menu = 0;
  let button = 0;
  function walk(nodes: MenuVO[]) {
    for (const n of nodes) {
      if (n.menuType === 'DIRECTORY') directory++;
      else if (n.menuType === 'MENU') menu++;
      else if (n.menuType === 'BUTTON') button++;
      if (n.children?.length) walk(n.children);
    }
  }
  walk(items);
  return { directory, menu, button };
}

const typeStats = computed(() => countByType(list.value));

// 前端搜索过滤树：保留匹配节点及其父链
function filterTree(items: MenuVO[], keyword: string, type: string): MenuVO[] {
  const kw = keyword.trim().toLowerCase();
  function walk(nodes: MenuVO[]): MenuVO[] {
    const result: MenuVO[] = [];
    for (const n of nodes) {
      // 类型过滤
      if (type && n.menuType !== type) {
        if (n.children?.length) {
          const filtered = walk(n.children);
          if (filtered.length > 0) {
            result.push({ ...n, children: filtered });
          }
        }
        continue;
      }
      // 关键词匹配
      const nameMatch =
        !kw ||
        n.menuName.toLowerCase().includes(kw) ||
        (n.menuKey ?? '').toLowerCase().includes(kw) ||
        (n.path ?? '').toLowerCase().includes(kw);
      const childrenFiltered = n.children?.length ? walk(n.children) : [];
      if (nameMatch || childrenFiltered.length > 0) {
        result.push({ ...n, children: childrenFiltered });
      }
    }
    return result;
  }
  return walk(items);
}

const filteredList = computed(() =>
  filterTree(list.value, searchKeyword.value, filterType.value),
);

async function loadList() {
  loading.value = true;
  try {
    list.value = ((await getAllMenuTreeApi()) as any) ?? [];
    // 默认只展开一级节点，替代原来的全展开
    expandedRowKeys.value = collectFirstLevelIds(list.value);
  } catch {
    message.error('加载失败');
  } finally {
    loading.value = false;
  }
}

function expandAll() {
  expandedRowKeys.value = collectIds(list.value);
}

function collapseAll() {
  expandedRowKeys.value = [];
}

// ===== Drawer 弹窗 =====
const drawerOpen = ref(false);
const editingId = ref<null | number>(null);
const submitting = ref(false);

const emptyForm = () => ({
  parentId: 0,
  menuType: 'MENU',
  menuName: '',
  menuKey: '',
  path: '',
  component: '',
  icon: '',
  sortOrder: 0,
  isVisible: true,
  isCache: true,
  isExternal: false,
  redirect: '',
  permissionKey: '',
  status: 'active',
  remark: '',
});
const form = reactive<any>(emptyForm());

function openCreate(parentId = 0) {
  editingId.value = null;
  Object.assign(form, emptyForm(), { parentId });
  drawerOpen.value = true;
}
function openEdit(row: MenuVO) {
  editingId.value = row.id;
  Object.assign(form, { ...row });
  drawerOpen.value = true;
}
async function submit() {
  if (!form.menuName || !form.menuKey) {
    message.warning('请填写菜单名称和标识');
    return;
  }
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateMenuApi(editingId.value, { ...form });
      message.success('更新成功');
    } else {
      await createMenuApi({ ...form });
      message.success('创建成功');
    }
    drawerOpen.value = false;
    loadList();
  } catch (error: any) {
    message.error(error?.response?.data?.msg ?? '操作失败');
  } finally {
    submitting.value = false;
  }
}
function confirmDelete(row: MenuVO) {
  Modal.confirm({
    title: `删除「${row.menuName}」？`,
    content: '有子菜单时后端会拒绝，需先删除子项。',
    okType: 'danger',
    async onOk() {
      try {
        await deleteMenuApi(row.id);
        message.success('已删除');
        loadList();
      } catch (error: any) {
        message.error(error?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

// 将菜单树转为 TreeSelect 所需格式（只含目录和菜单，不含按钮）
function toTreeSelectNodes(items: MenuVO[]): any[] {
  return items
    .filter((m) => m.menuType !== 'BUTTON')
    .map((m) => ({
      title: m.menuName,
      value: m.id,
      children: m.children ? toTreeSelectNodes(m.children) : [],
    }));
}

// 顶级菜单选项（parentId=0）
const parentOptions = computed(() => [
  {
    title: '顶级菜单（根节点）',
    value: 0,
    children: toTreeSelectNodes(list.value),
  },
]);
const TYPE_COLOR: Record<string, string> = {
  DIRECTORY: 'processing',
  MENU: 'success',
  BUTTON: 'warning',
};
const TYPE_LABEL: Record<string, string> = {
  DIRECTORY: '目录',
  MENU: '菜单',
  BUTTON: '按钮',
};

function onExpand(expanded: boolean, record: MenuVO) {
  expandedRowKeys.value = expanded
    ? [...expandedRowKeys.value, record.id]
    : expandedRowKeys.value.filter((k) => k !== record.id);
}

const columns = [
  { title: '菜单名称', key: 'name', width: 240 },
  { title: '类型', key: 'type', width: 72 },
  { title: '路由路径', key: 'path', width: 200 },
  { title: '权限/组件', key: 'perm' },
  {
    title: '排序',
    dataIndex: 'sortOrder',
    key: 'sort',
    width: 60,
    align: 'center' as const,
  },
  { title: '可见', key: 'visible', width: 50, align: 'center' as const },
  { title: '缓存', key: 'cache', width: 50, align: 'center' as const },
  { title: '状态', key: 'status', width: 70, align: 'center' as const },
  { title: '操作', key: 'action', width: 120, align: 'center' as const },
];

onMounted(loadList);
</script>

<template>
  <Page>
    <!-- 工具栏：统计 + 搜索 + 操作 -->
    <div
      class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"
    >
      <!-- 左侧：紧凑统计胶囊 -->
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">菜单管理</span>
        <span class="h-4 w-px bg-border"></span>
        <span
          class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        >
          目录 {{ typeStats.directory }}
        </span>
        <span
          class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        >
          菜单 {{ typeStats.menu }}
        </span>
        <span
          class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
        >
          按钮 {{ typeStats.button }}
        </span>
      </div>

      <!-- 右侧：搜索 + 筛选 + 操作 -->
      <div class="flex items-center gap-2">
        <Input
          v-model:value="searchKeyword"
          allow-clear
          placeholder="搜索名称 / 路由 / 标识"
          style="width: 200px"
        >
          <template #prefix>
            <Icon icon="lucide:search" class="text-muted-foreground" />
          </template>
        </Input>
        <Select
          v-model:value="filterType"
          allow-clear
          placeholder="类型"
          style="width: 100px"
        >
          <SelectOption value="DIRECTORY">目录</SelectOption>
          <SelectOption value="MENU">菜单</SelectOption>
          <SelectOption value="BUTTON">按钮</SelectOption>
        </Select>
        <Tooltip title="展开全部">
          <Button @click="expandAll">
            <template #icon><Icon icon="lucide:chevrons-down" /></template>
          </Button>
        </Tooltip>
        <Tooltip title="折叠全部">
          <Button @click="collapseAll">
            <template #icon><Icon icon="lucide:chevrons-up" /></template>
          </Button>
        </Tooltip>
        <Button type="primary" @click="openCreate()">
          <template #icon><Icon icon="lucide:plus" /></template>
          新增菜单
        </Button>
      </div>
    </div>

    <Table
      :columns="columns"
      :data-source="filteredList"
      :loading="loading"
      row-key="id"
      :pagination="false"
      :expanded-row-keys="expandedRowKeys"
      size="small"
      @expand="onExpand"
    >
      <template #bodyCell="{ column, record }">
        <!-- 菜单名称：图标 + 名称 + 类型前缀 -->
        <template v-if="column.key === 'name'">
          <span class="flex items-center gap-1.5">
            <Icon
              v-if="record.icon"
              :icon="record.icon"
              class="shrink-0 opacity-60"
              :style="{ fontSize: '15px' }"
            />
            <span
              v-if="record.menuType === 'DIRECTORY'"
              class="font-mono text-xs text-blue-500"
              >D</span
            >
            <span
              v-else-if="record.menuType === 'MENU'"
              class="font-mono text-xs text-emerald-500"
              >M</span
            >
            <span v-else class="font-mono text-xs text-amber-500">B</span>
            <span class="font-medium">{{ record.menuName }}</span>
          </span>
        </template>

        <!-- 类型 tag -->
        <template v-else-if="column.key === 'type'">
          <Tag :color="TYPE_COLOR[record.menuType]" style="margin: 0">
            {{ TYPE_LABEL[record.menuType] }}
          </Tag>
        </template>

        <!-- 路由路径 -->
        <template v-else-if="column.key === 'path'">
          <div
            v-if="record.path || record.menuKey"
            class="flex flex-col gap-0.5"
          >
            <span v-if="record.path" class="font-mono text-xs">{{
              record.path
            }}</span>
            <span class="text-xs opacity-40">{{ record.menuKey }}</span>
          </div>
        </template>

        <!-- 权限标识 / 组件路径 -->
        <template v-else-if="column.key === 'perm'">
          <template v-if="record.menuType === 'BUTTON'">
            <code
              class="rounded bg-amber-50 px-1 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            >
              {{ record.permissionKey }}
            </code>
          </template>
          <template v-else-if="record.component">
            <Tooltip :title="record.component" placement="topLeft">
              <span
                class="block max-w-[200px] truncate font-mono text-xs opacity-50"
              >
                {{ record.component }}
              </span>
            </Tooltip>
          </template>
        </template>

        <!-- 可见性 -->
        <template v-else-if="column.key === 'visible'">
          <Icon
            v-if="record.menuType !== 'BUTTON'"
            :icon="record.isVisible ? 'lucide:eye' : 'lucide:eye-off'"
            :class="[
              record.isVisible
                ? 'text-emerald-500'
                : 'text-gray-400 opacity-50',
            ]"
            style="font-size: 14px"
          />
        </template>

        <!-- 缓存 -->
        <template v-else-if="column.key === 'cache'">
          <Icon
            v-if="record.menuType === 'MENU'"
            :icon="record.isCache ? 'lucide:database' : 'lucide:database'"
            :class="[
              record.isCache ? 'text-blue-500' : 'text-gray-400 opacity-30',
            ]"
            style="font-size: 14px"
          />
        </template>

        <!-- 状态 -->
        <template v-else-if="column.key === 'status'">
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            :class="[
              record.status === 'active'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
            ]"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="[
                record.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400',
              ]"
            ></span>
            {{ record.status === 'active' ? '启用' : '禁用' }}
          </span>
        </template>

        <!-- 操作：图标按钮 -->
        <template v-else-if="column.key === 'action'">
          <Space size="small">
            <Tooltip title="添加子项">
              <Button
                type="text"
                size="small"
                class="text-blue-500 hover:text-blue-600"
                @click="openCreate(record.id)"
              >
                <template #icon><Icon icon="lucide:plus-circle" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="编辑">
              <Button
                type="text"
                size="small"
                class="text-slate-500 hover:text-slate-700"
                @click="openEdit(record as MenuVO)"
              >
                <template #icon><Icon icon="lucide:pencil" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                class="text-red-400 hover:text-red-600"
                @click="confirmDelete(record as MenuVO)"
              >
                <template #icon><Icon icon="lucide:trash-2" /></template>
              </Button>
            </Tooltip>
          </Space>
        </template>
      </template>
    </Table>

    <!-- 新增/编辑 Drawer -->
    <Drawer
      :open="drawerOpen"
      :title="editingId ? '编辑菜单' : '新增菜单'"
      width="720"
      @close="drawerOpen = false"
    >
      <Form layout="vertical" class="space-y-1">
        <!-- 分区：基本信息 -->
        <div class="mb-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-1 rounded bg-primary"></span>
            <span class="text-sm font-semibold">基本信息</span>
          </div>
          <div class="flex gap-3">
            <FormItem label="类型" required class="flex-1">
              <Select v-model:value="form.menuType">
                <SelectOption value="DIRECTORY">目录</SelectOption>
                <SelectOption value="MENU">菜单</SelectOption>
                <SelectOption value="BUTTON">按钮/接口</SelectOption>
              </Select>
            </FormItem>
            <FormItem label="上级菜单" class="flex-1">
              <TreeSelect
                v-model:value="form.parentId"
                :tree-data="parentOptions"
                :tree-default-expand-all="true"
                placeholder="请选择上级菜单"
                style="width: 100%"
              />
            </FormItem>
          </div>
          <div class="flex gap-3">
            <FormItem label="菜单名称" required class="flex-1">
              <Input v-model:value="form.menuName" placeholder="如：用户管理" />
            </FormItem>
            <FormItem label="路由标识（name）" required class="flex-1">
              <Input
                v-model:value="form.menuKey"
                placeholder="如：SystemUser"
              />
            </FormItem>
          </div>
        </div>

        <!-- 分区：路由配置（BUTTON 类型隐藏） -->
        <template v-if="form.menuType !== 'BUTTON'">
          <div class="mb-4">
            <div class="mb-3 flex items-center gap-2">
              <span class="h-4 w-1 rounded bg-emerald-500"></span>
              <span class="text-sm font-semibold">路由配置</span>
            </div>
            <div class="flex gap-3">
              <FormItem label="路由路径" class="flex-1">
                <Input v-model:value="form.path" placeholder="/system/user" />
              </FormItem>
              <FormItem label="组件路径" class="flex-1">
                <Input
                  v-model:value="form.component"
                  placeholder="system/user/index"
                />
              </FormItem>
            </div>
            <div class="flex gap-3">
              <FormItem label="图标" class="flex-1">
                <IconPicker v-model="form.icon" prefix="lucide" />
              </FormItem>
              <FormItem label="排序" class="w-24">
                <InputNumber
                  v-model:value="form.sortOrder"
                  :min="0"
                  style="width: 100%"
                />
              </FormItem>
            </div>
          </div>

          <!-- 分区：状态控制 -->
          <div class="mb-4">
            <div class="mb-3 flex items-center gap-2">
              <span class="h-4 w-1 rounded bg-amber-500"></span>
              <span class="text-sm font-semibold">状态控制</span>
            </div>
            <div class="flex gap-6">
              <FormItem label="是否显示">
                <Switch
                  v-model:checked="form.isVisible"
                  checked-children="显示"
                  un-checked-children="隐藏"
                />
              </FormItem>
              <FormItem label="是否缓存">
                <Switch
                  v-model:checked="form.isCache"
                  checked-children="缓存"
                  un-checked-children="不缓存"
                />
              </FormItem>
              <FormItem label="外链跳转">
                <Switch
                  v-model:checked="form.isExternal"
                  checked-children="外链"
                  un-checked-children="内部"
                />
              </FormItem>
            </div>
            <FormItem v-if="form.isExternal" label="重定向路径">
              <Input
                v-model:value="form.redirect"
                placeholder="外链地址，如 https://example.com"
              />
            </FormItem>
          </div>
        </template>

        <!-- BUTTON 类型：权限标识 -->
        <template v-else>
          <div class="mb-4">
            <div class="mb-3 flex items-center gap-2">
              <span class="h-4 w-1 rounded bg-amber-500"></span>
              <span class="text-sm font-semibold">权限配置</span>
            </div>
            <FormItem label="权限标识">
              <Input
                v-model:value="form.permissionKey"
                placeholder="如：system:user:create"
              />
            </FormItem>
          </div>
        </template>

        <!-- 通用：状态 + 备注 -->
        <div>
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-1 rounded bg-slate-400"></span>
            <span class="text-sm font-semibold">其他</span>
          </div>
          <div class="flex gap-3">
            <FormItem label="状态" class="w-40">
              <Select v-model:value="form.status">
                <SelectOption value="active">启用</SelectOption>
                <SelectOption value="inactive">禁用</SelectOption>
              </Select>
            </FormItem>
            <FormItem label="备注" class="flex-1">
              <Input v-model:value="form.remark" placeholder="可选备注" />
            </FormItem>
          </div>
        </div>
      </Form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button @click="drawerOpen = false">取消</Button>
          <Button type="primary" :loading="submitting" @click="submit">
            保存
          </Button>
        </div>
      </template>
    </Drawer>
  </Page>
</template>
