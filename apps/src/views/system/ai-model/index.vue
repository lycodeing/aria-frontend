<script lang="ts" setup>
import type { AiModelConfigItem, AiModelTestResult } from '#/api/ai-model';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
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
  Spin,
  Switch,
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
  testAiModelApi,
  toggleAiModelEnabledApi,
  updateAiModelApi,
} from '#/api/ai-model';

// ===== TAB 切换（CHAT / EMBEDDING / ROUTER） =====
const activeTab = ref<'CHAT' | 'EMBEDDING' | 'ROUTER'>('CHAT');

function onTabChange(key: number | string) {
  activeTab.value = key as 'CHAT' | 'EMBEDDING' | 'ROUTER';
  loadList();
}

/** 当前 TAB 是向量模型 */
const isEmbeddingTab = computed(() => activeTab.value === 'EMBEDDING');
/** 当前 TAB 是路由小模型 */
const isRouterTab = computed(() => activeTab.value === 'ROUTER');

// ===== 列表状态 =====
const list = ref<AiModelConfigItem[]>([]);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const res = await listAiModelsApi(0, 50, activeTab.value);
    list.value = res?.items ?? [];
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
      isEnabled: true,
      remark: '',
    };
  }
  if (isRouterTab.value) {
    return {
      name: '',
      provider: 'CUSTOM',
      apiProtocol: 'OPENAI_COMPATIBLE',
      modelType: 'ROUTER',
      baseUrl: 'http://localhost:11434/v1',
      apiKeyEnc: '',
      modelName: 'qwen2.5:0.5b',
      temperature: 0,
      maxTokens: 32,
      timeoutSec: 5,
      isEnabled: true,
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
    isEnabled: true,
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

// ===== 启用/禁用 =====
async function toggleEnable(row: AiModelConfigItem) {
  const newStatus = !row.isEnabled;
  try {
    await toggleAiModelEnabledApi(row.id, newStatus);
    message.success(`「${row.name}」已${newStatus ? '启用' : '禁用'}`);
    loadList();
  } catch {
    message.error('操作失败');
  }
}

onMounted(loadList);

// ===== 测试连接 =====
const testingId = ref<null | number>(null);
const testResult = ref<AiModelTestResult | null>(null);
const testVisible = ref(false);
const testName = ref('');

async function testConnection(row: AiModelConfigItem) {
  testingId.value = row.id;
  testResult.value = null;
  testVisible.value = true;
  testName.value = row.name;
  try {
    const res = await testAiModelApi(row.id);
    testResult.value = res as unknown as AiModelTestResult;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { msg?: string } } };
    testResult.value = {
      success: false,
      latencyMs: 0,
      message: err?.response?.data?.msg ?? '请求失败，请检查网络或服务状态',
    };
  } finally {
    testingId.value = null;
  }
}

// ===== 表格列定义（三个 TAB 列结构略有不同） =====
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

/** 路由小模型：只需关注 Base URL、模型名和超时，温度/MaxTokens 无意义 */
const routerColumns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '供应商', dataIndex: 'provider', key: 'provider', width: 120 },
  { title: 'Base URL', dataIndex: 'baseUrl', key: 'baseUrl' },
  { title: '模型', dataIndex: 'modelName', key: 'modelName', width: 160 },
  { title: '超时(s)', dataIndex: 'timeoutSec', key: 'timeoutSec', width: 80 },
  { title: '状态', key: 'status', width: 80 },
  { title: '默认', key: 'isDefault', width: 70, align: 'center' as const },
  { title: '操作', key: 'action', width: 240 },
];

const columns = computed(() => {
  if (isEmbeddingTab.value) return embeddingColumns;
  if (isRouterTab.value) return routerColumns;
  return chatColumns;
});
</script>

