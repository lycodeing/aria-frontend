<script lang="ts" setup>
import type { ToolDTO, ToolTestResult } from '#/api/dit';

import { computed, onMounted, ref } from 'vue';

import { JsonViewer } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
  Drawer,
  Empty,
  Form,
  FormItem,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  SelectOption,
  Spin,
  Switch,
  Tag,
  Textarea,
  Tooltip,
} from 'ant-design-vue';

import {
  createToolApi,
  deleteToolApi,
  listToolsApi,
  testToolApi,
  updateToolApi,
} from '#/api/dit';

// ---- 工具列表 ----
const tools = ref<ToolDTO[]>([]);
const loading = ref(false);
const selectedToolId = ref<null | number>(null);

const selectedTool = computed(
  () => tools.value.find((t) => t.id === selectedToolId.value) ?? null,
);

// ---- 搜索 + 筛选 ----
const searchKeyword = ref('');
const filterToolType = ref<string>('');
const filterAuthType = ref<string>('');

const filteredTools = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  return tools.value.filter((t) => {
    if (kw) {
      const code = (t.code || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      if (!code.includes(kw) && !name.includes(kw)) return false;
    }
    if (filterToolType.value && t.toolType !== filterToolType.value)
      return false;
    if (filterAuthType.value && t.authType !== filterAuthType.value)
      return false;
    return true;
  });
});

// ---- 统计概览 ----
const stats = computed(() => ({
  total: tools.value.length,
  http: tools.value.filter((t) => t.toolType === 'HTTP').length,
  builtin: tools.value.filter((t) => t.toolType === 'BUILTIN').length,
  discover: tools.value.filter((t) => t.isDiscoverTool === true).length,
}));

// ---- 参数 Schema 解析（用于详情展示） ----
interface ParamItem {
  name: string;
  type: string;
  description: string;
}
function parseParamSchema(raw: string): ParamItem[] {
  try {
    const obj = JSON.parse(raw || '{}');
    if (typeof obj !== 'object' || Array.isArray(obj)) return [];
    return Object.entries(obj).map(([name, schema]: [string, any]) => ({
      name,
      type: schema?.type || 'string',
      description: schema?.description || '',
    }));
  } catch {
    return [];
  }
}

const selectedToolParams = computed(() =>
  selectedTool.value
    ? parseParamSchema(selectedTool.value.paramSchema || '')
    : [],
);

// ---- 启用状态切换 ----
const togglingIds = ref<Set<number>>(new Set());

async function toggleEnabled(t: ToolDTO, newValue: boolean) {
  if (!t.id) return;
  togglingIds.value.add(t.id);
  try {
    await updateToolApi(t.id, { ...t, enabled: newValue });
    const target = tools.value.find((x) => x.id === t.id);
    if (target) target.enabled = newValue;
    message.success(newValue ? '已启用' : '已禁用');
  } catch {
    message.error('切换失败，请重试');
  } finally {
    togglingIds.value.delete(t.id);
  }
}

// ---- 测试调用弹窗 ----
const testModalVisible = ref(false);
const testingTool = ref<null | ToolDTO>(null);
const testParamsJson = ref('{}');
const testLoading = ref(false);
const testResult = ref<null | ToolTestResult>(null);
const testParamError = ref('');

const testResultJson = computed(() => {
  if (!testResult.value?.rawResponse) return {};
  try {
    return JSON.parse(testResult.value.rawResponse);
  } catch {
    return testResult.value.rawResponse;
  }
});

const testExtractedJson = computed(() => {
  if (!testResult.value?.extractedResult) return {};
  try {
    return JSON.parse(testResult.value.extractedResult);
  } catch {
    return testResult.value.extractedResult;
  }
});

/** 按 JSON Schema 声明的 type 返回一个合理的初始值，避免把 "" 硬塞进 number/boolean 字段导致服务端校验失败 */
function defaultForType(type: unknown): unknown {
  switch (type) {
    case 'array': {
      return [];
    }
    case 'boolean': {
      return false;
    }
    case 'integer':
    case 'number': {
      return 0;
    }
    case 'object': {
      return {};
    }
    // string 与未知 type 兜底为空字符串
    default: {
      return '';
    }
  }
}

