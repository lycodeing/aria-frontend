<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
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
} from 'ant-design-vue';

import { authClient } from '#/api/request';

// ===== 用户列表 =====
interface UserVO {
  id: number;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  status: string;
  provider: string;
  lastLoginAt: string;
}

const users = ref<UserVO[]>([]);
const total = ref(0);
const loading = ref(false);
const keyword = ref('');
const currentPage = ref(1);
const PAGE_SIZE = 10;

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

async function loadUsers() {
  loading.value = true;
  try {
    const res: any = await authClient.get('/users', {
      params: {
        keyword: keyword.value || undefined,
        page: currentPage.value - 1,
        size: PAGE_SIZE,
      },
    });
    users.value = res.items ?? [];
    // 优先使用服务端返回的 total；不返回时降级为当前页条数（分页 UI 会退化为单页）
    const resTotal = Number(res.total);
    total.value =
      Number.isFinite(resTotal) && resTotal > 0 ? resTotal : users.value.length;
  } catch (error) {
    console.warn('[user] loadUsers failed', error);
    users.value = [];
    total.value = 0;
    message.error(pickErrMsg(error, '用户列表加载失败'));
  } finally {
    loading.value = false;
  }
}

/** 分页切换：命名 handler 便于在模板中调用，避免在模板表达式里给 ref 重新赋值 */
function onPageChange(page: number) {
  currentPage.value = page;
  loadUsers();
}

onMounted(loadUsers);

const columns = [
  { title: '用户', key: 'user', width: 180 },
  {
    title: '邮箱',
    dataIndex: 'email',
    key: 'email',
    width: 200,
    ellipsis: true,
  },
  {
    title: '手机号',
    dataIndex: 'phone',
    key: 'phone',
    width: 130,
    ellipsis: true,
  },
  { title: '来源', key: 'provider', width: 80, align: 'center' as const },
  {
    title: '最后登录',
    key: 'lastLogin',
    width: 120,
    align: 'center' as const,
  },
  { title: '状态', key: 'status', width: 80, align: 'center' as const },
  { title: '操作', key: 'action', width: 130, align: 'center' as const },
];

// ===== 统计（基于当前页数据，分页组件已展示服务端总数） =====
const stats = computed(() => ({
  total: users.value.length,
  active: users.value.filter((u) => u.status === 'active').length,
  disabled: users.value.filter((u) => u.status !== 'active').length,
}));

// ===== 来源标签映射 =====
const PROVIDER_LABEL: Record<string, string> = {
  LOCAL: '本地',
  OAUTH: 'OAuth',
};

// ===== 头像背景色（根据用户名首字母取模选色） =====
const AVATAR_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
] as const;
function avatarColor(name: string): string {
  const code = name.codePointAt(0) || 0;
  return (
    AVATAR_COLORS[code % AVATAR_COLORS.length] ?? AVATAR_COLORS[0] ?? '#3b82f6'
  );
}

