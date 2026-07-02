<script lang="ts" setup>
import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
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
  id: number; parentId: number; menuType: string; menuName: string
  menuKey: string; path?: string; component?: string; icon?: string
  sortOrder: number; isVisible: boolean; isCache: boolean
  permissionKey?: string; status: string; remark?: string
  children?: MenuVO[]
}

const list    = ref<MenuVO[]>([]);
const loading = ref(false);
const expandedRowKeys = ref<number[]>([]);

// 递归收集所有节点 id 用于展开
function collectIds(items: MenuVO[]): number[] {
  return items.flatMap(m => [m.id, ...collectIds(m.children ?? [])]);
}

async function loadList() {
  loading.value = true;
  try {
    list.value = (await getAllMenuTreeApi() as any) ?? [];
    expandedRowKeys.value = collectIds(list.value);
  }
  catch { message.error('加载失败'); }
  finally { loading.value = false; }
}

// ===== 弹窗 =====
const modalOpen  = ref(false);
const editingId  = ref<null | number>(null);
const submitting = ref(false);

const emptyForm = () => ({
  parentId: 0, menuType: 'MENU', menuName: '', menuKey: '',
  path: '', component: '', icon: '', sortOrder: 0,
  isVisible: true, isCache: true, permissionKey: '', status: 'active', remark: '',
})
const form = reactive<any>(emptyForm());

function openCreate(parentId = 0) {
  editingId.value = null;
  Object.assign(form, emptyForm(), { parentId });
  modalOpen.value = true;
}
function openEdit(row: MenuVO) {
  editingId.value = row.id;
  Object.assign(form, { ...row });
  modalOpen.value = true;
}
async function submit() {
  if (!form.menuName || !form.menuKey) { message.warning('请填写菜单名称和标识'); return; }
  submitting.value = true;
  try {
    editingId.value
      ? (await updateMenuApi(editingId.value, { ...form }), message.success('更新成功'))
      : (await createMenuApi({ ...form }), message.success('创建成功'));
    modalOpen.value = false; loadList();
  } catch (e: any) { message.error(e?.response?.data?.msg ?? '操作失败'); }
  finally { submitting.value = false; }
}
function confirmDelete(row: MenuVO) {
  Modal.confirm({
    title: `删除「${row.menuName}」？`,
    content: '有子菜单时后端会拒绝，需先删除子项。',
    okType: 'danger',
    async onOk() {
      try { await deleteMenuApi(row.id); message.success('已删除'); loadList(); }
      catch (e: any) { message.error(e?.response?.data?.msg ?? '删除失败'); }
    },
  });
}

// 将菜单树转为 TreeSelect 所需格式（只含目录和菜单，不含按钮）
function toTreeSelectNodes(items: MenuVO[]): any[] {
  return items
    .filter(m => m.menuType !== 'BUTTON')
    .map(m => ({
      title: m.menuName,
      value: m.id,
      children: m.children ? toTreeSelectNodes(m.children) : [],
    }));
}

// 顶级菜单选项（parentId=0）
const parentOptions = computed(() => [
  { title: '顶级菜单（根节点）', value: 0, children: toTreeSelectNodes(list.value) },
]);
const TYPE_COLOR: Record<string, string> = { DIRECTORY: 'processing', MENU: 'success', BUTTON: 'warning' };
const TYPE_LABEL: Record<string, string> = { DIRECTORY: '目录', MENU: '菜单', BUTTON: '按钮' };

function onExpand(expanded: boolean, record: MenuVO) {
  if (expanded) {
    expandedRowKeys.value = [...expandedRowKeys.value, record.id];
  } else {
    expandedRowKeys.value = expandedRowKeys.value.filter(k => k !== record.id);
  }
}

const columns = [
  { title: '菜单名称', key: 'name',  width: 220 },
  { title: '类型',    key: 'type',   width: 72  },
  { title: '路由路径', key: 'path',  width: 220 },
  { title: '权限/组件', key: 'perm', },
  { title: '排序',    dataIndex: 'sortOrder', key: 'sort', width: 60, align: 'center' as const },
  { title: '状态',    key: 'status', width: 70, align: 'center' as const },
  { title: '操作',    key: 'action', width: 120, align: 'center' as const },
];

onMounted(loadList);
</script>

