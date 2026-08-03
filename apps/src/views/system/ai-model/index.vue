<script lang="ts" setup>
import type { AiModelConfigItem, AiModelTestResult } from '#/api/ai-model';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  InputPassword,
  message,
  Modal,
  Select,
  SelectOption,
  Spin,
  Switch,
  TabPane,
  Tabs,
  Textarea,
  Tooltip,
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

// ===== TAB 配置 =====
interface TabConfig {
  badge: string;
  desc: string;
  key: string;
  label: string;
}

const TAB_LIST: TabConfig[] = [
  { key: 'CHAT', label: '对话模型', desc: '大语言模型对话生成', badge: 'LLM' },
  {
    key: 'EMBEDDING',
    label: '向量模型',
    desc: '文本向量化编码',
    badge: 'EMB',
  },
  {
    key: 'ROUTER',
    label: '路由模型',
    desc: '领域路由分类',
    badge: 'RT',
  },
  {
    key: 'RERANKER',
    label: '精排模型',
    desc: '检索结果重排序',
    badge: 'RR',
  },
  {
    key: 'INTENT',
    label: '意图分类',
    desc: 'BERT 意图识别',
    badge: 'INT',
  },
];

const activeTab = ref<string>('CHAT');

function onTabChange(key: number | string) {
  activeTab.value = key as string;
  loadList();
}

const isEmbeddingTab = computed(() => activeTab.value === 'EMBEDDING');
const isRouterTab = computed(() => activeTab.value === 'ROUTER');
const isRerankerTab = computed(() => activeTab.value === 'RERANKER');
const isIntentTab = computed(() => activeTab.value === 'INTENT');
const isToolServiceTab = computed(
  () =>
    isEmbeddingTab.value ||
    isRouterTab.value ||
    isRerankerTab.value ||
    isIntentTab.value,
);

const DEFAULT_TAB: TabConfig = {
  badge: 'LLM',
  desc: '大语言模型对话生成',
  key: 'CHAT',
  label: '对话模型',
};
const currentTabMeta = computed(
  () => TAB_LIST.find((t) => t.key === activeTab.value) ?? DEFAULT_TAB,
);

// ===== 列表状态 =====
const list = ref<AiModelConfigItem[]>([]);
const loading = ref(false);
const searchKeyword = ref('');

async function loadList() {
  loading.value = true;
  try {
    const res = await listAiModelsApi(
      0,
      50,
      activeTab.value as
        | 'CHAT'
        | 'EMBEDDING'
        | 'INTENT'
        | 'RERANKER'
        | 'ROUTER',
    );
    list.value = res?.items ?? [];
  } catch {
    message.error('加载列表失败');
  } finally {
    loading.value = false;
  }
}

// 前端搜索过滤
const filteredList = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  if (!kw) return list.value;
  return list.value.filter(
    (m) =>
      (m.name ?? '').toLowerCase().includes(kw) ||
      (m.modelName ?? '').toLowerCase().includes(kw) ||
      (m.provider ?? '').toLowerCase().includes(kw),
  );
});

// ===== 统计 =====
const stats = computed(() => ({
  total: list.value.length,
  enabled: list.value.filter((m) => m.isEnabled).length,
  disabled: list.value.filter((m) => !m.isEnabled).length,
  default: list.value.filter((m) => m.isDefault).length,
}));

// ===== 供应商标签颜色 =====
const PROVIDER_COLOR: Record<string, string> = {
  CTYUN: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  OPENAI:
    'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  CUSTOM: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
};
function providerClass(p?: string): string {
  return PROVIDER_COLOR[p ?? ''] ?? PROVIDER_COLOR.CUSTOM ?? '';
}

// ===== Drawer =====
const drawerOpen = ref(false);
const editingId = ref<null | number>(null);
const submitting = ref(false);

