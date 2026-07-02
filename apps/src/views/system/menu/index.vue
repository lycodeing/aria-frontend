<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';

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
  Space,
  Switch,
  Table,
  Tag,
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

async function loadList() {
  loading.value = true;
  try {
    list.value = (await getAllMenuTreeApi() as any) ?? [];
  } catch { message.error('加载失败'); }
  finally { loading.value = false; }
}

// ===== 新增/编辑 =====
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
    if (editingId.value) {
      await updateMenuApi(editingId.value, { ...form });
      message.success('更新成功');
    } else {
      await createMenuApi({ ...form });
      message.success('创建成功');
    }
    modalOpen.value = false;
    loadList();
  } catch (e: any) {
    message.error(e?.response?.data?.msg ?? '操作失败');
  } finally { submitting.value = false; }
}

function confirmDelete(row: MenuVO) {
  Modal.confirm({
    title: `确认删除「${row.menuName}」？`,
    content: '有子菜单时无法删除，需先删除子菜单。',
    okType: 'danger',
    async onOk() {
      try { await deleteMenuApi(row.id); message.success('已删除'); loadList(); }
      catch (e: any) { message.error(e?.response?.data?.msg ?? '删除失败'); }
    },
  });
}

const MENU_TYPE_COLOR: Record<string, string> = { DIRECTORY: 'blue', MENU: 'green', BUTTON: 'orange' };
const MENU_TYPE_LABEL: Record<string, string> = { DIRECTORY: '目录', MENU: '菜单', BUTTON: '按钮' };

const columns = [
  { title: '菜单名称', dataIndex: 'menuName', key: 'menuName', width: 200 },
  { title: '类型',     key: 'menuType',  width: 80 },
  { title: '标识/路径', key: 'pathInfo', width: 200 },
  { title: '组件',     dataIndex: 'component', key: 'component' },
  { title: '排序',     dataIndex: 'sortOrder', key: 'sortOrder', width: 60 },
  { title: '状态',     key: 'status',    width: 70 },
  { title: '操作',     key: 'action',    width: 180 },
];

onMounted(loadList);
</script>

<template>
  <Page title="菜单管理" description="管理系统菜单、路由和按钮权限">
    <template #extra>
      <Button type="primary" @click="openCreate()">+ 新增菜单</Button>
    </template>

    <Table :columns="columns" :data-source="list" :loading="loading"
           row-key="id" :pagination="false" bordered size="small"
           :default-expand-all-rows="true">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'menuType'">
          <Tag :color="MENU_TYPE_COLOR[record.menuType]">{{ MENU_TYPE_LABEL[record.menuType] }}</Tag>
        </template>
        <template v-else-if="column.key === 'pathInfo'">
          <span class="text-xs text-gray-400">{{ record.menuKey }}</span>
          <span v-if="record.path" class="ml-1 text-xs">{{ record.path }}</span>
        </template>
        <template v-else-if="column.key === 'status'">
          <Tag :color="record.status === 'active' ? 'green' : 'default'">
            {{ record.status === 'active' ? '启用' : '禁用' }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <Space size="small">
            <Button size="small" @click="openCreate(record.id)">添加子项</Button>
            <Button size="small" @click="openEdit(record)">编辑</Button>
            <Button size="small" danger @click="confirmDelete(record)">删除</Button>
          </Space>
        </template>
      </template>
    </Table>

    <Modal v-model:open="modalOpen" :title="editingId ? '编辑菜单' : '新增菜单'"
           :confirm-loading="submitting" width="560px" @ok="submit">
      <Form layout="vertical" style="margin-top:16px">
        <div style="display:flex;gap:12px">
          <FormItem label="类型" required style="flex:1">
            <Select v-model:value="form.menuType">
              <SelectOption value="DIRECTORY">目录</SelectOption>
              <SelectOption value="MENU">菜单</SelectOption>
              <SelectOption value="BUTTON">按钮/接口</SelectOption>
            </Select>
          </FormItem>
          <FormItem label="上级菜单 ID" style="flex:1">
            <InputNumber v-model:value="form.parentId" :min="0" style="width:100%" />
          </FormItem>
        </div>
        <div style="display:flex;gap:12px">
          <FormItem label="菜单名称" required style="flex:1">
            <Input v-model:value="form.menuName" placeholder="如：用户管理" />
          </FormItem>
          <FormItem label="菜单标识（name）" required style="flex:1">
            <Input v-model:value="form.menuKey" placeholder="如：SystemUser" />
          </FormItem>
        </div>
        <template v-if="form.menuType !== 'BUTTON'">
          <div style="display:flex;gap:12px">
            <FormItem label="路由路径" style="flex:1">
              <Input v-model:value="form.path" placeholder="/system/user" />
            </FormItem>
            <FormItem label="组件路径" style="flex:1">
              <Input v-model:value="form.component" placeholder="system/user/index" />
            </FormItem>
          </div>
          <div style="display:flex;gap:12px">
            <FormItem label="图标" style="flex:1">
              <Input v-model:value="form.icon" placeholder="lucide:users" />
            </FormItem>
            <FormItem label="排序" style="flex:1">
              <InputNumber v-model:value="form.sortOrder" :min="0" style="width:100%" />
            </FormItem>
          </div>
          <div style="display:flex;gap:24px">
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
          <Select v-model:value="form.status">
            <SelectOption value="active">启用</SelectOption>
            <SelectOption value="inactive">禁用</SelectOption>
          </Select>
        </FormItem>
        <FormItem label="备注">
          <Input v-model:value="form.remark" placeholder="可选" />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
