<script lang="ts" setup>
import type { TagVO } from '#/api/tag/index';

import { onMounted, reactive, ref } from 'vue';

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
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  createTagApi,
  deleteTagApi,
  listTagsApi,
  updateTagApi,
} from '#/api/tag/index';

// ===== 来源筛选 =====
const filterSource = ref<string | undefined>(undefined);

// ===== 列表状态 =====
const list = ref<TagVO[]>([]);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const params = filterSource.value
      ? { source: filterSource.value }
      : undefined;
    list.value = await listTagsApi(params);
  } catch {
    message.error('加载列表失败');
  } finally {
    loading.value = false;
  }
}

function onSourceChange() {
  loadList();
}

// ===== 新增/编辑弹窗 =====
const modalOpen = ref(false);
const editingId = ref<null | number | string>(null);
const submitting = ref(false);

interface FormState {
  name: string;
  color: string;
  source: string;
}

const emptyForm = (): FormState => ({
  name: '',
  color: '#F59E0B',
  source: 'CUSTOM',
});

const form = reactive<FormState>(emptyForm());

function openCreate() {
  editingId.value = null;
  Object.assign(form, emptyForm());
  modalOpen.value = true;
}

function openEdit(row: TagVO) {
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    color: row.color,
    source: row.source,
  });
  modalOpen.value = true;
}

async function submit() {
  if (!form.name) {
    message.warning('请填写标签名');
    return;
  }
  if (!form.color) {
    message.warning('请填写颜色');
    return;
  }
  submitting.value = true;
  try {
    if (editingId.value === null) {
      await createTagApi({ name: form.name, color: form.color });
      message.success('创建成功');
    } else {
      await updateTagApi(editingId.value, {
        name: form.name,
        color: form.color,
        source: form.source,
      });
      message.success('更新成功');
    }
    modalOpen.value = false;
    loadList();
  } catch (error: unknown) {
    const err = error as { response?: { data?: { msg?: string } } };
    message.error(err?.response?.data?.msg ?? '操作失败');
  } finally {
    submitting.value = false;
  }
}

// ===== 删除 =====
function confirmDelete(row: TagVO) {
  Modal.confirm({
    title: `确认删除标签「${row.name}」？`,
    content: '删除后无法恢复，已使用该标签的会话数据不受影响。',
    okType: 'danger',
    async onOk() {
      try {
        await deleteTagApi(row.id);
        message.success('已删除');
        loadList();
      } catch (error: unknown) {
        const err = error as { response?: { data?: { msg?: string } } };
        message.error(err?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

// ===== 表格列定义 =====
const columns = [
  { title: '标签', key: 'name' },
  { title: '颜色', dataIndex: 'color', key: 'color', width: 110 },
  { title: '来源', key: 'source', width: 110 },
  {
    title: '使用次数',
    dataIndex: 'usageCount',
    key: 'usageCount',
    width: 100,
    align: 'right' as const,
  },
  { title: '操作', key: 'action', width: 150 },
];

onMounted(loadList);
</script>

<template>
  <Page title="标签字典" description="管理系统预定义标签与自定义标签">
    <template #extra>
      <Button type="primary" @click="openCreate">+ 新增标签</Button>
    </template>

    <!-- 来源筛选 -->
    <Space style="margin-bottom: 16px">
      <Select
        v-model:value="filterSource"
        placeholder="全部来源"
        allow-clear
        style="width: 140px"
        @change="onSourceChange"
      >
        <SelectOption value="PRESET">预定义</SelectOption>
        <SelectOption value="CUSTOM">自定义</SelectOption>
      </Select>
    </Space>

    <Table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      :pagination="false"
      row-key="id"
      bordered
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <span
            :style="{
              background: (record as TagVO).color,
              display: 'inline-block',
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              marginRight: '6px',
              verticalAlign: 'middle',
            }"
          ></span>
          <span>{{ (record as TagVO).name }}</span>
        </template>
        <template v-else-if="column.key === 'source'">
          <Tag
            :color="(record as TagVO).source === 'PRESET' ? 'blue' : 'default'"
          >
            {{ (record as TagVO).source === 'PRESET' ? '预定义' : '自定义' }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <Space>
            <Button size="small" @click="openEdit(record as TagVO)"
              >编辑</Button
            >
            <Button size="small" danger @click="confirmDelete(record as TagVO)">
              删除
            </Button>
          </Space>
        </template>
      </template>
    </Table>

    <!-- 新增/编辑弹窗 -->
    <Modal
      v-model:open="modalOpen"
      :title="editingId ? '编辑标签' : '新增标签'"
      :confirm-loading="submitting"
      width="440px"
      @ok="submit"
    >
      <Form layout="vertical" style="margin-top: 16px">
        <FormItem label="标签名" required>
          <Input
            v-model:value="form.name"
            :maxlength="50"
            show-count
            placeholder="如：VIP客户"
          />
        </FormItem>
        <FormItem label="颜色" required>
          <Space>
            <input
              v-model="form.color"
              type="color"
              style="
                width: 36px;
                height: 32px;
                padding: 2px;
                cursor: pointer;
                border: 1px solid #d9d9d9;
                border-radius: 6px;
              "
            />
            <Input
              v-model:value="form.color"
              placeholder="#F59E0B"
              style="width: 120px"
            />
            <span
              :style="{
                display: 'inline-block',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: form.color,
                border: '1px solid #d9d9d9',
              }"
            ></span>
          </Space>
        </FormItem>
        <FormItem v-if="editingId" label="来源">
          <Select v-model:value="form.source" style="width: 160px">
            <SelectOption value="PRESET">预定义</SelectOption>
            <SelectOption value="CUSTOM">自定义</SelectOption>
          </Select>
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