const emptyForm = (): Partial<AiModelConfigItem> => {
  if (isEmbeddingTab.value)
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
  if (isRouterTab.value)
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
  if (isRerankerTab.value)
    return {
      name: '',
      provider: 'CUSTOM',
      apiProtocol: 'OPENAI_COMPATIBLE',
      modelType: 'RERANKER',
      baseUrl: 'http://localhost:8001',
      apiKeyEnc: '',
      modelName: 'bge-reranker-v2-m3',
      temperature: 0,
      maxTokens: 0,
      timeoutSec: 10,
      isEnabled: true,
      remark: '',
    };
  if (isIntentTab.value)
    return {
      name: '',
      provider: 'CUSTOM',
      apiProtocol: 'OPENAI_COMPATIBLE',
      modelType: 'INTENT',
      baseUrl: 'http://localhost:8090',
      apiKeyEnc: '',
      modelName: 'bert-intent',
      temperature: 0,
      maxTokens: 0,
      timeoutSec: 1,
      isEnabled: true,
      remark: '',
    };
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

const drawerTitle = computed(() => {
  if (editingId.value) return '编辑配置';
  return `新增${currentTabMeta.value.label}配置`;
});

function openCreate() {
  editingId.value = null;
  Object.assign(form, emptyForm());
  drawerOpen.value = true;
}

function openEdit(row: AiModelConfigItem) {
  editingId.value = row.id;
  Object.assign(form, { ...row, apiKeyEnc: '' });
  drawerOpen.value = true;
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
    drawerOpen.value = false;
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
const testModalVisible = ref(false);
const testName = ref('');

async function testConnection(row: AiModelConfigItem) {
  testingId.value = row.id;
  testResult.value = null;
  testModalVisible.value = true;
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
</script>

<template>
  <Page>
    <!-- 顶部统计卡片行 -->
    <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      <div
        class="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-sm font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        >
          {{ currentTabMeta.badge }}
        </div>
        <div>
          <div class="text-xs text-muted-foreground">
            {{ currentTabMeta.label }}
          </div>
          <div class="text-xl font-bold leading-tight tabular-nums">
            {{ stats.total }}
          </div>
        </div>
      </div>
      <div
        class="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/30"
        >
          <Icon icon="lucide:check-circle" class="text-lg text-emerald-500" />
        </div>
        <div>
          <div class="text-xs text-muted-foreground">启用中</div>
          <div
            class="text-xl font-bold leading-tight text-emerald-600 tabular-nums dark:text-emerald-400"
          >
            {{ stats.enabled }}
          </div>
        </div>
      </div>
      <div
        class="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/30"
        >
          <Icon icon="lucide:pause-circle" class="text-lg text-red-400" />
        </div>
        <div>
          <div class="text-xs text-muted-foreground">已禁用</div>
          <div
            class="text-xl font-bold leading-tight text-red-500 tabular-nums dark:text-red-400"
          >
            {{ stats.disabled }}
          </div>
        </div>
      </div>
      <div
        class="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-900/30"
        >
          <Icon icon="lucide:star" class="text-lg text-violet-500" />
        </div>
        <div>
          <div class="text-xs text-muted-foreground">默认模型</div>
          <div
            class="text-xl font-bold leading-tight text-violet-600 tabular-nums dark:text-violet-400"
          >
            {{ stats.default }}
          </div>
        </div>
      </div>
    </div>

    <!-- Tab + 搜索 + 新增 -->
    <div
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"
    >
      <Tabs
        :active-key="activeTab"
        size="small"
        style="margin-bottom: -8px"
        @change="onTabChange"
      >
        <TabPane v-for="t in TAB_LIST" :key="t.key" :tab="t.label" />
      </Tabs>
      <div class="flex items-center gap-2">
        <Input
          v-model:value="searchKeyword"
          allow-clear
          placeholder="搜索名称 / 模型 / 供应商"
          style="width: 200px"
        >
          <template #prefix>
            <Icon icon="lucide:search" class="text-muted-foreground" />
          </template>
        </Input>
        <Button type="primary" @click="openCreate">
          <template #icon><Icon icon="lucide:plus" /></template>
          新增配置
        </Button>
      </div>
    </div>

    <!-- 模型卡片网格 -->
    <Spin :spinning="loading">
      <Empty
        v-if="filteredList.length === 0"
        description="暂无模型配置"
        style="padding: 60px 0"
      />
      <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="item in filteredList"
          :key="item.id"
          class="group relative flex flex-col rounded-xl border bg-card p-4 shadow-sm transition hover:shadow-md"
          :class="{
            'border-violet-300 ring-1 ring-violet-200 dark:border-violet-700 dark:ring-violet-800':
              item.isDefault,
            'opacity-60': !item.isEnabled,
          }"
        >
          <!-- 默认标记 -->
          <div
            v-if="item.isDefault"
            class="absolute -right-px -top-px rounded-bl-lg rounded-tr-xl bg-violet-500 px-2 py-0.5 text-[10px] font-medium text-white"
          >
            默认
          </div>

          <!-- 头部：名称 + 开关 -->
          <div class="mb-3 flex items-start justify-between">
            <div class="min-w-0 flex-1 pr-2">
              <div class="flex items-center gap-2">
                <Icon
                  :icon="
                    item.isEnabled
                      ? 'lucide:circle-check'
                      : 'lucide:circle-minus'
                  "
                  :class="
                    item.isEnabled
                      ? 'text-emerald-500'
                      : 'text-muted-foreground'
                  "
                  style="font-size: 14px"
                />
                <span class="truncate font-semibold">{{ item.name }}</span>
              </div>
              <div
                class="mt-0.5 truncate font-mono text-xs text-muted-foreground"
              >
                {{ item.modelName }}
              </div>
            </div>
            <Switch
              :checked="item.isEnabled"
              size="small"
              @change="toggleEnable(item)"
            />
          </div>

          <!-- 标签行 -->
          <div class="mb-3 flex flex-wrap items-center gap-1.5">
            <span
              class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
              :class="providerClass(item.provider)"
            >
              {{ item.provider }}
            </span>
            <span
              v-if="item.apiProtocol"
              class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            >
              {{ item.apiProtocol }}
            </span>
            <span
              v-if="item.timeoutSec"
              class="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            >
              <Icon icon="lucide:clock" style="font-size: 10px" />
              {{ item.timeoutSec }}s
            </span>
          </div>

          <!-- 信息行 -->
          <div class="mb-3 space-y-1 border-t pt-2 text-xs">
            <div class="flex items-center gap-1.5 text-muted-foreground">
              <Icon
                icon="lucide:link"
                style="font-size: 12px"
                class="shrink-0"
              />
              <span class="truncate font-mono">{{ item.baseUrl }}</span>
            </div>
            <div
              v-if="!isToolServiceTab && item.temperature !== undefined"
              class="flex items-center gap-1.5 text-muted-foreground"
            >
              <Icon
                icon="lucide:thermometer"
                style="font-size: 12px"
                class="shrink-0"
              />
              <span>温度 {{ item.temperature }}</span>
              <span class="mx-1 text-border">|</span>
              <Icon
                icon="lucide:hash"
                style="font-size: 12px"
                class="shrink-0"
              />
              <span>{{ item.maxTokens }} tokens</span>
            </div>
          </div>

          <!-- 底部操作 -->
          <div class="mt-auto flex items-center justify-between border-t pt-2">
            <span
              v-if="item.remark"
              class="truncate text-xs text-muted-foreground"
            >
              {{ item.remark }}
            </span>
            <span v-else></span>
            <div class="flex items-center gap-1">
              <Tooltip title="测试连接">
                <Button
                  type="text"
                  size="small"
                  class="text-amber-500 hover:text-amber-600"
                  @click="testConnection(item)"
                >
                  <template #icon>
                    <Icon
                      :icon="
                        testingId === item.id
                          ? 'lucide:loader-circle'
                          : 'lucide:plug-zap'
                      "
                      :class="testingId === item.id ? 'animate-spin' : ''"
                    />
                  </template>
                </Button>
              </Tooltip>
              <Tooltip title="设为默认">
                <Button
                  type="text"
                  size="small"
                  :disabled="item.isDefault"
                  class="text-violet-500 hover:text-violet-600"
                  @click="setDefault(item)"
                >
                  <template #icon><Icon icon="lucide:star" /></template>
                </Button>
              </Tooltip>
              <Tooltip title="编辑">
                <Button
                  type="text"
                  size="small"
                  class="text-slate-500 hover:text-slate-700"
                  @click="openEdit(item)"
                >
                  <template #icon><Icon icon="lucide:pencil" /></template>
                </Button>
              </Tooltip>
              <Tooltip title="删除">
                <Button
                  type="text"
                  size="small"
                  :disabled="item.isDefault"
                  danger
                  @click="confirmDelete(item)"
                >
                  <template #icon><Icon icon="lucide:trash-2" /></template>
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </Spin>

    <!-- 测试连接结果弹窗 -->
    <Modal
      :open="testModalVisible"
      :title="`测试连接 — ${testName}`"
      :footer="null"
      width="440px"
      @cancel="testModalVisible = false"
    >
      <div
        class="flex min-h-[80px] items-center justify-center"
        style="padding: 16px 0"
      >
        <Spin v-if="testingId !== null" tip="连接测试中，请稍候..." />
        <div v-else-if="testResult" class="w-full">
          <Alert
            :type="testResult.success ? 'success' : 'error'"
            :message="testResult.success ? '连接成功' : '连接失败'"
            :description="testResult.message"
            show-icon
          />
          <p class="mt-2 text-right text-xs text-muted-foreground">
            延迟：{{ testResult.latencyMs }} ms
          </p>
        </div>
      </div>
    </Modal>

    <!-- Drawer 编辑 -->
    <Drawer
      :open="drawerOpen"
      :title="drawerTitle"
      :width="560"
      @close="drawerOpen = false"
    >
      <Form layout="vertical" class="space-y-1">
        <!-- 基本信息 -->
        <div class="mb-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-[3px] rounded bg-primary"></span>
            <span class="text-sm font-semibold">基本信息</span>
          </div>
          <FormItem label="配置名称" required>
            <Input
              v-model:value="form.name"
              :placeholder="
                isEmbeddingTab
                  ? '如：本地 BGE-M3'
                  : isRouterTab
                    ? '如：Qwen2.5-0.5B (域路由)'
                    : isRerankerTab
                      ? '如：本地 BGE-Reranker-v2-M3'
                      : isIntentTab
                        ? '如：本地 BERT 意图分类服务'
                        : '如：天翼云 DeepSeek-V4-Flash'
              "
            />
          </FormItem>
          <div class="flex gap-3">
            <FormItem label="供应商" required class="flex-1">
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
            <FormItem label="API 协议" required class="flex-1">
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
        </div>

        <!-- 连接配置 -->
        <div class="mb-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-[3px] rounded bg-emerald-500"></span>
            <span class="text-sm font-semibold">连接配置</span>
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
                : isToolServiceTab
                  ? '本地部署无需 Key 可留空'
                  : ''
            "
          >
            <InputPassword
              v-model:value="form.apiKeyEnc"
              :placeholder="
                isToolServiceTab
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
                    : isRerankerTab
                      ? '如 bge-reranker-v2-m3 / bge-reranker-v2-large'
                      : isIntentTab
                        ? '如 bert-intent / chinese-roberta-wwm-ext'
                        : '如 DeepSeek-V4-Flash / gpt-4o'
              "
            />
          </FormItem>
        </div>

        <!-- 参数设置 -->
        <div class="mb-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-[3px] rounded bg-amber-500"></span>
            <span class="text-sm font-semibold">参数设置</span>
          </div>
          <template v-if="!isToolServiceTab">
            <div class="flex gap-3">
              <FormItem label="温度（0-2）" class="flex-1">
                <InputNumber
                  v-model:value="form.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  style="width: 100%"
                />
              </FormItem>
              <FormItem label="Max Tokens" class="flex-1">
                <InputNumber
                  v-model:value="form.maxTokens"
                  :min="1"
                  :max="32000"
                  style="width: 100%"
                />
              </FormItem>
              <FormItem label="超时（秒）" class="flex-1">
                <InputNumber
                  v-model:value="form.timeoutSec"
                  :min="5"
                  :max="300"
                  style="width: 100%"
                />
              </FormItem>
            </div>
          </template>
          <template v-else>
            <FormItem
              label="超时（秒）"
              :help="
                isIntentTab
                  ? 'BERT 意图分类要求快速响应，建议 ≤ 2s'
                  : isRouterTab
                    ? '路由判断需快速响应，建议 ≤ 10s'
                    : '服务 HTTP 请求超时，可根据 GPU 性能调整'
              "
            >
              <InputNumber
                v-model:value="form.timeoutSec"
                :min="1"
                :max="300"
                style="width: 160px"
              />
            </FormItem>
          </template>
        </div>

        <!-- 其他 -->
        <div>
          <div class="mb-3 flex items-center gap-2">
            <span class="h-4 w-[3px] rounded bg-slate-400"></span>
            <span class="text-sm font-semibold">其他</span>
          </div>
          <FormItem label="启用状态">
            <Switch
              v-model:checked="form.isEnabled"
              checked-children="启用"
              un-checked-children="禁用"
            />
            <span class="ml-2 text-xs opacity-50">
              禁用后该模型不参与对话和路由
            </span>
          </FormItem>
          <FormItem label="备注">
            <Textarea
              v-model:value="form.remark"
              :rows="2"
              placeholder="可选备注"
            />
          </FormItem>
        </div>
      </Form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button @click="drawerOpen = false">取消</Button>
          <Button type="primary" :loading="submitting" @click="submit">
            保存
          </Button>
        </div>
      </template>
    </Drawer>
  </Page>
</template>
