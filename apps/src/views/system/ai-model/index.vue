<script lang="ts" setup>
import type { AiModelConfigItem } from '#/api/ai-model';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Form,
  FormItem,
  Input,
  InputNumber,
  InputPassword,
  message,
  Modal,
  Select,
  SelectOption,
  Space,
  Table,
  TabPane,
  Tabs,
  Tag,
  Textarea,
} from 'ant-design-vue';

import {
  createAiModelApi,
  deleteAiModelApi,
  listAiModelsApi,
  PROTOCOLS,
  PROVIDER_PROTOCOL_MAP,
  PROVIDERS,
  setDefaultAiModelApi,
  updateAiModelApi,
} from '#/api/ai-model';

// ===== TAB 切换（CHAT / EMBEDDING） =====
const activeTab = ref<'CHAT' | 'EMBEDDING'>('CHAT');

function onTabChange(key: string | number) {
  activeTab.value = key as 'CHAT' | 'EMBEDDING';
  loadList();
}

/** 当前 TAB 是向量模型 */
const isEmbeddingTab = computed(() => activeTab.value === 'EMBEDDING');

// ===== 列表状态 =====
const list = ref<AiModelConfigItem[]>([]);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const res = await listAiModelsApi(1, 50, activeTab.value);
    list.value = (res as any)?.records ?? [];
  } catch {
    message.error('加载列表失败');
  } finally {
    loading.value = false;
  }
}

// ===== 新增/编辑弹窗 =====
const modalOpen = ref(false);
const editingId = ref<null | number>(null);
const submitting = ref(false);

/** 根据当前 TAB 返回合适的表单默认值 */
const emptyForm = (): Partial<AiModelConfigItem> => {
  if (isEmbeddingTab.value) {
    return {
      name: '',
      provider: 'CUSTOM',
      apiProtocol: 'OPENAI_COMPATIBLE',
      modelType: 'EMBEDDING',
      baseUrl: 'http://localhost:8000',
      apiKeyEnc: '',
      modelName: 'bge-m3',
      temperature: 0,
      maxTokens: 0,
      timeoutSec: 30,
      remark: '',
    };
  }
  return {
    name: '',
    provider: 'CTYUN',
    apiProtocol: 'OPENAI_COMPATIBLE',
    modelType: 'CHAT',
    baseUrl: 'https://wishub-x6.ctyun.cn/v1',
    apiKeyEnc: '',
    modelName: 'DeepSeek-V4-Flash',
    temperature: 0.7,
    maxTokens: 2048,
    timeoutSec: 60,
    remark: '',
  };
};

const form = reactive<Partial<AiModelConfigItem>>(emptyForm());

function openCreate() {
  editingId.value = null;
  Object.assign(form, emptyForm());
  modalOpen.value = true;
}

function openEdit(row: AiModelConfigItem) {
  editingId.value = row.id;
  Object.assign(form, { ...row, apiKeyEnc: '' });
  modalOpen.value = true;
}

function onProviderChange(v: unknown) {
  const value = v as string;
  form.apiProtocol = PROVIDER_PROTOCOL_MAP[value] ?? 'OPENAI_COMPATIBLE';
  form.baseUrl = PROVIDERS.find((p) => p.value === value)?.defaultBaseUrl ?? '';
}

