<script lang="ts" setup>
import type { WebhookVO } from '#/api/webhook/index';

import { computed, onMounted, reactive, ref } from 'vue';

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
  Switch,
  Table,
  Tag,
  Textarea,
} from 'ant-design-vue';

import {
  createWebhookApi,
  deleteWebhookApi,
  listWebhooksApi,
  testWebhookApi,
  updateWebhookApi,
} from '#/api/webhook/index';

// ===== 列表状态 =====
const list = ref<WebhookVO[]>([]);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    list.value = await listWebhooksApi();
  } catch {
    message.error('加载列表失败');
  } finally {
    loading.value = false;
  }
}

// ===== 新增/编辑弹窗 =====
const modalOpen = ref(false);
const editingId = ref<null | number | string>(null);
const submitting = ref(false);

interface FormState {
  name: string;
  type: 'CUSTOM' | 'DINGTALK' | 'FEISHU' | 'WECOM';
  url: string;
  secret: string;
  customHeadersJson: string;
  messageTemplate: string;
  isEnabled: boolean;
}

const emptyForm = (): FormState => ({
  name: '',
  type: 'FEISHU',
  url: '',
  secret: '',
  customHeadersJson: '{}',
  messageTemplate: '',
  isEnabled: true,
});

const form = reactive<FormState>(emptyForm());

const showSecret = computed(
  () => form.type === 'FEISHU' || form.type === 'DINGTALK',
);
const showCustomHeaders = computed(() => form.type === 'CUSTOM');

function openCreate() {
  editingId.value = null;
  Object.assign(form, emptyForm());
  modalOpen.value = true;
}

function openEdit(row: WebhookVO) {
  editingId.value = row.id;
  let headersJson = '{}';
  if (row.customHeaders && Object.keys(row.customHeaders).length > 0) {
    try {
      headersJson = JSON.stringify(row.customHeaders, null, 2);
    } catch {
      headersJson = '{}';
    }
  }
  Object.assign(form, {
    name: row.name,
    type: row.type,
    url: row.url,
    secret: row.secret ?? '',
    customHeadersJson: headersJson,
    messageTemplate: row.messageTemplate ?? '',
    isEnabled: row.isEnabled === 1,
  });
  modalOpen.value = true;
}

function buildPayload(): Omit<WebhookVO, 'id'> {
  let customHeaders: Record<string, string> | undefined;
  if (form.type === 'CUSTOM' && form.customHeadersJson.trim()) {
    try {
      customHeaders = JSON.parse(form.customHeadersJson);
    } catch {
      customHeaders = {};
    }
  }
  return {
    name: form.name,
    type: form.type,
    url: form.url,
    secret: showSecret.value && form.secret ? form.secret : undefined,
    customHeaders: showCustomHeaders.value ? customHeaders : undefined,
    messageTemplate: form.messageTemplate || undefined,
    isEnabled: form.isEnabled ? 1 : 0,
  };
}