// ===== 相对时间格式化（复用项目既有模式） =====
function relativeTime(iso?: string): string {
  if (!iso) return '从未登录';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '从未登录';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

// 绝对时间格式化（供 Tooltip 展示）
function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===== 新建/编辑用户 =====
const modalVisible = ref(false);
const isEdit = ref(false);
const editingId = ref<null | number>(null);
const formRef = ref();
const form = ref({
  username: '',
  displayName: '',
  email: '',
  phone: '',
  password: '',
});

function openCreate() {
  isEdit.value = false;
  editingId.value = null;
  form.value = {
    username: '',
    displayName: '',
    email: '',
    phone: '',
    password: '',
  };
  modalVisible.value = true;
}

function openEdit(user: UserVO) {
  isEdit.value = true;
  editingId.value = user.id;
  form.value = {
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone ?? '',
    password: '',
  };
  modalVisible.value = true;
}

async function submitForm() {
  try {
    await formRef.value?.validate();
  } catch {
    return; // 表单校验失败
  }
  try {
    if (isEdit.value && editingId.value) {
      const { password: _pwd, ...updatePayload } = form.value;
      await authClient.put(`/users/${editingId.value}`, updatePayload);
      message.success('用户信息已更新');
    } else {
      await authClient.post('/users', form.value);
      message.success(`用户 ${form.value.username} 创建成功`);
    }
    modalVisible.value = false;
    loadUsers();
  } catch (error) {
    console.warn('[user] submit failed', error);
    message.error(pickErrMsg(error, '保存失败'));
  }
}

// ===== 用户操作 =====
async function toggleStatus(user: UserVO) {
  const willDisable = user.status === 'active';
  const action = willDisable ? 'disable' : 'enable';
  try {
    await authClient.post(`/users/${user.id}/${action}`);
    user.status = willDisable ? 'disabled' : 'active';
    message.success(`用户 ${user.username} 已${willDisable ? '禁用' : '启用'}`);
  } catch (error) {
    console.warn('[user] toggle status failed', error);
    message.error(pickErrMsg(error, '状态切换失败'));
  }
}

/**
 * 生成一个符合复杂度要求的随机初始密码：≥ 8 位，含大写/小写/数字/特殊字符。
 * 客户端生成 + 后端校验；后端如返回自身生成的密码，前端应改为回显后端值。
 */
function genTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digit + special;
  const pick = (pool: string): string =>
    pool.charAt(Math.floor(Math.random() * pool.length));
  // 保证大小写/数字/特殊字符各至少 1 个，再补足到 10 位
  const parts: string[] = [
    pick(upper),
    pick(lower),
    pick(digit),
    pick(special),
  ];
  for (let i = 0; i < 6; i++) parts.push(pick(all));
  // Fisher–Yates 洗牌，避免固定位置泄露字符类型
  for (let i = parts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = parts[i] ?? '';
    parts[i] = parts[j] ?? tmp;
    parts[j] = tmp;
  }
  return parts.join('');
}

function resetPwd(user: UserVO) {
  const tempPwd = genTempPassword();
  Modal.confirm({
    title: `重置 ${user.username} 的密码`,
    content: `重置后新密码为 ${tempPwd}，请复制并告知用户及时修改。`,
    onOk: async () => {
      try {
        const res: any = await authClient.post(
          `/users/${user.id}/reset-password`,
          {
            newPassword: tempPwd,
          },
        );
        // 若后端返回自己生成的密码，以回显为准，避免提示的密码与后端实际设置不一致
        const echoed: unknown = res?.password ?? res?.newPassword;
        const finalPwd =
          typeof echoed === 'string' && echoed.length > 0 ? echoed : tempPwd;
        message.success(`新密码：${finalPwd}`);
      } catch (error) {
        console.warn('[user] reset password failed', error);
        message.error(pickErrMsg(error, '密码重置失败'));
      }
    },
  });
}

function deleteUser(user: UserVO) {
  Modal.confirm({
    title: `确认删除用户 ${user.username}？`,
    okType: 'danger',
    onOk: async () => {
      try {
        await authClient.delete(`/users/${user.id}`);
        message.success('用户已删除');
        loadUsers();
      } catch (error) {
        console.warn('[user] delete failed', error);
        message.error(pickErrMsg(error, '用户删除失败'));
      }
    },
  });
}
</script>

