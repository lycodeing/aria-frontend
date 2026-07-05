<script lang="ts" setup>
import type { ToolDTO, ToolTestResult } from '#/api/dit';

import { computed, onMounted, ref } from 'vue';

import { JsonViewer } from '@vben/common-ui';

import {
  Button,
  Drawer,
  Form,
  FormItem,
  Input,
  InputNumber,
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
  createToolApi,
  deleteToolApi,
  listToolsApi,
  testToolApi,
  updateToolApi,
} from '#/api/dit';

const tools = ref<ToolDTO[]>([]);
const drawerVisible = ref(false);
const editingTool = ref<null | ToolDTO>(null);
const form = ref<Partial<ToolDTO>>({});
const saving = ref(false);

// ---- 参数 Schema 编辑器：简单/高级双模式 ----
interface ParamItem {
  name: string;
  type: string;
  description: string;
}
const paramList = ref<ParamItem[]>([]);
const paramMode = ref<'advanced' | 'simple'>('simple');
const paramSchemaRaw = ref('{}');
const paramSchemaError = ref('');

// 简单 → 高级：从列表生成 JSON
function switchToAdvanced() {
  try {
    paramSchemaRaw.value = JSON.stringify(JSON.parse(buildParamSchema() || '{}'), null, 2);
  } catch {
    paramSchemaRaw.value = buildParamSchema();
  }
  paramSchemaError.value = '';
  paramMode.value = 'advanced';
}

// 高级 → 简单：解析 JSON 回列表（解析失败则保留原列表）
function switchToSimple() {
  const parsed = parseParamSchema(paramSchemaRaw.value);
  if (parsed.length > 0 || paramSchemaRaw.value.trim() === '{}' || paramSchemaRaw.value.trim() === '') {
    paramList.value = parsed;
  }
  paramSchemaError.value = '';
  paramMode.value = 'simple';
}

// 格式化 JSON
function formatParamSchema() {
  try {
    paramSchemaRaw.value = JSON.stringify(JSON.parse(paramSchemaRaw.value), null, 2);
    paramSchemaError.value = '';
  } catch {
    paramSchemaError.value = 'JSON 格式有误，无法格式化，请检查语法';
  }
}

// 当前模式下获取最终 paramSchema 字符串
const currentParamSchema = computed(() =>
  paramMode.value === 'simple' ? buildParamSchema() : paramSchemaRaw.value,
);

function addParam() {
  paramList.value.push({ name: '', type: 'string', description: '' });
}

function removeParam(index: number) {
  paramList.value.splice(index, 1);
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

function buildParamSchema(): string {
  const obj: Record<string, { description: string; type: string }> = {};
  for (const p of paramList.value) {
    if (p.name.trim()) {
      obj[p.name.trim()] = { type: p.type || 'string', description: p.description || '' };
    }
  }
  return JSON.stringify(obj);
}

// ---- 测试调用 ----
const testModalVisible = ref(false);
const testingTool = ref<null | ToolDTO>(null);
const testParamsJson = ref('{}');
const testLoading = ref(false);
const testResult = ref<null | ToolTestResult>(null);
const testParamError = ref('');

const testResultJson = computed(() => {
  if (!testResult.value?.rawResponse) return {};
  try { return JSON.parse(testResult.value.rawResponse); } catch { return testResult.value.rawResponse; }
});

const testExtractedJson = computed(() => {
  if (!testResult.value?.extractedResult) return {};
  try { return JSON.parse(testResult.value.extractedResult); } catch { return testResult.value.extractedResult; }
});

function openTestModal(t: ToolDTO) {
  testingTool.value = t;
  testResult.value = null;
  testParamError.value = '';
  // 根据 paramSchema 生成初始参数 JSON
  try {
    const schema = JSON.parse(t.paramSchema || '{}');
    const initParams: Record<string, string> = {};
    for (const key of Object.keys(schema)) {
      initParams[key] = '';
    }
    testParamsJson.value = JSON.stringify(initParams, null, 2);
  } catch {
    testParamsJson.value = '{}';
  }
  testModalVisible.value = true;
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
  } catch (e: any) {
    message.error('调用失败：' + (e?.message || '未知错误'));
  } finally {
    testLoading.value = false;
  }
}

const columns = [
  { title: '工具码', dataIndex: 'code', key: 'code' },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'toolType', key: 'toolType', width: 90 },
  { title: '方法', dataIndex: 'httpMethod', key: 'httpMethod', width: 80 },
  { title: '认证', dataIndex: 'authType', key: 'authType', width: 90 },
  {
    title: '发现工具',
    dataIndex: 'isDiscoverTool',
    key: 'isDiscoverTool',
    width: 90,
  },
  { title: '操作', key: 'actions', width: 120 },
];

onMounted(() => loadTools());

