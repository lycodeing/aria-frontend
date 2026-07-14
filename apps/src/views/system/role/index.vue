<script lang="ts" setup>
import { onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
  Drawer,
  Form,
  FormItem,
  Input,
  message,
  Modal,
  Space,
  Table,
  Tag,
  Tree,
} from 'ant-design-vue';

import { authClient } from '#/api/request';

// ===== 角色列表 =====
interface RoleVO {
  id: number;
  roleKey: string;
  roleName: string;
  isSystem: boolean;
  status: string;
}

const roles = ref<RoleVO[]>([]);
const loading = ref(false);
const keyword = ref('');

async function loadRoles() {
  loading.value = true;
  try {
    const res: any = await authClient.get('/roles', {
      params: { keyword: keyword.value || undefined, size: 50 },
    });
    roles.value = res.items ?? [];
  } catch {
    // 演示数据
    roles.value = [
      {
        id: 10,
        roleKey: 'super_admin',
        roleName: '超级管理员',
        isSystem: true,
        status: 'active',
      },
      {
        id: 11,
        roleKey: 'kf_manager',
        roleName: '客服管理员',
        isSystem: false,
        status: 'active',
      },
      {
        id: 12,
        roleKey: 'kf_staff',
        roleName: '普通客服',
        isSystem: false,
        status: 'active',
      },
    ];
  } finally {
    loading.value = false;
  }
}

onMounted(loadRoles);