async function submit() {
  if (!form.name || !form.baseUrl || !form.modelName) {
    message.warning('请填写必填项：名称、Base URL、模型名称');
    return;
  }
  submitting.value = true;
  try {
    const payload = { ...form };
    // 新增时自动为非空 apiKey 加 PLAINTEXT: 前缀（编辑时留空则后端保留原值）
    if (
      !editingId.value &&
      payload.apiKeyEnc &&
      !payload.apiKeyEnc.startsWith('PLAINTEXT:') &&
      !payload.apiKeyEnc.startsWith('AES:')
    ) {
      payload.apiKeyEnc = `PLAINTEXT:${payload.apiKeyEnc}`;
    }
    if (editingId.value) {
      await updateAiModelApi(editingId.value, payload);
      message.success('更新成功');
    } else {
      await createAiModelApi(payload);
      message.success('创建成功');
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

// ===== 设为默认 =====
async function setDefault(row: AiModelConfigItem) {
  try {
    await setDefaultAiModelApi(row.id);
    message.success(`已将「${row.name}」设为默认模型`);
    loadList();
  } catch {
    message.error('操作失败');
  }
}

// ===== 删除 =====
function confirmDelete(row: AiModelConfigItem) {
  Modal.confirm({
    title: `确认删除「${row.name}」？`,
    content: '软删除操作，默认配置无法删除。',
    okType: 'danger',
    async onOk() {
      try {
        await deleteAiModelApi(row.id);
        message.success('已删除');
        loadList();
      } catch (error: unknown) {
        const err = error as { response?: { data?: { msg?: string } } };
        message.error(err?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

onMounted(loadList);

// ===== 表格列定义（两个 TAB 列结构略有不同） =====
const chatColumns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '供应商', dataIndex: 'provider', key: 'provider', width: 100 },
  { title: '协议', dataIndex: 'apiProtocol', key: 'apiProtocol', width: 210 },
  { title: '模型', dataIndex: 'modelName', key: 'modelName' },
  { title: '状态', key: 'status', width: 80 },
  { title: '默认', key: 'isDefault', width: 70, align: 'center' as const },
  { title: '操作', key: 'action', width: 240 },
];

const embeddingColumns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '供应商', dataIndex: 'provider', key: 'provider', width: 120 },
  { title: 'Base URL', dataIndex: 'baseUrl', key: 'baseUrl' },
  { title: '模型', dataIndex: 'modelName', key: 'modelName', width: 160 },
  { title: '超时(s)', dataIndex: 'timeoutSec', key: 'timeoutSec', width: 80 },
  { title: '状态', key: 'status', width: 80 },
  { title: '默认', key: 'isDefault', width: 70, align: 'center' as const },
  { title: '操作', key: 'action', width: 240 },
];

const columns = computed(() =>
  isEmbeddingTab.value ? embeddingColumns : chatColumns,
);
</script>

<template>
  <Page
    title="AI 模型配置"
    description="统一管理对话大模型和向量模型，支持后台热切换无需重启服务"
  >
    <template #extra>
      <Button type="primary" @click="openCreate">+ 新增配置</Button>
    </template>

    <!-- TAB 切换：对话模型 / 向量模型 -->
    <Tabs :active-key="activeTab" @change="onTabChange" style="margin-bottom: 0">
      <TabPane key="CHAT" tab="对话模型" />
      <TabPane key="EMBEDDING" tab="向量模型（Embedding）" />
    </Tabs>

    <Table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      :pagination="false"
      row-key="id"
      bordered
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <Tag :color="record.isEnabled ? 'green' : 'default'">
            {{ record.isEnabled ? '启用' : '禁用' }}
          </Tag>
        </template>
        <template v-else-if="column.key === 'isDefault'">
          <span v-if="record.isDefault" style="font-size: 16px; color: #4f46e5">✓</span>
        </template>
        <template v-else-if="column.key === 'action'">
          <Space>
            <Button
              size="small"
              :disabled="(record as AiModelConfigItem).isDefault"
              @click="setDefault(record as AiModelConfigItem)"
            >
              设为默认
            </Button>
            <Button size="small" @click="openEdit(record as AiModelConfigItem)">编辑</Button>
            <Button
              size="small"
              danger
              :disabled="(record as AiModelConfigItem).isDefault"
              @click="confirmDelete(record as AiModelConfigItem)"
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
      :title="editingId
        ? '编辑配置'
        : isEmbeddingTab ? '新增向量模型配置' : '新增对话模型配置'"
      :confirm-loading="submitting"
      width="560px"
      @ok="submit"
    >
      <Form layout="vertical" style="margin-top: 16px">
        <FormItem label="配置名称" required>
          <Input
            v-model:value="form.name"
            :placeholder="isEmbeddingTab ? '如：本地 BGE-M3' : '如：天翼云 DeepSeek-V4-Flash'"
          />
        </FormItem>
        <div style="display: flex; gap: 12px">
          <FormItem label="供应商" required style="flex: 1">
            <Select v-model:value="form.provider" @change="onProviderChange">
              <SelectOption
                v-for="p in PROVIDERS"
                :key="p.value"
                :value="p.value"
              >
                {{ p.label }}
              </SelectOption>
            </Select>
          </FormItem>
          <FormItem label="API 协议" required style="flex: 1">
            <Select v-model:value="form.apiProtocol">
              <SelectOption
                v-for="p in PROTOCOLS"
                :key="p.value"
                :value="p.value"
              >
                {{ p.label }}
              </SelectOption>
            </Select>
          </FormItem>
        </div>
        <FormItem label="API Base URL" required>
          <Input
            v-model:value="form.baseUrl"
            :placeholder="isEmbeddingTab ? 'http://localhost:8000' : 'https://api.openai.com/v1'"
          />
        </FormItem>
        <FormItem
          label="API Key"
          :help="editingId
            ? '留空则不修改现有 Key'
            : isEmbeddingTab ? '本地部署无需 Key 可留空' : ''"
        >
          <InputPassword
            v-model:value="form.apiKeyEnc"
            :placeholder="isEmbeddingTab ? '本地部署可留空' : '输入 API Key（自动加密存储）'"
          />
        </FormItem>
        <FormItem label="模型名称" required>
          <Input
            v-model:value="form.modelName"
            :placeholder="isEmbeddingTab
              ? '如 bge-m3 / nomic-embed-text / mxbai-embed-large'
              : '如 DeepSeek-V4-Flash / gpt-4o'"
          />
        </FormItem>

        <!-- 对话模型专属：温度 / Max Tokens / 超时 -->
        <template v-if="!isEmbeddingTab">
          <div style="display: flex; gap: 12px">
            <FormItem label="温度（0-2）" style="flex: 1">
              <InputNumber
                v-model:value="form.temperature"
                :min="0"
                :max="2"
                :step="0.1"
                style="width: 100%"
              />
            </FormItem>
            <FormItem label="Max Tokens" style="flex: 1">
              <InputNumber
                v-model:value="form.maxTokens"
                :min="1"
                :max="32000"
                style="width: 100%"
              />
            </FormItem>
            <FormItem label="超时（秒）" style="flex: 1">
              <InputNumber
                v-model:value="form.timeoutSec"
                :min="5"
                :max="300"
                style="width: 100%"
              />
            </FormItem>
          </div>
        </template>

        <!-- 向量模型：只需配置超时，温度/MaxTokens 对 Embedding 无意义 -->
        <template v-else>
          <FormItem label="超时（秒）" help="向量化 HTTP 请求超时，大批量时可适当调大">
            <InputNumber
              v-model:value="form.timeoutSec"
              :min="5"
              :max="300"
              style="width: 160px"
            />
          </FormItem>
        </template>

        <FormItem label="备注">
          <Textarea v-model:value="form.remark" :rows="2" placeholder="可选备注" />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