function openTestModal(t: ToolDTO) {
  testingTool.value = t;
  testResult.value = null;
  testParamError.value = '';
  try {
    const schema = JSON.parse(t.paramSchema || '{}') as Record<string, any>;
    const initParams: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(schema)) {
      initParams[key] = defaultForType(spec?.type);
    }
    testParamsJson.value = JSON.stringify(initParams, null, 2);
  } catch (error) {
    console.warn('[dit-tools] parse paramSchema failed', error);
    testParamsJson.value = '{}';
  }
  testModalVisible.value = true;
}

function closeTestModal() {
  testModalVisible.value = false;
}

async function runTest() {
  if (!testingTool.value?.id) return;
  testParamError.value = '';
  let params: Record<string, unknown>;
  try {
    params = JSON.parse(testParamsJson.value);
  } catch {
    testParamError.value = 'JSON 格式有误，请检查';
    return;
  }
  testLoading.value = true;
  testResult.value = null;
  try {
    testResult.value = await testToolApi(testingTool.value.id, params);
  } catch (error: any) {
    message.error(`调用失败：${error?.message || '未知错误'}`);
  } finally {
    testLoading.value = false;
  }
}

// ---- 编辑 Drawer ----
const drawerVisible = ref(false);
const editingTool = ref<null | ToolDTO>(null);
const form = ref<Partial<ToolDTO>>({});
const saving = ref(false);

// ---- 参数 Schema 编辑器 ----
const paramList = ref<ParamItem[]>([]);
const paramMode = ref<'advanced' | 'simple'>('simple');
const paramSchemaRaw = ref('{}');
const paramSchemaError = ref('');

function buildParamSchema(): string {
  const obj: Record<string, { description: string; type: string }> = {};
  for (const p of paramList.value) {
    if (p.name.trim()) {
      obj[p.name.trim()] = {
        type: p.type || 'string',
        description: p.description || '',
      };
    }
  }
  return JSON.stringify(obj);
}

const currentParamSchema = computed(() =>
  paramMode.value === 'simple' ? buildParamSchema() : paramSchemaRaw.value,
);

function switchToAdvanced() {
  try {
    paramSchemaRaw.value = JSON.stringify(
      JSON.parse(buildParamSchema() || '{}'),
      null,
      2,
    );
  } catch {
    paramSchemaRaw.value = buildParamSchema();
  }
  paramSchemaError.value = '';
  paramMode.value = 'advanced';
}

function switchToSimple() {
  const parsed = parseParamSchema(paramSchemaRaw.value);
  if (
    parsed.length > 0 ||
    paramSchemaRaw.value.trim() === '{}' ||
    paramSchemaRaw.value.trim() === ''
  ) {
    paramList.value = parsed;
  }
  paramSchemaError.value = '';
  paramMode.value = 'simple';
}

function formatParamSchema() {
  try {
    paramSchemaRaw.value = JSON.stringify(
      JSON.parse(paramSchemaRaw.value),
      null,
      2,
    );
    paramSchemaError.value = '';
  } catch {
    paramSchemaError.value = 'JSON 格式有误，无法格式化，请检查语法';
  }
}

function addParam() {
  paramList.value.push({ name: '', type: 'string', description: '' });
}

function removeParam(index: number) {
  paramList.value.splice(index, 1);
}

// ---- CRUD ----
onMounted(() => loadTools());

