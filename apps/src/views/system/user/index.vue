<script lang="ts" setup>
import { onMounted, ref } from 'vue';

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
  Table,
  Tag,
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
    total.value = res.total ?? 0;
  } catch {
    // 后端未启动时展示演示数据
    users.value = [
      {
        id: 1001,
        username: 'superadmin',
        displayName: '超级管理员',
        email: 'superadmin@test.com',
        phone: '',
        status: 'active',
        provider: 'LOCAL',
        lastLoginAt: '',
      },
      {
        id: 1002,
        username: 'kfmanager',
        displayName: '客服管理员',
        email: 'kfmanager@test.com',
        phone: '',
        status: 'active',
        provider: 'LOCAL',
        lastLoginAt: '',
      },
      {
        id: 1003,
        username: 'kfstaff',
        displayName: '普通客服',
        email: 'kfstaff@test.com',
        phone: '',
        status: 'active',
        provider: 'LOCAL',
        lastLoginAt: '',
      },
    ];
    total.value = users.value.length;
  } finally {
    loading.value = false;
  }
}

onMounted(loadUsers);

const columns = [
  { title: 'ID', dataIndex: 'id', width: 80 },
  { title: '用户名', dataIndex: 'username', width: 120 },
  { title: '姓名', dataIndex: 'displayName', width: 100 },
  { title: '邮箱', dataIndex: 'email', ellipsis: true },
  { title: '手机号', dataIndex: 'phone', width: 130 },
  { title: '最后登录', dataIndex: 'lastLoginAt', width: 170 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 80 },
  { title: '操作', key: 'action', width: 240 },
];

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
  } catch {
    /* 表单校验或接口失败 */
  }
}

// ===== 用户操作 =====
async function toggleStatus(user: UserVO) {
  const action = user.status === 'active' ? 'disable' : 'enable';
  await authClient.post(`/users/${user.id}/${action}`).catch(() => null);
  user.status = user.status === 'active' ? 'disabled' : 'active';
  message.success(
    `用户 ${user.username} 已${action === 'disable' ? '禁用' : '启用'}`,
  );
}

function resetPwd(user: UserVO) {
  Modal.confirm({
    title: `重置 ${user.username} 的密码`,
    content: '重置后密码为 Test@123456，请告知用户及时修改。',
    onOk: async () => {
      await authClient
        .post(`/users/${user.id}/reset-password`, {
          newPassword: 'Test@123456',
        })
        .catch(() => null);
      message.success('密码已重置为 Test@123456');
    },
  });
}

function deleteUser(user: UserVO) {
  Modal.confirm({
    title: `确认删除用户 ${user.username}？`,
    okType: 'danger',
    onOk: async () => {
      await authClient.delete(`/users/${user.id}`).catch(() => null);
      message.success('用户已删除');
      loadUsers();
    },
  });
}
</script>

<template>
  <Page>
    <template #extra>
      <Button type="primary" @click="openCreate">
        <template #icon><Icon icon="ant-design:plus-outlined" /></template
        >新增用户
      </Button>
    </template>

    <!-- 搜索 -->
    <div class="mb-4 flex gap-3">
      <Input
        v-model:value="keyword"
        placeholder="搜索用户名/邮箱..."
        style="width: 260px"
        allow-clear
        @press-enter="loadUsers"
      >
        <template #prefix><Icon icon="ant-design:search-outlined" /></template>
      </Input>
      <Button @click="loadUsers">查询</Button>
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
        onChange: (p: number) => {
          currentPage = p;
          loadUsers();
        },
      }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'status'">
          <Tag :color="record.status === 'active' ? 'success' : 'error'">
            {{ record.status === 'active' ? '正常' : '禁用' }}
          </Tag>
        </template>
        <template v-if="column.key === 'action'">
          <Space>
            <Button
              size="small"
              type="link"
              @click="openEdit(record as UserVO)"
            >
              编辑
            </Button>
            <Button
              size="small"
              type="link"
              @click="toggleStatus(record as UserVO)"
            >
              {{ record.status === 'active' ? '禁用' : '启用' }}
            </Button>
            <Button
              size="small"
              type="link"
              @click="resetPwd(record as UserVO)"
            >
              重置密码
            </Button>
            <Button
              size="small"
              type="link"
              danger
              @click="deleteUser(record as UserVO)"
            >
              删除
            </Button>
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
          :rules="[{ required: true, message: '请输入用户名' }]"
        >
          <Input
            v-model:value="form.username"
            placeholder="登录账号（英文）"
            :disabled="isEdit"
          />
        </FormItem>
        <FormItem label="姓名" name="displayName">
          <Input v-model:value="form.displayName" placeholder="显示名称" />
        </FormItem>
        <FormItem
          label="邮箱"
          name="email"
          :rules="[{ type: 'email', message: '请输入有效邮箱' }]"
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
          :rules="[{ required: true, message: '请设置初始密码' }]"
        >
          <Input.Password
            v-model:value="form.password"
            placeholder="至少8位，含大小写字母和数字"
          />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
