<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';

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
  Switch,
  Table,
  Tag,
  Tooltip,
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

// 菜单树节点（后端返回或本地映射后）
interface MenuTreeNode {
  key: number;
  title: string;
  menuType: string;
  children?: MenuTreeNode[];
}

// 后端菜单原始形态（嵌套）
interface ApiMenuNode {
  id: number;
  menuName: string;
  menuType: string;
  children?: ApiMenuNode[];
}

const roles = ref<RoleVO[]>([]);
const loading = ref(false);
const keyword = ref('');

// 统计信息：从 roles 数据计算
const stats = computed(() => {
  const total = roles.value.length;
  const active = roles.value.filter((r) => r.status === 'active').length;
  const inactive = total - active;
  return { total, active, inactive };
});

/** 从后端错误对象提取可读文案 */
function pickErrMsg(err: unknown, fallback: string): string {
  const anyErr = err as any;
  return (
    anyErr?.response?.data?.msg ??
    anyErr?.response?.data?.message ??
    anyErr?.message ??
    fallback
  );
}

async function loadRoles() {
  loading.value = true;
  try {
    const res: any = await authClient.get('/roles', {
      params: { keyword: keyword.value || undefined, size: 50 },
    });
    roles.value = res.items ?? [];
  } catch (error) {
    console.warn('[role] loadRoles failed', error);
    roles.value = [];
    message.error(pickErrMsg(error, '角色列表加载失败'));
  } finally {
    loading.value = false;
  }
}

onMounted(loadRoles);

const columns = [
  { title: '角色标识', dataIndex: 'roleKey', key: 'roleKey', width: 180 },
  { title: '角色名称', dataIndex: 'roleName', width: 140 },
  { title: '类型', key: 'type', width: 100 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '操作', key: 'action', width: 130 },
];

// ===== 创建角色 =====
const createVisible = ref(false);
const createRef = ref();
const createForm = ref({ roleKey: '', roleName: '' });

function openCreate() {
  createForm.value = { roleKey: '', roleName: '' };
  createVisible.value = true;
}

async function submitCreate() {
  try {
    await createRef.value?.validate();
  } catch {
    return; // 校验失败
  }
  try {
    await authClient.post('/roles', { ...createForm.value, isSystem: false });
    message.success(`角色 ${createForm.value.roleName} 创建成功`);
    createVisible.value = false;
    loadRoles();
  } catch (error) {
    console.warn('[role] create failed', error);
    message.error(pickErrMsg(error, '角色创建失败'));
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
  } catch {
    return;
  }
  if (!editingRole.value) return;
  try {
    await authClient.put(`/roles/${editingRole.value.id}`, editForm.value);
    message.success(`角色 ${editForm.value.roleName} 已更新`);
    editVisible.value = false;
    loadRoles();
  } catch (error) {
    console.warn('[role] update failed', error);
    message.error(pickErrMsg(error, '角色更新失败'));
  }
}

async function toggleRoleStatus(role: RoleVO, checked: boolean) {
  const newStatus = checked ? 'active' : 'inactive';
  try {
    await authClient.put(`/roles/${role.id}`, {
      roleName: role.roleName,
      status: newStatus,
    });
    role.status = newStatus;
    message.success(
      `角色 ${role.roleName} 已${newStatus === 'active' ? '启用' : '停用'}`,
    );
  } catch (error) {
    console.warn('[role] toggle status failed', error);
    message.error(pickErrMsg(error, '状态切换失败'));
  }
}

// ===== 分配菜单抽屉 =====
const menuDrawerVisible = ref(false);
const currentRole = ref<null | RoleVO>(null);
const menuTree = ref<MenuTreeNode[]>([]);
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
    // 后端可能返回 {menuIds:[...]} 或裸数组两种形态，统一归一化，
    // 避免对象被当成空数组导致抽屉内全部未勾选、误存清空菜单权限。
    const raw = Array.isArray(roleMenuIds) ? roleMenuIds : roleMenuIds?.menuIds;
    checkedMenuIds.value = Array.isArray(raw) ? raw : [];
  } catch (error) {
    console.warn('[role] load menu tree failed', error);
    menuTree.value = [];
    checkedMenuIds.value = [];
    message.error(pickErrMsg(error, '菜单权限加载失败'));
  } finally {
    menuLoading.value = false;
  }
}

async function saveMenus() {
  if (!currentRole.value) return;
  const role = currentRole.value;
  try {
    await authClient.put(`/roles/${role.id}/menus`, {
      menuIds: checkedMenuIds.value,
    });
    message.success(`${role.roleName} 菜单权限已保存`);
    menuDrawerVisible.value = false;
  } catch (error) {
    console.warn('[role] save menus failed', error);
    message.error(pickErrMsg(error, '菜单权限保存失败'));
  }
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
      try {
        await authClient.delete(`/roles/${role.id}`);
        message.success('角色已删除');
        loadRoles();
      } catch (error) {
        console.warn('[role] delete failed', error);
        message.error(pickErrMsg(error, '角色删除失败'));
      }
    },
  });
}

// 菜单类型 -> 标签文字 + 颜色
const MENU_TYPE_META: Record<string, { color: string; label: string }> = {
  BUTTON: { label: '按钮', color: 'amber' },
  DIRECTORY: { label: '目录', color: 'blue' },
  MENU: { label: '菜单', color: 'green' },
};