<template>
  <Page>
    <!-- 工具栏：统计 + 搜索 + 新增 -->
    <div
      class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"
    >
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold">用户管理</span>
        <span class="h-4 w-px bg-border"></span>
        <span
          class="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        >
          本页 {{ stats.total }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        >
          活跃 {{ stats.active }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-900/30 dark:text-red-400"
        >
          禁用 {{ stats.disabled }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Input
          v-model:value="keyword"
          allow-clear
          placeholder="搜索用户名 / 邮箱"
          style="width: 200px"
          @press-enter="loadUsers"
        >
          <template #prefix>
            <Icon icon="lucide:search" class="text-muted-foreground" />
          </template>
        </Input>
        <Button type="primary" @click="openCreate">
          <template #icon><Icon icon="lucide:plus" /></template>
          新增用户
        </Button>
      </div>
    </div>

    <!-- 用户表格 -->
    <Table
      :columns="columns"
      :data-source="users"
      :loading="loading"
      row-key="id"
      :pagination="{
        total,
        pageSize: PAGE_SIZE,
        current: currentPage,
        showTotal: (t: number) => `共 ${t} 条`,
        onChange: onPageChange,
      }"
    >
      <template #bodyCell="{ column, record }">
        <!-- 用户：头像 + 用户名 + 姓名 -->
        <template v-if="column.key === 'user'">
          <div class="flex items-center gap-2">
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              :style="{ background: avatarColor(record.username) }"
            >
              {{ (record.username || '?').charAt(0).toUpperCase() }}
            </div>
            <div class="min-w-0">
              <div class="truncate font-medium">{{ record.username }}</div>
              <div class="truncate text-xs text-muted-foreground">
                {{ record.displayName }}
              </div>
            </div>
          </div>
        </template>

        <!-- 来源 -->
        <template v-if="column.key === 'provider'">
          <Tag v-if="record.provider === 'OAUTH'" color="purple">
            {{ PROVIDER_LABEL[record.provider] ?? record.provider }}
          </Tag>
          <span v-else class="text-xs text-muted-foreground">
            {{ PROVIDER_LABEL[record.provider] ?? record.provider ?? '本地' }}
          </span>
        </template>

        <!-- 最后登录：相对时间 + Tooltip 绝对时间 -->
        <template v-if="column.key === 'lastLogin'">
          <Tooltip
            v-if="record.lastLoginAt"
            :title="formatDateTime(record.lastLoginAt)"
          >
            <span class="cursor-default text-xs text-muted-foreground">
              {{ relativeTime(record.lastLoginAt) }}
            </span>
          </Tooltip>
          <span v-else class="text-xs text-muted-foreground/60">从未登录</span>
        </template>

        <!-- 状态：行内开关 -->
        <template v-if="column.key === 'status'">
          <Switch
            :checked="record.status === 'active'"
            size="small"
            @change="toggleStatus(record as UserVO)"
          />
        </template>

        <!-- 操作：图标按钮 -->
        <template v-if="column.key === 'action'">
          <Space size="small">
            <Tooltip title="编辑">
              <Button
                type="text"
                size="small"
                @click="openEdit(record as UserVO)"
              >
                <template #icon><Icon icon="lucide:pencil" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="重置密码">
              <Button
                type="text"
                size="small"
                @click="resetPwd(record as UserVO)"
              >
                <template #icon><Icon icon="lucide:key-round" /></template>
              </Button>
            </Tooltip>
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                @click="deleteUser(record as UserVO)"
              >
                <template #icon><Icon icon="lucide:trash-2" /></template>
              </Button>
            </Tooltip>
          </Space>
        </template>
      </template>
    </Table>

    <!-- 新建用户弹窗 -->
    <Modal
      v-model:open="modalVisible"
      :title="isEdit ? '编辑用户' : '新增用户'"
      :ok-text="isEdit ? '保存' : '创建'"
      @ok="submitForm"
    >
      <Form ref="formRef" :model="form" :label-col="{ span: 5 }" class="mt-4">
        <FormItem
          label="用户名"
          name="username"
          :rules="[
            { required: true, message: '请输入用户名' },
            { min: 3, max: 50, message: '用户名长度须为 3~50 位' },
          ]"
        >
          <Input
            v-model:value="form.username"
            placeholder="登录账号（英文,3~50 位）"
            :disabled="isEdit"
          />
        </FormItem>
        <FormItem
          label="姓名"
          name="displayName"
          :rules="[{ required: true, message: '请输入显示名称' }]"
        >
          <Input v-model:value="form.displayName" placeholder="显示名称" />
        </FormItem>
        <FormItem
          label="邮箱"
          name="email"
          :rules="[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '请输入有效邮箱' },
          ]"
        >
          <Input v-model:value="form.email" placeholder="邮箱地址" />
        </FormItem>
        <FormItem label="手机号" name="phone">
          <Input v-model:value="form.phone" placeholder="手机号码" />
        </FormItem>
        <FormItem
          v-if="!isEdit"
          label="初始密码"
          name="password"
          :rules="[
            { required: true, message: '请设置初始密码' },
            {
              pattern:
                /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':\\|,.<>/?]).{8,}$/,
              message: '至少8位,须含大写字母、数字和特殊字符',
            },
          ]"
        >
          <Input.Password
            v-model:value="form.password"
            placeholder="至少8位,须含大写字母、数字和特殊字符"
          />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