async function loadTools() {
  loading.value = true;
  try {
    tools.value = await listToolsApi();
  } catch {
    message.error('加载工具列表失败');
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingTool.value = null;
  form.value = {
    toolType: 'HTTP',
    httpMethod: 'GET',
    authType: 'NONE',
    timeoutMs: 5000,
    isDiscoverTool: false,
    enabled: true,
  };
  paramList.value = [];
  paramMode.value = 'simple';
  paramSchemaRaw.value = '{}';
  drawerVisible.value = true;
}

function openEdit(t: ToolDTO) {
  editingTool.value = t;
  form.value = { ...t };
  paramList.value = parseParamSchema(t.paramSchema || '');
  paramSchemaRaw.value = t.paramSchema || '{}';
  paramMode.value = 'simple';
  drawerVisible.value = true;
}

async function save() {
  if (!form.value.code || !form.value.name || !form.value.description) {
    message.error('工具码、名称、说明为必填');
    return;
  }
  saving.value = true;
  const data = {
    ...form.value,
    paramSchema: currentParamSchema.value,
  } as ToolDTO;
  try {
    if (editingTool.value?.id) {
      await updateToolApi(editingTool.value.id, data);
      message.success('更新成功');
    } else {
      await createToolApi(data);
      message.success('注册成功');
    }
    drawerVisible.value = false;
    await loadTools();
  } catch {
    message.error('操作失败，请重试');
  } finally {
    saving.value = false;
  }
}

function confirmDelete(t: ToolDTO) {
  if (!t.id) {
    message.error('工具 ID 缺失，无法删除');
    return;
  }
  const toolId = t.id;
  Modal.confirm({
    title: `删除工具「${t.name}」？`,
    content: '删除后已绑定的意图工具将失效',
    okType: 'danger',
    async onOk() {
      try {
        await deleteToolApi(toolId);
        message.success('已删除');
        if (selectedToolId.value === toolId) selectedToolId.value = null;
        await loadTools();
      } catch (error) {
        console.warn('[dit-tools] delete failed', error);
        message.error('删除失败，请重试');
      }
    },
  });
}

function selectTool(t: ToolDTO) {
  if (!t.id) return;
  const id = t.id;
  selectedToolId.value = selectedToolId.value === id ? null : id;
}
</script>

<template>
  <Page>
    <!-- 顶部工具栏 -->
    <div
      class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3"
    >
      <div class="flex items-center gap-2">
        <span class="text-base font-bold">工具注册中心</span>
        <span class="h-5 w-px bg-border"></span>
        <span
          class="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
        >
          共 {{ stats.total }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-cyan-50 px-2.5 py-0.5 text-xs font-medium text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400"
        >
          HTTP {{ stats.http }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
        >
          BUILTIN {{ stats.builtin }}
        </span>
        <span
          class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
        >
          发现工具 {{ stats.discover }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Input
          v-model:value="searchKeyword"
          allow-clear
          placeholder="搜索工具码 / 名称"
          style="width: 200px"
        >
          <template #prefix>
            <Icon icon="lucide:search" class="text-muted-foreground" />
          </template>
        </Input>
        <Select
          v-model:value="filterToolType"
          allow-clear
          placeholder="类型"
          style="width: 110px"
        >
          <SelectOption value="HTTP">HTTP</SelectOption>
          <SelectOption value="BUILTIN">BUILTIN</SelectOption>
        </Select>
        <Select
          v-model:value="filterAuthType"
          allow-clear
          placeholder="认证"
          style="width: 110px"
        >
          <SelectOption value="NONE">NONE</SelectOption>
          <SelectOption value="BEARER">BEARER</SelectOption>
          <SelectOption value="API_KEY">API_KEY</SelectOption>
          <SelectOption value="BASIC">BASIC</SelectOption>
        </Select>
        <Button type="primary" @click="openCreate">
          <template #icon><Icon icon="lucide:plus" /></template>
          注册工具
        </Button>
      </div>
    </div>

    <!-- 主体：卡片网格 + 详情侧栏 -->
    <div class="flex items-start gap-4">
      <!-- 左侧：工具卡片网格 -->
      <div class="min-w-0 flex-1">
        <Spin :spinning="loading">
          <Empty
            v-if="filteredTools.length === 0"
            description="暂无工具"
            style="padding: 60px 0"
          />
          <div
            v-else
            class="grid gap-3"
            style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr))"
          >
            <div
              v-for="tool in filteredTools"
              :key="tool.id"
              class="relative flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-4 transition hover:border-blue-300 hover:shadow-md"
              :class="{
                'border-blue-500 ring-2 ring-blue-100 dark:ring-blue-900/30':
                  selectedToolId === tool.id,
                'opacity-55': !tool.enabled,
              }"
              @click="selectTool(tool)"
            >
              <!-- 发现工具角标 -->
              <div
                v-if="tool.isDiscoverTool"
                class="absolute right-0 top-0 rounded-bl-lg rounded-tr-xl bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white"
              >
                发现工具
              </div>

              <!-- 头部：名称 + 开关 -->
              <div class="flex items-start justify-between">
                <div class="min-w-0 flex-1 pr-2">
                  <div class="flex items-center gap-1.5">
                    <Icon
                      :icon="
                        tool.enabled
                          ? 'lucide:circle-check'
                          : 'lucide:circle-minus'
                      "
                      :class="
                        tool.enabled
                          ? 'text-emerald-500'
                          : 'text-muted-foreground'
                      "
                      style="font-size: 14px"
                    />
                    <span class="truncate font-semibold">{{ tool.name }}</span>
                  </div>
                  <div
                    class="mt-0.5 truncate font-mono text-xs text-muted-foreground"
                  >
                    {{ tool.code }}
                  </div>
                </div>
                <Switch
                  :checked="tool.enabled"
                  :loading="togglingIds.has(tool.id!)"
                  size="small"
                  @change="(v: unknown) => toggleEnabled(tool, !!v)"
                  @click.stop
                />
              </div>

              <!-- 描述 -->
              <div
                class="line-clamp-2 text-xs leading-relaxed text-muted-foreground"
              >
                {{ tool.description }}
              </div>

              <!-- 标签行 -->
              <div class="flex flex-wrap items-center gap-1">
                <span
                  class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                  :class="
                    tool.toolType === 'HTTP'
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                  "
                >
                  {{ tool.toolType }}
                </span>
                <span
                  v-if="tool.httpMethod"
                  class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                >
                  {{ tool.httpMethod }}
                </span>
                <span
                  v-if="tool.authType && tool.authType !== 'NONE'"
                  class="inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                >
                  {{ tool.authType }}
                </span>
                <span
                  v-else
                  class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                >
                  无认证
                </span>
              </div>

              <!-- URL -->
              <div
                v-if="tool.urlTemplate"
                class="truncate rounded bg-slate-50 px-2 py-1 font-mono text-[11px] text-muted-foreground dark:bg-slate-800/50"
              >
                {{ tool.urlTemplate }}
              </div>

              <!-- 底部：元信息 + 操作 -->
              <div
                class="mt-auto flex items-center justify-between border-t pt-2"
              >
                <div
                  class="flex items-center gap-2 text-[10px] text-muted-foreground"
                >
                  <span class="flex items-center gap-0.5">
                    <Icon icon="lucide:clock" style="font-size: 10px" />
                    {{ tool.timeoutMs ? `${tool.timeoutMs}ms` : '-' }}
                  </span>
                  <span>|</span>
                  <span
                    >{{
                      parseParamSchema(tool.paramSchema || '').length
                    }}
                    参数</span
                  >
                </div>
                <div class="flex items-center gap-0.5" @click.stop>
                  <Tooltip title="测试调用">
                    <Button
                      type="text"
                      size="small"
                      class="text-amber-500 hover:text-amber-600"
                      @click="openTestModal(tool)"
                    >
                      <template #icon>
                        <Icon icon="lucide:plug-zap" />
                      </template>
                    </Button>
                  </Tooltip>
                  <Tooltip title="编辑">
                    <Button
                      type="text"
                      size="small"
                      class="text-slate-500 hover:text-slate-700"
                      @click="openEdit(tool)"
                    >
                      <template #icon>
                        <Icon icon="lucide:pencil" />
                      </template>
                    </Button>
                  </Tooltip>
                  <Tooltip title="删除">
                    <Button
                      type="text"
                      size="small"
                      danger
                      @click="confirmDelete(tool)"
                    >
                      <template #icon>
                        <Icon icon="lucide:trash-2" />
                      </template>
                    </Button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </Spin>
      </div>

      <!-- 右侧：详情面板 -->
      <div
        v-if="selectedTool"
        class="w-[420px] shrink-0 overflow-hidden rounded-xl border bg-card"
      >
        <!-- 面板头部 -->
        <div
          class="flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:from-blue-900/20 dark:to-indigo-900/20"
        >
          <div>
            <div class="text-base font-bold">{{ selectedTool.name }}</div>
            <div class="mt-0.5 font-mono text-xs text-muted-foreground">
              {{ selectedTool.code }}
            </div>
          </div>
          <div class="flex gap-1">
            <Button size="small" @click="openEdit(selectedTool)">
              <template #icon><Icon icon="lucide:pencil" /></template>
              编辑
            </Button>
            <Button size="small" type="text" @click="selectedToolId = null">
              <template #icon><Icon icon="lucide:x" /></template>
            </Button>
          </div>
        </div>

        <!-- 面板内容 -->
        <div class="max-h-[600px] overflow-y-auto p-4">
          <!-- 基本信息 -->
          <div class="mb-3 space-y-1.5 text-xs">
            <div class="flex items-center gap-2">
              <span class="min-w-[60px] text-muted-foreground">类型</span>
              <span
                class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                :class="
                  selectedTool.toolType === 'HTTP'
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                "
              >
                {{ selectedTool.toolType }}
              </span>
              <span
                v-if="selectedTool.httpMethod"
                class="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              >
                {{ selectedTool.httpMethod }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="min-w-[60px] text-muted-foreground">认证</span>
              <span
                class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                :class="
                  selectedTool.authType === 'NONE'
                    ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    : 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                "
              >
                {{ selectedTool.authType }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="min-w-[60px] text-muted-foreground">超时</span>
              <span class="font-medium">{{ selectedTool.timeoutMs }} ms</span>
            </div>
            <div v-if="selectedTool.urlTemplate" class="flex items-start gap-2">
              <span class="min-w-[60px] text-muted-foreground">URL</span>
              <span
                class="break-all font-mono text-[11px] text-muted-foreground"
              >
                {{ selectedTool.urlTemplate }}
              </span>
            </div>
            <div
              v-if="selectedTool.responseJsonpath"
              class="flex items-center gap-2"
            >
              <span class="min-w-[60px] text-muted-foreground">JSONPath</span>
              <span class="font-mono text-[11px] text-blue-500">
                {{ selectedTool.responseJsonpath }}
              </span>
            </div>
            <div class="flex items-start gap-2">
              <span class="min-w-[60px] text-muted-foreground">说明</span>
              <span class="text-[11px] leading-relaxed">
                {{ selectedTool.description }}
              </span>
            </div>
          </div>

          <!-- 参数 Schema -->
          <div v-if="selectedToolParams.length > 0" class="mt-4 border-t pt-3">
            <div
              class="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground"
            >
              <span class="h-3 w-[3px] rounded bg-blue-500"></span>
              参数 Schema ({{ selectedToolParams.length }})
            </div>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="p in selectedToolParams"
                :key="p.name"
                class="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/50"
              >
                <span class="min-w-[80px] font-mono text-[11px] font-semibold">
                  {{ p.name }}
                </span>
                <span
                  class="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                >
                  {{ p.type }}
                </span>
                <span class="flex-1 text-[11px] text-muted-foreground">
                  {{ p.description }}
                </span>
              </div>
            </div>
          </div>

          <!-- 快捷测试按钮 -->
          <div class="mt-4 border-t pt-3">
            <Button
              block
              type="primary"
              ghost
              @click="openTestModal(selectedTool)"
            >
              <template #icon><Icon icon="lucide:plug-zap" /></template>
              测试调用
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- 测试调用弹窗 -->
    <Modal
      :open="testModalVisible"
      :title="`测试调用 — ${testingTool?.name ?? ''}`"
      :footer="null"
      width="760"
      @cancel="closeTestModal"
    >
      <div class="flex flex-col gap-4">
        <!-- 参数输入 -->
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="text-sm font-medium">请求参数 (JSON)</span>
            <span class="text-xs text-muted-foreground">
              key 为参数名，value 为参数值
            </span>
          </div>
          <Textarea
            v-model:value="testParamsJson"
            :rows="6"
            placeholder="{}"
            style="font-family: monospace; font-size: 13px"
          />
          <p v-if="testParamError" class="mt-1 text-xs text-red-500">
            {{ testParamError }}
          </p>
        </div>

        <!-- JSONPath 提示 -->
        <div
          v-if="testingTool?.responseJsonpath"
          class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted-foreground dark:bg-slate-800/50"
        >
          JSONPath 提取路径：
          <code
            class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-blue-500 dark:bg-slate-700"
          >
            {{ testingTool.responseJsonpath }}
          </code>
        </div>

        <Button type="primary" :loading="testLoading" @click="runTest">
          <template #icon>
            <Icon
              :icon="testLoading ? 'lucide:loader-circle' : 'lucide:play'"
              :class="testLoading ? 'animate-spin' : ''"
            />
          </template>
          执行调用
        </Button>

        <!-- 结果区 -->
        <template v-if="testResult">
          <!-- 状态行 -->
          <div class="flex items-center gap-3">
            <Tag :color="testResult.status === 'SUCCESS' ? 'success' : 'error'">
              {{ testResult.status }}
            </Tag>
            <Tag v-if="testResult.httpStatus" color="default">
              HTTP {{ testResult.httpStatus }}
            </Tag>
            <span class="text-xs text-muted-foreground">
              {{ testResult.durationMs }} ms
            </span>
          </div>

          <!-- 错误信息 -->
          <div
            v-if="testResult.errorMsg"
            class="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
          >
            {{ testResult.errorMsg }}
          </div>

          <!-- JSONPath 提取结果（树形预览） -->
          <div
            v-if="testResult.extractedResult && testingTool?.responseJsonpath"
          >
            <div class="mb-1 text-sm font-medium text-blue-600">
              JSONPath 提取结果
              <code class="ml-1 text-xs text-muted-foreground">
                {{ testingTool.responseJsonpath }}
              </code>
            </div>
            <div
              class="max-h-[240px] overflow-y-auto rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-900/10"
            >
              <JsonViewer
                :value="testExtractedJson"
                :expand-depth="3"
                copyable
              />
            </div>
          </div>

          <!-- 原始响应（树形预览） -->
          <div v-if="testResult.rawResponse">
            <div class="mb-1 text-sm font-medium">原始响应</div>
            <div
              class="max-h-[280px] overflow-y-auto rounded-lg border bg-slate-50 p-3 dark:bg-slate-800/50"
            >
              <JsonViewer :value="testResultJson" :expand-depth="2" copyable />
            </div>
          </div>
        </template>
      </div>
    </Modal>

    <!-- 编辑 Drawer -->
    <Drawer
      :open="drawerVisible"
      :title="editingTool ? '编辑工具' : '注册新工具'"
      :width="560"
      @close="drawerVisible = false"
    >
      <Form layout="vertical">
        <FormItem label="工具码" required>
          <Input
            v-model:value="form.code"
            placeholder="如：get_order（全局唯一）"
          />
        </FormItem>
        <FormItem label="名称" required>
          <Input v-model:value="form.name" placeholder="如：查询订单" />
        </FormItem>
        <FormItem label="工具说明（给 LLM 看）" required>
          <Textarea
            v-model:value="form.description"
            :rows="2"
            placeholder="根据订单号获取订单详情，当用户询问订单状态时调用"
          />
        </FormItem>
        <FormItem label="工具类型">
          <Select v-model:value="form.toolType" style="width: 100%">
            <SelectOption value="HTTP">HTTP（通用 HTTP 调用）</SelectOption>
            <SelectOption value="BUILTIN">
              BUILTIN（内置 Java 实现）
            </SelectOption>
          </Select>
        </FormItem>
        <FormItem label="HTTP 方法">
          <Select v-model:value="form.httpMethod" style="width: 100%">
            <SelectOption value="GET">GET</SelectOption>
            <SelectOption value="POST">POST</SelectOption>
            <SelectOption value="PUT">PUT</SelectOption>
            <SelectOption value="DELETE">DELETE</SelectOption>
          </Select>
        </FormItem>
        <FormItem label="URL 模板">
          <Input
            v-model:value="form.urlTemplate"
            placeholder="https://api.shop.com/orders/{order_id}"
          />
        </FormItem>
        <FormItem label="参数 Schema">
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <Button
                :type="paramMode === 'simple' ? 'primary' : 'default'"
                size="small"
                @click="switchToSimple"
              >
                简单模式
              </Button>
              <Button
                :type="paramMode === 'advanced' ? 'primary' : 'default'"
                size="small"
                @click="switchToAdvanced"
              >
                高级模式
              </Button>
            </div>
            <div v-show="paramMode === 'simple'" class="flex flex-col gap-2">
              <div
                v-for="(p, idx) in paramList"
                :key="idx"
                class="flex items-center gap-2"
              >
                <Input
                  v-model:value="p.name"
                  placeholder="参数名"
                  style="width: 130px"
                />
                <Select v-model:value="p.type" style="width: 100px">
                  <SelectOption value="string">string</SelectOption>
                  <SelectOption value="number">number</SelectOption>
                  <SelectOption value="boolean">boolean</SelectOption>
                  <SelectOption value="object">object</SelectOption>
                  <SelectOption value="array">array</SelectOption>
                </Select>
                <Input
                  v-model:value="p.description"
                  placeholder="参数说明"
                  class="flex-1"
                />
                <Button
                  type="link"
                  danger
                  size="small"
                  @click="removeParam(idx)"
                >
                  删除
                </Button>
              </div>
              <Button size="small" @click="addParam">+ 添加参数</Button>
            </div>
            <div v-show="paramMode === 'advanced'" class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">
                  直接编辑 JSON Schema，支持嵌套结构
                </span>
                <Button size="small" @click="formatParamSchema">格式化</Button>
              </div>
              <Textarea
                v-model:value="paramSchemaRaw"
                :rows="8"
                style="width: 100%; font-family: monospace; font-size: 12px"
              />
              <span v-if="paramSchemaError" class="text-xs text-red-500">
                {{ paramSchemaError }}
              </span>
            </div>
          </div>
        </FormItem>
        <FormItem label="响应提取 JSONPath">
          <Input
            v-model:value="form.responseJsonpath"
            placeholder="$.data（为空则返回完整响应）"
          />
        </FormItem>
        <FormItem label="认证类型">
          <Select v-model:value="form.authType" style="width: 100%">
            <SelectOption value="NONE">无认证</SelectOption>
            <SelectOption value="BEARER">Bearer Token</SelectOption>
            <SelectOption value="API_KEY">API Key</SelectOption>
            <SelectOption value="BASIC">Basic Auth</SelectOption>
          </Select>
        </FormItem>
        <FormItem v-if="form.authType !== 'NONE'" label="认证配置（JSON）">
          <Textarea
            v-model:value="form.authConfig"
            :rows="2"
            placeholder="{ &quot;token_encrypted&quot;: &quot;your-token&quot; }"
          />
        </FormItem>
        <FormItem label="超时（毫秒）">
          <InputNumber
            v-model:value="form.timeoutMs"
            :min="500"
            :max="30000"
            style="width: 100%"
          />
        </FormItem>
        <FormItem label="可作为发现工具">
          <Switch v-model:checked="form.isDiscoverTool" />
          <span class="ml-2 text-xs text-muted-foreground">
            启用后可用于槽位 DISCOVER 级候选项发现
          </span>
        </FormItem>
      </Form>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button @click="drawerVisible = false">取消</Button>
          <Button
            v-if="editingTool?.id"
            @click="
              () => {
                drawerVisible = false;
                openTestModal(editingTool!);
              }
            "
          >
            测试调用
          </Button>
          <Button type="primary" :loading="saving" @click="save">保存</Button>
        </div>
      </template>
    </Drawer>
  </Page>
</template>