async function loadTools() {
  try {
    tools.value = await listToolsApi();
  } catch {
    message.error('加载工具列表失败');
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
  Modal.confirm({
    title: `删除工具「${t.name}」？`,
    content: '删除后已绑定的意图工具将失效',
    okType: 'danger',
    async onOk() {
      try {
        await deleteToolApi(t.id!);
        message.success('已删除');
        await loadTools();
      } catch {
        message.error('删除失败，请重试');
      }
    },
  });
}
</script>

<template>
  <div style="padding: 16px">
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      "
    >
      <span style="font-size: 16px; font-weight: 600">工具注册中心</span>
      <Button type="primary" @click="openCreate">+ 注册新工具</Button>
    </div>

    <Table :data-source="tools" :columns="columns" row-key="id" size="middle">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'toolType'">
          <Tag :color="record.toolType === 'HTTP' ? 'blue' : 'purple'">
            {{ record.toolType }}
          </Tag>
        </template>
        <template v-if="column.key === 'isDiscoverTool'">
          <Tag v-if="record.isDiscoverTool" color="green">发现工具</Tag>
          <span v-else>-</span>
        </template>
        <template v-if="column.key === 'actions'">
          <Space>
            <Button type="link" size="small" @click="openEdit(record as ToolDTO)">编辑</Button>
            <Button type="link" size="small" @click="openTestModal(record as ToolDTO)">测试</Button>
            <Button type="link" danger size="small" @click="confirmDelete(record as ToolDTO)">删除</Button>
          </Space>
        </template>
      </template>
    </Table>

    <Drawer
      v-model:open="drawerVisible"
      :title="editingTool ? '编辑工具' : '注册新工具'"
      width="560"
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
            <!-- 模式切换 -->
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

            <!-- 简单模式：逐行编辑 -->
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
                <Button type="link" danger size="small" @click="removeParam(idx)">删除</Button>
              </div>
              <Button size="small" @click="addParam">+ 添加参数</Button>
            </div>

            <!-- 高级模式：直接编辑 JSON Schema -->
            <div v-show="paramMode === 'advanced'" class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span style="font-size: 12px; color: #999">直接编辑 JSON Schema，支持嵌套结构</span>
                <Button size="small" @click="formatParamSchema">格式化</Button>
              </div>
              <Textarea
                v-model:value="paramSchemaRaw"
                :rows="8"
                placeholder='{&#10;  "order_id": { "type": "string", "description": "订单号" },&#10;  "address": { "type": "object", "description": "地址信息" }&#10;}'
                style="font-family: monospace; font-size: 12px; width: 100%"
              />
              <span
                v-if="paramSchemaError"
                style="font-size: 12px; color: #ff4d4f"
              >
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
            placeholder="{&quot;token_encrypted&quot;:&quot;your-token&quot;}"
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
          <span style="margin-left: 8px; font-size: 12px; color: #999">
            启用后可用于槽位 DISCOVER 级候选项发现
          </span>
        </FormItem>
      </Form>
      <template #footer>
        <Button @click="drawerVisible = false">取消</Button>
        <Button
          v-if="editingTool?.id"
          style="margin-left: 8px"
          @click="() => { drawerVisible = false; openTestModal(editingTool!) }"
        >
          测试调用
        </Button>
        <Button
          type="primary"
          style="margin-left: 8px"
          :loading="saving"
          @click="save"
        >
          保存
        </Button>
      </template>
    </Drawer>

    <!-- 测试调用 Modal -->
    <Modal
      v-model:open="testModalVisible"
      :title="`测试调用 — ${testingTool?.name ?? ''}`"
      :footer="null"
      width="720"
      :body-style="{ padding: '20px 24px' }"
    >
      <div class="flex flex-col gap-4">
        <!-- 参数输入 -->
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="text-sm font-medium">请求参数 (JSON)</span>
            <span style="font-size: 12px; color: #999">key 为参数名，value 为参数值</span>
          </div>
          <Textarea
            v-model:value="testParamsJson"
            :rows="5"
            placeholder="{}"
            style="font-family: monospace; font-size: 13px"
          />
          <p v-if="testParamError" style="color: #ff4d4f; font-size: 12px; margin-top: 4px">
            {{ testParamError }}
          </p>
        </div>

        <!-- JSONPath 提示 -->
        <div
          v-if="testingTool?.responseJsonpath"
          style="padding: 8px 12px; background: #f6f8fa; border-radius: 6px; font-size: 12px; color: #666"
        >
          当前配置的 JSONPath 提取路径：
          <code style="background:#e8eaed; padding: 1px 6px; border-radius: 3px; color: #1677ff">
            {{ testingTool.responseJsonpath }}
          </code>
        </div>

        <Button type="primary" :loading="testLoading" @click="runTest">
          ▶ 执行调用
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
            <span style="font-size: 12px; color: #999">{{ testResult.durationMs }} ms</span>
          </div>

          <!-- 错误信息 -->
          <div
            v-if="testResult.errorMsg"
            style="padding: 10px 12px; background: #fff2f0; border: 1px solid #ffccc7; border-radius: 6px; font-size: 13px; color: #cf1322"
          >
            {{ testResult.errorMsg }}
          </div>

          <!-- JSONPath 提取结果 -->
          <div v-if="testResult.extractedResult && testingTool?.responseJsonpath">
            <div class="mb-1 text-sm font-medium" style="color: #1677ff">
              ✅ JSONPath 提取结果 <code style="font-size:11px;color:#666">{{ testingTool.responseJsonpath }}</code>
            </div>
            <div
              style="
                padding: 10px 12px;
                background: #f0f7ff;
                border: 1px solid #91caff;
                border-radius: 6px;
                max-height: 320px;
                overflow-y: auto;
              "
            >
              <JsonViewer :value="testExtractedJson" :expand-depth="3" copyable />
            </div>
          </div>

          <!-- 原始响应 -->
          <div v-if="testResult.rawResponse">
            <div class="mb-1 text-sm font-medium">原始响应</div>
            <div
              style="
                padding: 10px 12px;
                background: #fafafa;
                border: 1px solid #f0f0f0;
                border-radius: 6px;
                max-height: 360px;
                overflow-y: auto;
              "
            >
              <JsonViewer :value="testResultJson" :expand-depth="2" copyable />
            </div>
          </div>
        </template>
      </div>
    </Modal>
  </div>
</template>
