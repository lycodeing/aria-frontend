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
  message,
  Modal,
  Select,
  SelectOption,
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
const form = reactive<any>(emptyForm());

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
  <Page :description="`管理 ${pageTitle} 类配置项`" :title="pageTitle">
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
      :scroll="{ x: 900 }"
      row-key="id"
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
          <Button
            size="small"
            type="link"
            @click="openEdit(record as SystemConfigVO)"
            >编辑</Button
          >
          <Button
            :disabled="record.isSystem"
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
        <!-- 新增时可编辑 configKey / valueType / configGroup -->
        <template v-if="!editingId">
          <FormItem label="配置键" required>
            <Input
              v-model:value="form.configKey"
              placeholder="如 agent.xxx（创建后不可改）"
            />
          </FormItem>
          <FormItem label="值类型" required>
            <Select v-model:value="form.valueType" style="width: 100%">
              <SelectOption v-for="vt in VALUE_TYPES" :key="vt" :value="vt">{{
                vt
              }}</SelectOption>
            </Select>
          </FormItem>
          <FormItem label="分组">
            <Input
              v-model:value="form.configGroup"
              placeholder="如 座席 / 知识库 / 提示词"
            />
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