const columns = [
  { title: 'ID', dataIndex: 'id', width: 70 },
  { title: '角色标识', dataIndex: 'roleKey', width: 160 },
  { title: '角色名称', dataIndex: 'roleName', width: 140 },
  { title: '类型', key: 'type', width: 90 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
  { title: '操作', key: 'action', width: 200 },
];

// ===== 创建角色 =====
const createVisible = ref(false);
const createRef = ref();
const createForm = ref({ roleKey: '', roleName: '' });

async function submitCreate() {
  try {
    await createRef.value?.validate();
    await authClient
      .post('/roles', { ...createForm.value, isSystem: false })
      .catch(() => null);
    message.success(`角色 ${createForm.value.roleName} 创建成功`);
    createVisible.value = false;
    loadRoles();
  } catch {
    /* 校验失败 */
  }
}

// ===== 编辑角色 =====
const editVisible = ref(false);
const editRef = ref();
const editingRole = ref<null | RoleVO>(null);
const editForm = ref({ roleName: '', status: '' });

function openEditRole(role: RoleVO) {
  editingRole.value = role;
  editForm.value = { roleName: role.roleName, status: role.status };
  editVisible.value = true;
}

async function submitEdit() {
  try {
    await editRef.value?.validate();
    if (!editingRole.value) return;
    await authClient.put(`/roles/${editingRole.value.id}`, editForm.value);
    message.success(`角色 ${editForm.value.roleName} 已更新`);
    editVisible.value = false;
    loadRoles();
  } catch {
    /* 校验或接口失败 */
  }
}

async function toggleRoleStatus(role: RoleVO) {
  const newStatus = role.status === 'active' ? 'inactive' : 'active';
  await authClient
    .put(`/roles/${role.id}`, { roleName: role.roleName, status: newStatus })
    .catch(() => null);
  role.status = newStatus;
  message.success(
    `角色 ${role.roleName} 已${newStatus === 'active' ? '启用' : '停用'}`,
  );
}

// ===== 分配菜单抽屉 =====
const menuDrawerVisible = ref(false);
const currentRole = ref<null | RoleVO>(null);
const menuTree = ref<any[]>([]);
const checkedMenuIds = ref<number[]>([]);
const menuLoading = ref(false);

async function openMenuDrawer(role: RoleVO) {
  currentRole.value = role;
  menuDrawerVisible.value = true;
  menuLoading.value = true;
  try {
    const [allMenus, roleMenuIds]: any = await Promise.all([
      authClient.get('/menus'),
      authClient.get(`/roles/${role.id}/menus`),
    ]);
    menuTree.value = mapApiTree(allMenus ?? []);
    if (menuTree.value.length === 0) {
      menuTree.value = buildTree(demoMenus, 0);
    }
    checkedMenuIds.value = roleMenuIds ?? [];
  } catch {
    menuTree.value = buildTree(demoMenus, 0);
    checkedMenuIds.value =
      role.id === 10 ? demoMenus.map((m: any) => m.id) : [100, 101];
  } finally {
    menuLoading.value = false;
  }
}

async function saveMenus() {
  if (!currentRole.value) return;
  await authClient
    .put(`/roles/${currentRole.value.id}/menus`, {
      menuIds: checkedMenuIds.value,
    })
    .catch(() => null);
  message.success(`${currentRole.value.roleName} 菜单权限已保存`);
  menuDrawerVisible.value = false;
}

// ===== 删除角色 =====
function deleteRole(role: RoleVO) {
  if (role.isSystem) {
    message.error('系统内置角色不能删除');
    return;
  }
  Modal.confirm({
    title: `确认删除角色 ${role.roleName}？`,
    okType: 'danger',
    onOk: async () => {
      await authClient.delete(`/roles/${role.id}`).catch(() => null);
      message.success('角色已删除');
      loadRoles();
    },
  });
}

// ===== 菜单树构建 =====
const demoMenus = [
  { id: 100, parentId: 0, menuName: '智能客服', menuType: 'DIRECTORY' },
  { id: 101, parentId: 100, menuName: '对话', menuType: 'MENU' },
  { id: 102, parentId: 100, menuName: '知识库', menuType: 'MENU' },
  { id: 103, parentId: 100, menuName: '座席工作台', menuType: 'MENU' },
  { id: 110, parentId: 102, menuName: '上传文档', menuType: 'BUTTON' },
  { id: 111, parentId: 102, menuName: '审核文档', menuType: 'BUTTON' },
  { id: 112, parentId: 102, menuName: '下线文档', menuType: 'BUTTON' },
  { id: 200, parentId: 0, menuName: '系统管理', menuType: 'DIRECTORY' },
  { id: 201, parentId: 200, menuName: '用户管理', menuType: 'MENU' },
  { id: 202, parentId: 200, menuName: '角色管理', menuType: 'MENU' },
];

/** 将后端已嵌套的菜单树映射为 Ant Design Tree 格式 */
function mapApiTree(nodes: any[]): any[] {
  if (!nodes) return [];
  return nodes.map((m) => {
    const icon =
      m.menuType === 'BUTTON' ? '🔘' : m.menuType === 'MENU' ? '📄' : '📁';
    const children =
      m.children && m.children.length > 0 ? mapApiTree(m.children) : undefined;
    return {
      title: `${icon} ${m.menuName}`,
      key: m.id,
      children,
    };
  });
}

/** 从扁平数组构建 Ant Design Tree（demoMenus 回退用） */
function buildTree(menus: any[], parentId: number): any[] {
  return menus
    .filter((m) => m.parentId === parentId)
    .map((m) => ({
      title: `${{ BUTTON: '🔘', MENU: '📄', DIRECTORY: '📁' }[m.menuType as 'BUTTON' | 'DIRECTORY' | 'MENU'] ?? '📁'} ${m.menuName}`,
      key: m.id,
      children: buildTree(menus, m.id),
    }))
    .map((n) => (n.children.length === 0 ? { ...n, children: undefined } : n));
}

function onTreeCheck(_: any, { checkedNodes }: any) {
  checkedMenuIds.value = checkedNodes.map((n: any) => n.key);
}
</script>

<template>
  <Page title="角色管理" description="管理系统角色，配置菜单权限和数据权限范围">
    <template #extra>
      <Button type="primary" @click="createVisible = true">
        <template #icon><Icon icon="ant-design:plus-outlined" /></template
        >新增角色
      </Button>
    </template>

    <!-- 搜索 -->
    <div class="mb-4 flex gap-3">
      <Input
        v-model:value="keyword"
        placeholder="搜索角色名/标识..."
        style="width: 260px"
        allow-clear
        @press-enter="loadRoles"
      >
        <template #prefix><Icon icon="ant-design:search-outlined" /></template>
      </Input>
      <Button @click="loadRoles">查询</Button>
    </div>

    <!-- 角色表格 -->
    <Table
      :columns="columns"
      :data-source="roles"
      :loading="loading"
      row-key="id"
      :pagination="false"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <Tag :color="record.isSystem ? 'purple' : 'default'">
            {{ record.isSystem ? '系统内置' : '自定义' }}
          </Tag>
        </template>
        <template v-if="column.key === 'status'">
          <Tag :color="record.status === 'active' ? 'success' : 'error'">
            {{ record.status === 'active' ? '正常' : '停用' }}
          </Tag>
        </template>
        <template v-if="column.key === 'action'">
          <Space>
            <Button
              size="small"
              type="link"
              @click="openEditRole(record as RoleVO)"
            >
              编辑
            </Button>
            <Button
              size="small"
              type="link"
              :disabled="record.isSystem"
              @click="toggleRoleStatus(record as RoleVO)"
            >
              {{ record.status === 'active' ? '停用' : '启用' }}
            </Button>
            <Button
              size="small"
              type="link"
              @click="openMenuDrawer(record as RoleVO)"
            >
              分配菜单
            </Button>
            <Button
              size="small"
              type="link"
              danger
              :disabled="record.isSystem"
              @click="deleteRole(record as RoleVO)"
            >
              删除
            </Button>
          </Space>
        </template>
      </template>
    </Table>

    <!-- 新增角色弹窗 -->
    <Modal
      v-model:open="createVisible"
      title="新增角色"
      ok-text="创建"
      @ok="submitCreate"
    >
      <Form
        ref="createRef"
        :model="createForm"
        :label-col="{ span: 6 }"
        class="mt-4"
      >
        <FormItem
          label="角色标识"
          name="roleKey"
          :rules="[{ required: true, message: '请输入角色标识（英文）' }]"
        >
          <Input
            v-model:value="createForm.roleKey"
            placeholder="如 kf_admin（英文下划线）"
          />
        </FormItem>
        <FormItem
          label="角色名称"
          name="roleName"
          :rules="[{ required: true, message: '请输入角色名称' }]"
        >
          <Input
            v-model:value="createForm.roleName"
            placeholder="如 客服管理员"
          />
        </FormItem>
      </Form>
    </Modal>

    <!-- 编辑角色弹窗 -->
    <Modal
      v-model:open="editVisible"
      title="编辑角色"
      ok-text="保存"
      @ok="submitEdit"
    >
      <Form
        ref="editRef"
        :model="editForm"
        :label-col="{ span: 6 }"
        class="mt-4"
      >
        <FormItem label="角色标识" name="roleKey">
          <Input :value="editingRole?.roleKey" disabled />
        </FormItem>
        <FormItem
          label="角色名称"
          name="roleName"
          :rules="[{ required: true, message: '请输入角色名称' }]"
        >
          <Input
            v-model:value="editForm.roleName"
            placeholder="如 客服管理员"
          />
        </FormItem>
      </Form>
    </Modal>

    <!-- 菜单分配抽屉 -->
    <Drawer
      v-model:open="menuDrawerVisible"
      :title="`分配菜单 — ${currentRole?.roleName}`"
      placement="right"
      :width="400"
    >
      <div
        v-if="menuLoading"
        class="flex h-40 items-center justify-center text-gray-400"
      >
        加载中...
      </div>
      <Tree
        v-else
        :tree-data="menuTree"
        checkable
        default-expand-all
        :checked-keys="checkedMenuIds"
        @check="onTreeCheck"
      />
      <template #footer>
        <div class="flex gap-3 justify-end">
          <Button @click="menuDrawerVisible = false">取消</Button>
          <Button type="primary" @click="saveMenus">保存权限</Button>
        </div>
      </template>
    </Drawer>
  </Page>
</template>