/** 将后端已嵌套的菜单树映射为 Ant Design Tree 格式 */
function mapApiTree(nodes: ApiMenuNode[]): MenuTreeNode[] {
  if (!nodes) return [];
  return nodes.map((m) => {
    const children =
      m.children && m.children.length > 0 ? mapApiTree(m.children) : undefined;
    return {
      title: m.menuName,
      key: m.id,
      menuType: m.menuType,
      children,
    };
  });
}
</script>

<template>
  <Page>
    <!-- 工具栏：统计 + 搜索 + 新增 -->
    <div
      class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"
    >
      <!-- 左侧：标题 + 统计胶囊 -->
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">角色管理</span>
        <span class="h-4 w-px bg-border"></span>
        <span
          class="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        >
          共 {{ stats.total }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        >
          启用 {{ stats.active }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400"
        >
          停用 {{ stats.inactive }}
        </span>
      </div>

      <!-- 右侧：搜索 + 新增 -->
      <div class="flex items-center gap-2">
        <Input
          v-model:value="keyword"
          allow-clear
          placeholder="搜索角色名/标识..."
          style="width: 200px"
          @press-enter="loadRoles"
        >
          <template #prefix>
            <Icon icon="lucide:search" class="text-muted-foreground" />
          </template>
        </Input>
        <Button type="primary" @click="openCreate">
          <template #icon><Icon icon="lucide:plus" /></template>
          新增角色
        </Button>
      </div>
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
        <!-- 角色标识：monospace -->
        <template v-if="column.key === 'roleKey'">
          <code class="font-mono text-xs">{{ record.roleKey }}</code>
        </template>

        <!-- 类型 -->
        <template v-else-if="column.key === 'type'">
          <Tag :color="record.isSystem ? 'purple' : 'default'">
            {{ record.isSystem ? '系统内置' : '自定义' }}
          </Tag>
        </template>

        <!-- 状态：行内 Switch 开关 -->
        <template v-else-if="column.key === 'status'">
          <Switch
            :checked="record.status === 'active'"
            :disabled="record.isSystem"
            checked-children="启用"
            un-checked-children="停用"
            @change="
              (checked: any) => toggleRoleStatus(record as RoleVO, !!checked)
            "
          />
        </template>

        <!-- 操作：图标按钮 -->
        <template v-else-if="column.key === 'action'">
          <Space size="small">
            <Tooltip title="编辑">
              <Button
                type="text"
                size="small"
                class="text-slate-500 hover:text-slate-700"
                @click="openEditRole(record as RoleVO)"
              >
                <template #icon><Icon icon="lucide:pencil" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="分配菜单">
              <Button
                type="text"
                size="small"
                class="text-blue-500 hover:text-blue-600"
                @click="openMenuDrawer(record as RoleVO)"
              >
                <template #icon><Icon icon="lucide:list-tree" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                class="text-red-400 hover:text-red-600"
                :disabled="record.isSystem"
                @click="deleteRole(record as RoleVO)"
              >
                <template #icon><Icon icon="lucide:trash-2" /></template>
              </Button>
            </Tooltip>
          </Space>
        </template>
      </template>
    </Table>

    <!-- 新增角色 Drawer -->
    <Drawer
      v-model:open="createVisible"
      title="新增角色"
      placement="right"
      :width="480"
    >
      <Form ref="createRef" :model="createForm" layout="vertical">
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
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button @click="createVisible = false">取消</Button>
          <Button type="primary" @click="submitCreate">创建</Button>
        </div>
      </template>
    </Drawer>

    <!-- 编辑角色 Drawer -->
    <Drawer
      v-model:open="editVisible"
      title="编辑角色"
      placement="right"
      :width="480"
    >
      <Form ref="editRef" :model="editForm" layout="vertical">
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
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button @click="editVisible = false">取消</Button>
          <Button type="primary" @click="submitEdit">保存</Button>
        </div>
      </template>
    </Drawer>

    <!-- 菜单分配抽屉 -->
    <Drawer
      v-model:open="menuDrawerVisible"
      :title="`分配菜单 — ${currentRole?.roleName}`"
      placement="right"
      :width="480"
    >
      <div
        v-if="menuLoading"
        class="flex h-40 items-center justify-center text-gray-400"
      >
        加载中...
      </div>
      <Tree
        v-else
        v-model:checked-keys="checkedMenuIds"
        :tree-data="menuTree"
        checkable
        default-expand-all
      >
        <template #title="{ title, menuType }">
          <span class="inline-flex items-center gap-1.5">
            <span
              class="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium leading-tight"
              :class="{
                'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400':
                  menuType === 'DIRECTORY',
                'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400':
                  menuType === 'MENU',
                'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400':
                  menuType === 'BUTTON',
              }"
            >
              {{ MENU_TYPE_META[menuType]?.label ?? '目录' }}
            </span>
            <span>{{ title }}</span>
          </span>
        </template>
      </Tree>
      <template #footer>
        <div class="flex gap-3 justify-end">
          <Button @click="menuDrawerVisible = false">取消</Button>
          <Button type="primary" :disabled="menuLoading" @click="saveMenus">
            保存权限
          </Button>
        </div>
      </template>
    </Drawer>
  </Page>
</template>
