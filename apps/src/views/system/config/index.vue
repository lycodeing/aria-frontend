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
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import {
  createSystemConfigApi,
  deleteSystemConfigApi,
  listSystemConfigsApi,
  updateSystemConfigApi,
} from '#/api/system-config';

// ===== Route meta: configType 优先取 meta，降级从 path 判断
const route = useRoute();
const configType = computed(() => {
  if (route.meta.configType) return route.meta.configType as string;
  return route.path === '/system/config' ? 'SYSTEM' : 'CUSTOMER_SERVICE';
});

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

// 实时 Markdown 预览
const previewHtml = computed(() =>
  DOMPurify.sanitize(String(marked.parse(form.configValue ?? ''))),
);

// ===== 表格列定义 =====
const columns: TableColumnsType = [
  { title: '配置键', dataIndex: 'configKey', width: 200, ellipsis: true },
  { title: '配置值', dataIndex: 'configValue', width: 200, ellipsis: true },
  { title: '说明', dataIndex: 'description', ellipsis: true },
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
      page: currentPage.value - 1,
      size: pageSize.value,
    });
    list.value = result.items;
    total.value = Number(result.total);
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

// ===== 提交 =====
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
  if (!row.id) return;
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

watch(configType, () => {
  currentPage.value = 1;
  keyword.value = '';
  loadList();
});
</script>

<template>
  <Page>
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
      :scroll="{ x: 910 }"
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

    <!-- 新增 / 编辑弹窗（左编辑 右预览） -->
    <Modal
      v-model:open="modalOpen"
      :confirm-loading="submitting"
      :title="editingId ? `编辑配置 — ${form.configKey}` : '新增配置'"
      :width="editingId ? '900px' : '520px'"
      @ok="submit"
    >
      <Form class="mt-4" layout="vertical">
        <!-- 新增时填写 configKey -->
        <template v-if="!editingId">
          <FormItem label="配置键" required>
            <Input
              v-model:value="form.configKey"
              placeholder="如 agent.xxx（创建后不可改）"
            />
          </FormItem>
          <FormItem label="说明">
            <Input
              v-model:value="form.description"
              placeholder="可选，配置说明"
            />
          </FormItem>
          <FormItem label="配置值">
            <Textarea
              v-model:value="form.configValue"
              :auto-size="{ minRows: 4, maxRows: 12 }"
              placeholder="支持 Markdown 格式"
            />
          </FormItem>
        </template>

        <!-- 编辑时：configKey + 说明只读，左右分栏编辑预览 -->
        <template v-else>
          <div class="mb-3 flex gap-4">
            <FormItem class="flex-1" label="说明" style="margin-bottom: 0">
              <Input v-model:value="form.description" placeholder="可选" />
            </FormItem>
          </div>
          <!-- 左右分栏 -->
          <div class="flex gap-3" style="height: 420px">
            <!-- 左：编辑 -->
            <div class="flex flex-1 flex-col">
              <div class="mb-1 text-xs font-medium text-gray-500">编辑</div>
              <Textarea
                v-model:value="form.configValue"
                class="flex-1 resize-none font-mono text-sm"
                placeholder="支持 Markdown 格式"
                style="height: 100%; min-height: 0"
              />
            </div>
            <!-- 右：预览 -->
            <div class="flex flex-1 flex-col">
              <div class="mb-1 text-xs font-medium text-gray-500">预览</div>
              <div
                class="flex-1 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <!-- eslint-disable vue/no-v-html -->
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div
                  class="prose prose-sm max-w-none"
                  v-html="previewHtml"
                ></div>
                <!-- eslint-enable vue/no-v-html -->
              </div>
            </div>
          </div>
        </template>
      </Form>
    </Modal>
  </Page>
</template>