<template>
  <Page title="菜单管理" description="管理系统菜单、路由和按钮权限">
    <template #extra>
      <Button type="primary" @click="openCreate()">
        <template #icon><Icon icon="lucide:plus" /></template>
        新增菜单
      </Button>
    </template>

    <Table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      row-key="id"
      :pagination="false"
      :expanded-row-keys="expandedRowKeys"
      size="small"
      @expand="onExpand"
    >
      <template #bodyCell="{ column, record }">

        <!-- 菜单名称：图标 + 名称 -->
        <template v-if="column.key === 'name'">
          <span class="flex items-center gap-1.5">
            <Icon
              v-if="record.icon"
              :icon="record.icon"
              class="shrink-0 opacity-60"
              :style="{ fontSize: '15px' }"
            />
            <span class="font-medium">{{ record.menuName }}</span>
          </span>
        </template>

        <!-- 类型 tag -->
        <template v-else-if="column.key === 'type'">
          <Tag :color="TYPE_COLOR[record.menuType]" style="margin:0">
            {{ TYPE_LABEL[record.menuType] }}
          </Tag>
        </template>

        <!-- 路由路径 -->
        <template v-else-if="column.key === 'path'">
          <div v-if="record.path || record.menuKey" class="flex flex-col gap-0.5">
            <span v-if="record.path" class="font-mono text-xs">{{ record.path }}</span>
            <span class="text-xs opacity-40">{{ record.menuKey }}</span>
          </div>
        </template>

        <!-- 权限标识 / 组件路径 -->
        <template v-else-if="column.key === 'perm'">
          <template v-if="record.menuType === 'BUTTON'">
            <code class="rounded bg-amber-50 px-1 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {{ record.permissionKey }}
            </code>
          </template>
          <template v-else-if="record.component">
            <Tooltip :title="record.component" placement="topLeft">
              <span class="max-w-[200px] truncate font-mono text-xs opacity-50 block">
                {{ record.component }}
              </span>
            </Tooltip>
          </template>
        </template>

        <!-- 状态 -->
        <template v-else-if="column.key === 'status'">
          <span
            :class="[
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              record.status === 'active'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
            ]"
          >
            <span
              :class="['h-1.5 w-1.5 rounded-full', record.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400']"
            />
            {{ record.status === 'active' ? '启用' : '禁用' }}
          </span>
        </template>

        <!-- 操作：图标按钮 -->
        <template v-else-if="column.key === 'action'">
          <Space size="small">
            <Tooltip title="添加子项">
              <Button
                type="text" size="small"
                class="text-blue-500 hover:text-blue-600"
                @click="openCreate(record.id)"
              >
                <template #icon><Icon icon="lucide:plus-circle" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="编辑">
              <Button
                type="text" size="small"
                class="text-slate-500 hover:text-slate-700"
                @click="openEdit(record)"
              >
                <template #icon><Icon icon="lucide:pencil" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="删除">
              <Button
                type="text" size="small"
                class="text-red-400 hover:text-red-600"
                @click="confirmDelete(record)"
              >
                <template #icon><Icon icon="lucide:trash-2" /></template>
              </Button>
            </Tooltip>
          </Space>
        </template>

      </template>
    </Table>

    <!-- 新增/编辑弹窗 -->
    <Modal
      v-model:open="modalOpen"
      :title="editingId ? '编辑菜单' : '新增菜单'"
      :confirm-loading="submitting"
      width="580px"
      @ok="submit"
    >
      <Form layout="vertical" class="mt-4 space-y-1">
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
              style="width:100%"
            />
          </FormItem>
        </div>
        <div class="flex gap-3">
          <FormItem label="菜单名称" required class="flex-1">
            <Input v-model:value="form.menuName" placeholder="如：用户管理" />
          </FormItem>
          <FormItem label="路由标识（name）" required class="flex-1">
            <Input v-model:value="form.menuKey" placeholder="如：SystemUser" />
          </FormItem>
        </div>
        <template v-if="form.menuType !== 'BUTTON'">
          <div class="flex gap-3">
            <FormItem label="路由路径" class="flex-1">
              <Input v-model:value="form.path" placeholder="/system/user" />
            </FormItem>
            <FormItem label="组件路径" class="flex-1">
              <Input v-model:value="form.component" placeholder="system/user/index" />
            </FormItem>
          </div>
          <div class="flex gap-3">
            <FormItem label="图标" class="flex-1">
              <Input v-model:value="form.icon" placeholder="lucide:users">
                <template #prefix>
                  <Icon v-if="form.icon" :icon="form.icon" class="opacity-50" />
                  <Icon v-else icon="lucide:image" class="opacity-30" />
                </template>
              </Input>
            </FormItem>
            <FormItem label="排序" class="w-24">
              <InputNumber v-model:value="form.sortOrder" :min="0" style="width:100%" />
            </FormItem>
          </div>
          <div class="flex gap-6">
            <FormItem label="是否显示">
              <Switch v-model:checked="form.isVisible" checked-children="显示" un-checked-children="隐藏" />
            </FormItem>
            <FormItem label="是否缓存">
              <Switch v-model:checked="form.isCache" checked-children="缓存" un-checked-children="不缓存" />
            </FormItem>
          </div>
        </template>
        <template v-else>
          <FormItem label="权限标识">
            <Input v-model:value="form.permissionKey" placeholder="如：system:user:create" />
          </FormItem>
        </template>
        <FormItem label="状态">
          <Select v-model:value="form.status" style="width:160px">
            <SelectOption value="active">启用</SelectOption>
            <SelectOption value="inactive">禁用</SelectOption>
          </Select>
        </FormItem>
        <FormItem label="备注">
          <Input v-model:value="form.remark" placeholder="可选备注" />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
