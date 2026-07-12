<script lang="ts" setup>
import type { TableColumnsType } from 'ant-design-vue';

import type { SystemConfigVO } from '#/api/system-config';

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Form,
  FormItem,
  Input,
  message,
  Modal,
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

// ===== Route meta: configType 由路由注入，用 computed 保证跨路由复用时响应式更新 =====
const route = useRoute();
const configType = computed(
  () => (route.meta.configType as string) ?? 'CUSTOMER_SERVICE',
);
const pageTitle = computed(() =>
  configType.value === 'CUSTOMER_SERVICE' ? '客服配置' : '系统配置',
);

// ===== 列表状态 =====
const list = ref<SystemConfigVO[]>([]);
const total = ref(0);
const loading = ref(false);
const keyword = ref('');
const currentPage = ref(1);
const pageSize = ref(20);

// ===== 弹窗状态 =====
const modalOpen = ref(false);
const editingId = ref<null | number | string>(null);
const submitting = ref(false);

// ===== 表单状态 =====
const emptyForm = () => ({
  configKey: '',
  configValue: '',
  configType: configType.value,
  description: '',
});
const form = reactive<any>(emptyForm());

// ===== 表格列定义 =====
const columns: TableColumnsType = [
  { title: '配置键', dataIndex: 'configKey', width: 240, ellipsis: true },
  { title: '说明', dataIndex: 'description', ellipsis: true },
  { title: '配置值', dataIndex: 'configValue', width: 200, ellipsis: true },
  { title: '启用', dataIndex: 'isEnabled', width: 70 },
  { title: '操作', key: 'action', width: 120, fixed: 'right' },
];

// ===== 加载列表 =====
async function loadList() {
  loading.value = true;
  try {
    const result = await listSystemConfigsApi({
      configType: configType.value,
      keyword: keyword.value || undefined,
      page: currentPage.value - 1, // 0-based
      size: pageSize.value,
    });
    list.value = result.items;
    total.value = Number(result.total); // 后端返回字符串，转 number
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
    description: row.description ?? '',
  });
  modalOpen.value = true;
}

// ===== 提交（新增 / 编辑） =====
async function submit() {
  if (!form.configKey.trim() && editingId.value === null) {
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
        description: form.description,
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
    title: `确认删除「${row.description || row.configKey}」？`,
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

// 路由在两个配置页间切换时（组件复用），重置并重载
watch(configType, () => {
  currentPage.value = 1;
  keyword.value = '';
  loadList();
});
</script>

<template>
  <Page :description="`管理 ${pageTitle} 类配置项`" :title="pageTitle">
    <!-- 搜索栏 -->
    <div class="mb-3 flex items-center gap-2">
      <Input
        v-model:value="keyword"
        allow-clear
        placeholder="搜索配置键"
        style="width: 240px"
        @press-enter="onSearch"
      />
      <Button type="primary" @click="onSearch">搜索</Button>
      <Button style="margin-left: auto" type="primary" @click="openCreate"
        >新增配置</Button
      >
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
        onChange: (p: number) => {
          currentPage = p;
          loadList();
        },
      }"
      :scroll="{ x: 800 }"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'isEnabled'">
          <Tag :color="record.isEnabled ? 'green' : 'default'">
            {{ record.isEnabled ? '启用' : '停用' }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <Button
            size="small"
            type="link"
            @click="openEdit(record as SystemConfigVO)"
            >编辑</Button
          >
          <Button
            danger
            size="small"
            type="link"
            @click="confirmDelete(record as SystemConfigVO)"
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
        <!-- 新增时可编辑 configKey -->
        <template v-if="!editingId">
          <FormItem label="配置键" required>
            <Input
              v-model:value="form.configKey"
              placeholder="如 agent.xxx（创建后不可改）"
            />
          </FormItem>
        </template>

        <!-- 编辑时只读展示 configKey -->
        <template v-else>
          <FormItem label="配置键">
            <Input :value="form.configKey" disabled />
          </FormItem>
        </template>

        <FormItem label="配置值">
          <Textarea
            v-model:value="form.configValue"
            :auto-size="{ minRows: 2, maxRows: 8 }"
            placeholder="填入配置值"
          />
        </FormItem>
        <FormItem label="说明">
          <Input
            v-model:value="form.description"
            placeholder="可选，配置说明"
          />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