async function submit() {
  if (!form.name) {
    message.warning('请填写名称');
    return;
  }
  if (!form.url) {
    message.warning('请填写 Webhook URL');
    return;
  }
  submitting.value = true;
  try {
    const payload = buildPayload();
    if (editingId.value === null) {
      await createWebhookApi(payload);
      message.success('创建成功');
    } else {
      await updateWebhookApi(editingId.value, payload);
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
function confirmDelete(row: WebhookVO) {
  Modal.confirm({
    title: `确认删除「${row.name}」？`,
    okType: 'danger',
    async onOk() {
      try {
        await deleteWebhookApi(row.id);
        message.success('已删除');
        loadList();
      } catch (error: unknown) {
        const err = error as { response?: { data?: { msg?: string } } };
        message.error(err?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

// ===== 测试 =====
const testingId = ref<null | number | string>(null);

async function testWebhook(row: WebhookVO) {
  testingId.value = row.id;
  try {
    await testWebhookApi(row.id);
    message.success(`「${row.name}」测试消息已发送`);
  } catch (error: unknown) {
    const err = error as { response?: { data?: { msg?: string } } };
    message.error(err?.response?.data?.msg ?? '测试失败');
  } finally {
    testingId.value = null;
  }
}

// ===== 表格列定义 =====
const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', key: 'type', width: 100 },
  { title: 'URL', key: 'url', ellipsis: true },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'action', width: 220 },
];

const typeConfig: Record<string, { color: string; label: string }> = {
  FEISHU: { color: 'blue', label: '飞书' },
  DINGTALK: { color: 'orange', label: '钉钉' },
  WECOM: { color: 'green', label: '企微' },
  CUSTOM: { color: 'default', label: '自定义' },
};

onMounted(loadList);
</script>

<template>
  <Page>
    <template #extra>
      <Button type="primary" @click="openCreate">+ 新增 Webhook</Button>
    </template>

    <Table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      :pagination="false"
      row-key="id"
      bordered
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'type'">
          <Tag
            :color="typeConfig[(record as WebhookVO).type]?.color ?? 'default'"
          >
            {{
              typeConfig[(record as WebhookVO).type]?.label ??
              (record as WebhookVO).type
            }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'url'">
          <span
            :title="(record as WebhookVO).url"
            style="word-break: break-all"
          >
            {{
              (record as WebhookVO).url.length > 60
                ? `${(record as WebhookVO).url.slice(0, 60)}…`
                : (record as WebhookVO).url
            }}
          </span>
        </template>
        <template v-else-if="column.key === 'status'">
          <Tag
            :color="(record as WebhookVO).isEnabled === 1 ? 'green' : 'default'"
          >
            {{ (record as WebhookVO).isEnabled === 1 ? '启用' : '禁用' }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <Space>
            <Button size="small" @click="openEdit(record as WebhookVO)"
              >编辑</Button
            >
            <Button
              size="small"
              :loading="testingId === (record as WebhookVO).id"
              @click="testWebhook(record as WebhookVO)"
            >
              测试
            </Button>
            <Button
              size="small"
              danger
              @click="confirmDelete(record as WebhookVO)"
            >
              删除
            </Button>
          </Space>
        </template>
      </template>
    </Table>

    <!-- 新增/编辑弹窗 -->
    <Modal
      v-model:open="modalOpen"
      :title="editingId ? '编辑 Webhook' : '新增 Webhook'"
      :confirm-loading="submitting"
      width="520px"
      @ok="submit"
    >
      <Form layout="vertical" style="margin-top: 16px" :model="form">
        <FormItem
          label="名称"
          name="name"
          :rules="[{ required: true, message: '请输入 Webhook 名称' }]"
        >
          <Input v-model:value="form.name" placeholder="如：飞书告警机器人" />
        </FormItem>
        <FormItem label="类型" required>
          <Select v-model:value="form.type" style="width: 100%">
            <SelectOption value="FEISHU">飞书</SelectOption>
            <SelectOption value="DINGTALK">钉钉</SelectOption>
            <SelectOption value="WECOM">企微</SelectOption>
            <SelectOption value="CUSTOM">自定义</SelectOption>
          </Select>
        </FormItem>
        <FormItem
          label="Webhook URL"
          name="url"
          :rules="[
            { required: true, message: '请输入 URL' },
            { pattern: /^https:\/\//, message: 'URL 必须以 https:// 开头' },
          ]"
        >
          <Input
            v-model:value="form.url"
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
          />
        </FormItem>
        <FormItem v-if="showSecret" label="签名密钥">
          <Input
            v-model:value="form.secret"
            placeholder="可选，用于消息签名验证"
          />
        </FormItem>
        <FormItem v-if="showCustomHeaders" label="请求头JSON">
          <Textarea
            v-model:value="form.customHeadersJson"
            :rows="4"
            placeholder="{&quot;Authorization&quot;: &quot;Bearer token&quot;, &quot;X-Custom&quot;: &quot;value&quot;}"
          />
        </FormItem>
        <FormItem label="消息模板">
          <Textarea
            v-model:value="form.messageTemplate"
            :rows="3"
            placeholder="留空使用默认模板"
          />
        </FormItem>
        <FormItem label="是否启用">
          <Switch
            v-model:checked="form.isEnabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