<template>
  <Page
    title="AI 模型配置"
    description="统一管理对话大模型和向量模型，支持后台热切换无需重启服务"
  >
    <template #extra>
      <Button type="primary" @click="openCreate">+ 新增配置</Button>
    </template>

    <!-- TAB 切换：对话模型 / 向量模型 / 路由模型 -->
    <Tabs
      :active-key="activeTab"
      @change="onTabChange"
      style="margin-bottom: 0"
    >
      <TabPane key="CHAT" tab="对话模型" />
      <TabPane key="EMBEDDING" tab="向量模型（Embedding）" />
      <TabPane key="ROUTER" tab="路由模型" />
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
          <span v-if="record.isDefault" style="font-size: 16px; color: #4f46e5"
            >✓</span
          >
        </template>
        <template v-else-if="column.key === 'action'">
          <Space>
            <Button
              size="small"
              :type="
                (record as AiModelConfigItem).isEnabled ? 'default' : 'primary'
              "
              @click="toggleEnable(record as AiModelConfigItem)"
            >
              {{ (record as AiModelConfigItem).isEnabled ? '禁用' : '启用' }}
            </Button>
            <Button
              size="small"
              :disabled="(record as AiModelConfigItem).isDefault"
              @click="setDefault(record as AiModelConfigItem)"
            >
              设为默认
            </Button>
            <Button size="small" @click="openEdit(record as AiModelConfigItem)">
              编辑
            </Button>
            <Button
              size="small"
              :loading="testingId === (record as AiModelConfigItem).id"
              @click="testConnection(record as AiModelConfigItem)"
            >
              测试连接
            </Button>
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
      :title="
        editingId
          ? '编辑配置'
          : isEmbeddingTab
            ? '新增向量模型配置'
            : isRouterTab
              ? '新增路由模型配置'
              : '新增对话模型配置'
      "
      :confirm-loading="submitting"
      width="560px"
      @ok="submit"
    >
      <Form layout="vertical" style="margin-top: 16px">
        <FormItem label="配置名称" required>
          <Input
            v-model:value="form.name"
            :placeholder="
              isEmbeddingTab
                ? '如：本地 BGE-M3'
                : isRouterTab
                  ? '如：Qwen2.5-0.5B (域路由)'
                  : '如：天翼云 DeepSeek-V4-Flash'
            "
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
            :placeholder="
              isEmbeddingTab
                ? 'http://localhost:8000'
                : isRouterTab
                  ? 'http://localhost:11434/v1'
                  : 'https://api.openai.com/v1'
            "
          />
        </FormItem>
        <FormItem
          label="API Key"
          :help="
            editingId
              ? '留空则不修改现有 Key'
              : isEmbeddingTab || isRouterTab
                ? '本地部署无需 Key 可留空'
                : ''
          "
        >
          <InputPassword
            v-model:value="form.apiKeyEnc"
            :placeholder="
              isEmbeddingTab || isRouterTab
                ? '本地部署可留空'
                : '输入 API Key（自动加密存储）'
            "
          />
        </FormItem>
        <FormItem label="模型名称" required>
          <Input
            v-model:value="form.modelName"
            :placeholder="
              isEmbeddingTab
                ? '如 bge-m3 / nomic-embed-text / mxbai-embed-large'
                : isRouterTab
                  ? '如 qwen2.5:0.5b / phi3-mini / gemma2:2b'
                  : '如 DeepSeek-V4-Flash / gpt-4o'
            "
          />
        </FormItem>

        <!-- 对话模型专属：温度 / Max Tokens / 超时 -->
        <template v-if="!isEmbeddingTab && !isRouterTab">
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
        <template v-else-if="isEmbeddingTab || isRouterTab">
          <FormItem
            label="超时（秒）"
            help="向量化 HTTP 请求超时，大批量时可适当调大"
          >
            <InputNumber
              v-model:value="form.timeoutSec"
              :min="5"
              :max="300"
              style="width: 160px"
            />
          </FormItem>
        </template>

        <!-- 路由模型：Max Tokens（输出极短）和超时（要求快速响应）-->
        <template v-else>
          <div style="display: flex; gap: 12px">
            <FormItem
              label="Max Tokens"
              style="flex: 1"
              help="路由模型只输出域 code，设 32 即可"
            >
              <InputNumber
                v-model:value="form.maxTokens"
                :min="1"
                :max="256"
                style="width: 100%"
              />
            </FormItem>
            <FormItem
              label="超时（秒）"
              style="flex: 1"
              help="路由判断需快速响应，建议 ≤ 10s"
            >
              <InputNumber
                v-model:value="form.timeoutSec"
                :min="1"
                :max="30"
                style="width: 100%"
              />
            </FormItem>
          </div>
        </template>

        <FormItem label="启用状态">
          <Switch
            v-model:checked="form.isEnabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <span class="ml-2 text-xs opacity-50"
            >禁用后该模型不参与对话和路由</span
          >
        </FormItem>

        <FormItem label="备注">
          <Textarea
            v-model:value="form.remark"
            :rows="2"
            placeholder="可选备注"
          />
        </FormItem>
      </Form>
    </Modal>

    <!-- 测试连接结果 Modal -->
    <Modal
      v-model:open="testVisible"
      :title="`测试连接 — ${testName}`"
      :footer="null"
      width="440px"
    >
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 80px;
          padding: 16px 0;
        "
      >
        <Spin v-if="testingId !== null" tip="连接测试中，请稍候…" />
        <div v-else-if="testResult" style="width: 100%">
          <Alert
            :type="testResult.success ? 'success' : 'error'"
            :message="testResult.success ? '连接成功' : '连接失败'"
            :description="testResult.message"
            show-icon
          />
          <p
            style="
              margin-top: 10px;
              font-size: 12px;
              color: #888;
              text-align: right;
            "
          >
            延迟：{{ testResult.latencyMs }} ms
          </p>
        </div>
      </div>
    </Modal>
  </Page>
</template>
