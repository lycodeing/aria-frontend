# DIT 框架管理 UI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** 实现领域/意图/工具管理后台页面，接入后端 DIT 管理 API，并同步更新数据库菜单。

**Architecture:** 新建 2 个页面（domains/index.vue、tools/index.vue）+ API 层（api/dit/index.ts）+ 路由追加。遵循项目现有 Ant Design Vue + Vben Admin 规范。

**Tech Stack:** Vue 3, TypeScript, Ant Design Vue, @vben/request (requestClient)

---

## 文件改动总览

| 操作 | 文件 |
|---|---|
| 新建 | `apps/src/api/dit/index.ts` |
| 新建 | `apps/src/views/customerservice/dit/domains/index.vue` |
| 新建 | `apps/src/views/customerservice/dit/tools/index.vue` |
| 修改 | `apps/src/router/routes/modules/customerservice.ts` |

---

## Task 1: DIT API 层

**Files:**
- Create: `apps/src/api/dit/index.ts`

- [ ] **Step 1: 创建 API 文件**

```typescript
import { requestClient } from '#/api/request';

// ---- 领域 ----
export interface DomainDTO {
  id?: number;
  code: string;
  name: string;
  description?: string;
  systemPromptAddon?: string;
  enabled?: boolean;
}
export const listDomainsApi = () => requestClient.get<DomainDTO[]>('/admin/dit/domains');
export const createDomainApi = (data: DomainDTO) => requestClient.post<DomainDTO>('/admin/dit/domains', data);
export const updateDomainApi = (id: number, data: DomainDTO) => requestClient.put(`/admin/dit/domains/${id}`, data);
export const deleteDomainApi = (id: number) => requestClient.delete(`/admin/dit/domains/${id}`);

// ---- 意图 ----
export interface IntentDTO {
  id?: number;
  domainId: number;
  code: string;
  name: string;
  description: string;
  exampleQueries?: string;
  autoTransfer?: boolean;
  skipRag?: boolean;
  fallbackReply?: string;
  sortOrder?: number;
}
export const listIntentsApi = (domainId: number) =>
  requestClient.get<IntentDTO[]>('/admin/dit/intents', { params: { domainId } });
export const createIntentApi = (data: IntentDTO) => requestClient.post<IntentDTO>('/admin/dit/intents', data);
export const updateIntentApi = (id: number, data: IntentDTO) => requestClient.put(`/admin/dit/intents/${id}`, data);
export const deleteIntentApi = (id: number) => requestClient.delete(`/admin/dit/intents/${id}`);

// ---- 槽位 ----
export interface SlotDTO {
  id?: number;
  intentId: number;
  slotName: string;
  slotType?: string;
  description: string;
  required?: boolean;
  resolveStrategy?: string;
  sessionKey?: string;
  discoverToolCode?: string;
  discoverFixedParams?: string;
  askUserPrompt?: string;
  sortOrder?: number;
}
export const listSlotsApi = (intentId: number) =>
  requestClient.get<SlotDTO[]>('/admin/dit/slots', { params: { intentId } });
export const createSlotApi = (data: SlotDTO) => requestClient.post<SlotDTO>('/admin/dit/slots', data);
export const updateSlotApi = (id: number, data: SlotDTO) => requestClient.put(`/admin/dit/slots/${id}`, data);
export const deleteSlotApi = (id: number) => requestClient.delete(`/admin/dit/slots/${id}`);

// ---- 工具 ----
export interface ToolDTO {
  id?: number;
  code: string;
  name: string;
  description: string;
  toolType?: string;
  httpMethod?: string;
  urlTemplate?: string;
  headersTemplate?: string;
  bodyTemplate?: string;
  paramSchema?: string;
  responseJsonpath?: string;
  authType?: string;
  authConfig?: string;
  timeoutMs?: number;
  isDiscoverTool?: boolean;
}
export const listToolsApi = () => requestClient.get<ToolDTO[]>('/admin/dit/tools');
export const createToolApi = (data: ToolDTO) => requestClient.post<ToolDTO>('/admin/dit/tools', data);
export const updateToolApi = (id: number, data: ToolDTO) => requestClient.put(`/admin/dit/tools/${id}`, data);
export const deleteToolApi = (id: number) => requestClient.delete(`/admin/dit/tools/${id}`);

// ---- 绑定 ----
export interface BindingDTO {
  id?: number;
  intentId: number;
  toolId: number;
  executionMode?: string;
  executionOrder?: number;
  paramMappings?: string;
}
export const listBindingsApi = (intentId: number) =>
  requestClient.get<BindingDTO[]>('/admin/dit/bindings', { params: { intentId } });
export const createBindingApi = (data: BindingDTO) => requestClient.post<BindingDTO>('/admin/dit/bindings', data);
export const deleteBindingApi = (id: number) => requestClient.delete(`/admin/dit/bindings/${id}`);
```

- [ ] **Step 2: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
git add apps/src/api/dit/index.ts
git commit -m "feat(DIT管理): 新增 DIT API 层（领域/意图/槽位/工具/绑定）"
```

---

## Task 2: 领域与意图配置页（domains/index.vue）

**Files:**
- Create: `apps/src/views/customerservice/dit/domains/index.vue`

- [ ] **Step 1: 创建页面**

```vue
<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import {
  message, Modal,
  Tree, Button, Form, FormItem, Input, Switch, Textarea,
  Table, Tag, Select, SelectOption, Space, Drawer
} from 'ant-design-vue';
import type { TreeDataItem } from 'ant-design-vue/es/tree';
import {
  listDomainsApi, createDomainApi, updateDomainApi, deleteDomainApi,
  listIntentsApi, createIntentApi, updateIntentApi, deleteIntentApi,
  listSlotsApi, createSlotApi, updateSlotApi, deleteSlotApi,
  listToolsApi, listBindingsApi, createBindingApi, deleteBindingApi
} from '#/api/dit';
import type { DomainDTO, IntentDTO, SlotDTO, ToolDTO, BindingDTO } from '#/api/dit';

// ---- 领域树 ----
const domains = ref<DomainDTO[]>([]);
const selectedDomainId = ref<number | null>(null);
const selectedIntentId = ref<number | null>(null);
const activeTab = ref('basic');

// ---- 意图列表 ----
const intents = ref<IntentDTO[]>([]);
const slots = ref<SlotDTO[]>([]);
const bindings = ref<BindingDTO[]>([]);
const allTools = ref<ToolDTO[]>([]);

// 表单状态
const domainDrawerVisible = ref(false);
const intentDrawerVisible = ref(false);
const slotDrawerVisible = ref(false);
const bindingDrawerVisible = ref(false);
const editingDomain = ref<DomainDTO | null>(null);
const editingIntent = ref<IntentDTO | null>(null);
const editingSlot = ref<SlotDTO | null>(null);

const [domainForm] = Form.useForm();
const [intentForm] = Form.useForm();
const [slotForm] = Form.useForm();
const [bindingForm] = Form.useForm();

// ---- 加载 ----
onMounted(async () => {
  await loadDomains();
  allTools.value = await listToolsApi();
});

async function loadDomains() {
  domains.value = await listDomainsApi();
}

async function loadIntents(domainId: number) {
  intents.value = await listIntentsApi(domainId);
}

async function loadSlots(intentId: number) {
  slots.value = await listSlotsApi(intentId);
}

async function loadBindings(intentId: number) {
  bindings.value = await listBindingsApi(intentId);
}

// ---- 选择领域 ----
async function selectDomain(id: number) {
  selectedDomainId.value = id;
  selectedIntentId.value = null;
  await loadIntents(id);
}

// ---- 选择意图 ----
async function selectIntent(intentId: number) {
  selectedIntentId.value = intentId;
  activeTab.value = 'basic';
  await Promise.all([loadSlots(intentId), loadBindings(intentId)]);
}

const selectedIntent = computed(() =>
  intents.value.find(i => i.id === selectedIntentId.value) || null
);

// ---- 领域 CRUD ----
function openCreateDomain() {
  editingDomain.value = null;
  domainForm.resetFields();
  domainDrawerVisible.value = true;
}
function openEditDomain(d: DomainDTO) {
  editingDomain.value = d;
  domainForm.setFieldsValue(d);
  domainDrawerVisible.value = true;
}
async function saveDomain() {
  const values = await domainForm.validateFields();
  if (editingDomain.value?.id) {
    await updateDomainApi(editingDomain.value.id, values);
    message.success('更新成功');
  } else {
    await createDomainApi(values);
    message.success('创建成功');
  }
  domainDrawerVisible.value = false;
  await loadDomains();
}
function confirmDeleteDomain(d: DomainDTO) {
  Modal.confirm({
    title: `删除领域「${d.name}」？`,
    content: '将同时删除所有意图和槽位，不可恢复',
    okType: 'danger',
    async onOk() {
      await deleteDomainApi(d.id!);
      message.success('已删除');
      if (selectedDomainId.value === d.id) { selectedDomainId.value = null; intents.value = []; }
      await loadDomains();
    },
  });
}

// ---- 意图 CRUD ----
function openCreateIntent() {
  editingIntent.value = null;
  intentForm.resetFields();
  intentDrawerVisible.value = true;
}
function openEditIntent(i: IntentDTO) {
  editingIntent.value = i;
  intentForm.setFieldsValue(i);
  intentDrawerVisible.value = true;
}
async function saveIntent() {
  const values = await intentForm.validateFields();
  values.domainId = selectedDomainId.value;
  if (editingIntent.value?.id) {
    await updateIntentApi(editingIntent.value.id, values);
    message.success('更新成功');
  } else {
    await createIntentApi(values);
    message.success('创建成功');
  }
  intentDrawerVisible.value = false;
  await loadIntents(selectedDomainId.value!);
}
async function deleteIntent(i: IntentDTO) {
  await deleteIntentApi(i.id!);
  message.success('已删除');
  if (selectedIntentId.value === i.id) selectedIntentId.value = null;
  await loadIntents(selectedDomainId.value!);
}

// ---- 槽位 CRUD ----
function openCreateSlot() {
  editingSlot.value = null;
  slotForm.resetFields();
  slotDrawerVisible.value = true;
}
function openEditSlot(s: SlotDTO) {
  editingSlot.value = s;
  slotForm.setFieldsValue(s);
  slotDrawerVisible.value = true;
}
async function saveSlot() {
  const values = await slotForm.validateFields();
  values.intentId = selectedIntentId.value;
  if (editingSlot.value?.id) {
    await updateSlotApi(editingSlot.value.id, values);
  } else {
    await createSlotApi(values);
  }
  message.success('保存成功');
  slotDrawerVisible.value = false;
  await loadSlots(selectedIntentId.value!);
}
async function deleteSlot(s: SlotDTO) {
  await deleteSlotApi(s.id!);
  message.success('已删除');
  await loadSlots(selectedIntentId.value!);
}

// ---- 工具绑定 ----
const slotColumns = [
  { title: '槽位名', dataIndex: 'slotName', key: 'slotName' },
  { title: '类型', dataIndex: 'slotType', key: 'slotType' },
  { title: '必填', dataIndex: 'required', key: 'required' },
  { title: '解析策略', dataIndex: 'resolveStrategy', key: 'resolveStrategy' },
  { title: '操作', key: 'actions' },
];
const bindingColumns = [
  { title: '工具', dataIndex: 'toolId', key: 'toolId' },
  { title: '模式', dataIndex: 'executionMode', key: 'executionMode' },
  { title: '顺序', dataIndex: 'executionOrder', key: 'executionOrder' },
  { title: '操作', key: 'actions' },
];
function toolName(id: number) {
  return allTools.value.find(t => t.id === id)?.name || String(id);
}
async function openCreateBinding() {
  bindingForm.resetFields();
  bindingDrawerVisible.value = true;
}
async function saveBinding() {
  const values = await bindingForm.validateFields();
  values.intentId = selectedIntentId.value;
  await createBindingApi(values);
  message.success('绑定成功');
  bindingDrawerVisible.value = false;
  await loadBindings(selectedIntentId.value!);
}
async function deleteBinding(b: BindingDTO) {
  await deleteBindingApi(b.id!);
  message.success('已解除');
  await loadBindings(selectedIntentId.value!);
}
</script>

<template>
  <div class="dit-domains-page">
    <div class="left-panel">
      <div class="panel-header">
        <span class="panel-title">领域列表</span>
        <a-button type="primary" size="small" @click="openCreateDomain">+ 新建</a-button>
      </div>
      <div
        v-for="d in domains" :key="d.id"
        :class="['domain-item', { active: selectedDomainId === d.id }]"
        @click="selectDomain(d.id!)"
      >
        <span>{{ d.name }}</span>
        <a-space size="small" class="domain-actions">
          <a @click.stop="openEditDomain(d)">编辑</a>
          <a style="color:red" @click.stop="confirmDeleteDomain(d)">删除</a>
        </a-space>
      </div>
    </div>

    <div class="right-panel">
      <template v-if="selectedDomainId">
        <div class="intent-list-header">
          <span class="panel-title">意图列表</span>
          <a-button size="small" @click="openCreateIntent">+ 新建意图</a-button>
        </div>
        <div class="intent-list">
          <div
            v-for="i in intents" :key="i.id"
            :class="['intent-item', { active: selectedIntentId === i.id }]"
            @click="selectIntent(i.id!)"
          >
            <span>{{ i.name }}</span>
            <a-space size="small">
              <a-tag v-if="i.autoTransfer" color="orange">转人工</a-tag>
              <a-tag v-if="i.skipRag" color="blue">跳过RAG</a-tag>
              <a @click.stop="openEditIntent(i)">编辑</a>
              <a style="color:red" @click.stop="deleteIntent(i)">删除</a>
            </a-space>
          </div>
        </div>
      </template>

      <template v-if="selectedIntentId && selectedIntent">
        <a-tabs v-model:activeKey="activeTab" style="margin-top:16px">
          <a-tab-pane key="basic" tab="基本信息">
            <a-descriptions :column="2" bordered size="small">
              <a-descriptions-item label="意图码">{{ selectedIntent.code }}</a-descriptions-item>
              <a-descriptions-item label="名称">{{ selectedIntent.name }}</a-descriptions-item>
              <a-descriptions-item label="自动转人工">
                <a-tag :color="selectedIntent.autoTransfer ? 'orange' : 'default'">
                  {{ selectedIntent.autoTransfer ? '是' : '否' }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="跳过RAG">
                <a-tag :color="selectedIntent.skipRag ? 'blue' : 'default'">
                  {{ selectedIntent.skipRag ? '是' : '否' }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="描述" :span="2">{{ selectedIntent.description }}</a-descriptions-item>
              <a-descriptions-item label="示例句子" :span="2">{{ selectedIntent.exampleQueries }}</a-descriptions-item>
            </a-descriptions>
          </a-tab-pane>

          <a-tab-pane key="slots" tab="槽位配置">
            <a-button size="small" style="margin-bottom:8px" @click="openCreateSlot">+ 添加槽位</a-button>
            <a-table :data-source="slots" :columns="slotColumns" size="small" :pagination="false" row-key="id">
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'required'">
                  <a-tag :color="record.required ? 'red' : 'default'">{{ record.required ? '必填' : '可选' }}</a-tag>
                </template>
                <template v-if="column.key === 'actions'">
                  <a-space>
                    <a @click="openEditSlot(record)">编辑</a>
                    <a style="color:red" @click="deleteSlot(record)">删除</a>
                  </a-space>
                </template>
              </template>
            </a-table>
          </a-tab-pane>

          <a-tab-pane key="tools" tab="工具绑定">
            <a-button size="small" style="margin-bottom:8px" @click="openCreateBinding">+ 绑定工具</a-button>
            <a-table :data-source="bindings" :columns="bindingColumns" size="small" :pagination="false" row-key="id">
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'toolId'">{{ toolName(record.toolId) }}</template>
                <template v-if="column.key === 'executionMode'">
                  <a-tag :color="record.executionMode === 'REQUIRED' ? 'red' : 'blue'">
                    {{ record.executionMode }}
                  </a-tag>
                </template>
                <template v-if="column.key === 'actions'">
                  <a style="color:red" @click="deleteBinding(record)">解除</a>
                </template>
              </template>
            </a-table>
          </a-tab-pane>
        </a-tabs>
      </template>
    </div>

    <!-- 领域抽屉 -->
    <a-drawer v-model:open="domainDrawerVisible" :title="editingDomain ? '编辑领域' : '新建领域'" width="480" @ok="saveDomain">
      <a-form :form="domainForm" layout="vertical">
        <a-form-item name="code" label="领域码" :rules="[{required:true}]"><a-input /></a-form-item>
        <a-form-item name="name" label="名称" :rules="[{required:true}]"><a-input /></a-form-item>
        <a-form-item name="description" label="描述"><a-input /></a-form-item>
        <a-form-item name="systemPromptAddon" label="System Prompt 追加"><a-textarea :rows="4" /></a-form-item>
      </a-form>
      <template #footer>
        <a-button @click="domainDrawerVisible=false">取消</a-button>
        <a-button type="primary" @click="saveDomain">保存</a-button>
      </template>
    </a-drawer>

    <!-- 意图抽屉 -->
    <a-drawer v-model:open="intentDrawerVisible" :title="editingIntent ? '编辑意图' : '新建意图'" width="520">
      <a-form :form="intentForm" layout="vertical">
        <a-form-item name="code" label="意图码" :rules="[{required:true}]"><a-input /></a-form-item>
        <a-form-item name="name" label="名称" :rules="[{required:true}]"><a-input /></a-form-item>
        <a-form-item name="description" label="描述" :rules="[{required:true}]"><a-textarea :rows="2" /></a-form-item>
        <a-form-item name="exampleQueries" label="示例句子 (JSON数组)"><a-textarea :rows="3" placeholder='["帮我查订单","我的包裹到哪了"]' /></a-form-item>
        <a-form-item name="autoTransfer" label="自动转人工" valuePropName="checked"><a-switch /></a-form-item>
        <a-form-item name="skipRag" label="跳过RAG" valuePropName="checked"><a-switch /></a-form-item>
        <a-form-item name="fallbackReply" label="工具失败兜底回复"><a-input /></a-form-item>
      </a-form>
      <template #footer>
        <a-button @click="intentDrawerVisible=false">取消</a-button>
        <a-button type="primary" @click="saveIntent">保存</a-button>
      </template>
    </a-drawer>

    <!-- 槽位抽屉 -->
    <a-drawer v-model:open="slotDrawerVisible" :title="editingSlot ? '编辑槽位' : '添加槽位'" width="480">
      <a-form :form="slotForm" layout="vertical">
        <a-form-item name="slotName" label="槽位名" :rules="[{required:true}]"><a-input /></a-form-item>
        <a-form-item name="slotType" label="类型">
          <a-select><a-select-option value="string">string</a-select-option><a-select-option value="number">number</a-select-option><a-select-option value="date">date</a-select-option></a-select>
        </a-form-item>
        <a-form-item name="description" label="说明" :rules="[{required:true}]"><a-input /></a-form-item>
        <a-form-item name="required" label="必填" valuePropName="checked"><a-switch /></a-form-item>
        <a-form-item name="resolveStrategy" label="解析策略 (JSON数组)"><a-input placeholder='["EXTRACT","SESSION","DISCOVER","ASK_USER"]' /></a-form-item>
        <a-form-item name="discoverToolCode" label="发现工具码"><a-input /></a-form-item>
        <a-form-item name="askUserPrompt" label="询问话术"><a-input /></a-form-item>
      </a-form>
      <template #footer>
        <a-button @click="slotDrawerVisible=false">取消</a-button>
        <a-button type="primary" @click="saveSlot">保存</a-button>
      </template>
    </a-drawer>

    <!-- 绑定抽屉 -->
    <a-drawer v-model:open="bindingDrawerVisible" title="绑定工具" width="420">
      <a-form :form="bindingForm" layout="vertical">
        <a-form-item name="toolId" label="工具" :rules="[{required:true}]">
          <a-select>
            <a-select-option v-for="t in allTools" :key="t.id" :value="t.id">{{ t.name }} ({{ t.code }})</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item name="executionMode" label="执行模式" :rules="[{required:true}]">
          <a-select><a-select-option value="REQUIRED">REQUIRED（必执行）</a-select-option><a-select-option value="OPTIONAL">OPTIONAL（LLM决策）</a-select-option></a-select>
        </a-form-item>
        <a-form-item name="executionOrder" label="执行顺序"><a-input-number :min="0" /></a-form-item>
      </a-form>
      <template #footer>
        <a-button @click="bindingDrawerVisible=false">取消</a-button>
        <a-button type="primary" @click="saveBinding">绑定</a-button>
      </template>
    </a-drawer>
  </div>
</template>

<style scoped>
.dit-domains-page { display: flex; gap: 16px; height: calc(100vh - 120px); padding: 16px; }
.left-panel { width: 240px; border: 1px solid #f0f0f0; border-radius: 8px; overflow: auto; }
.right-panel { flex: 1; border: 1px solid #f0f0f0; border-radius: 8px; padding: 16px; overflow: auto; }
.panel-header { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f0f0f0; }
.panel-title { font-weight: 600; }
.domain-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; cursor: pointer; transition: background 0.15s; }
.domain-item:hover, .domain-item.active { background: #e6f7ff; }
.domain-actions { opacity: 0; transition: opacity 0.15s; }
.domain-item:hover .domain-actions { opacity: 1; }
.intent-list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.intent-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; transition: background 0.15s; }
.intent-item:hover, .intent-item.active { background: #f0f5ff; }
</style>
```

- [ ] **Step 2: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
git add apps/src/views/customerservice/dit/domains/index.vue
git commit -m "feat(DIT管理): 新增领域与意图配置页（左树+右详情+Tab）"
```

---

## Task 3: 工具注册中心页（tools/index.vue）

**Files:**
- Create: `apps/src/views/customerservice/dit/tools/index.vue`

- [ ] **Step 1: 创建工具注册中心页面**

```vue
<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { listToolsApi, createToolApi, updateToolApi, deleteToolApi } from '#/api/dit';
import type { ToolDTO } from '#/api/dit';

const tools = ref<ToolDTO[]>([]);
const drawerVisible = ref(false);
const editingTool = ref<ToolDTO | null>(null);
const [form] = Form.useForm();

const columns = [
  { title: '工具码', dataIndex: 'code', key: 'code' },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'toolType', key: 'toolType' },
  { title: '方法', dataIndex: 'httpMethod', key: 'httpMethod' },
  { title: '认证', dataIndex: 'authType', key: 'authType' },
  { title: '发现工具', dataIndex: 'isDiscoverTool', key: 'isDiscoverTool' },
  { title: '操作', key: 'actions' },
];

import { Form } from 'ant-design-vue';

onMounted(() => loadTools());

async function loadTools() {
  tools.value = await listToolsApi();
}

function openCreate() {
  editingTool.value = null;
  form.resetFields();
  drawerVisible.value = true;
}

function openEdit(t: ToolDTO) {
  editingTool.value = t;
  form.setFieldsValue(t);
  drawerVisible.value = true;
}

async function save() {
  const values = await form.validateFields();
  if (editingTool.value?.id) {
    await updateToolApi(editingTool.value.id, values);
    message.success('更新成功');
  } else {
    await createToolApi(values);
    message.success('注册成功');
  }
  drawerVisible.value = false;
  await loadTools();
}

function confirmDelete(t: ToolDTO) {
  Modal.confirm({
    title: `删除工具「${t.name}」？`,
    okType: 'danger',
    async onOk() {
      await deleteToolApi(t.id!);
      message.success('已删除');
      await loadTools();
    },
  });
}
</script>

<template>
  <div style="padding: 16px">
    <div style="display:flex; justify-content:space-between; margin-bottom:16px">
      <span style="font-size:16px; font-weight:600">工具注册中心</span>
      <a-button type="primary" @click="openCreate">+ 注册新工具</a-button>
    </div>

    <a-table :data-source="tools" :columns="columns" row-key="id" size="middle">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'toolType'">
          <a-tag :color="record.toolType === 'HTTP' ? 'blue' : 'purple'">{{ record.toolType }}</a-tag>
        </template>
        <template v-if="column.key === 'isDiscoverTool'">
          <a-tag v-if="record.isDiscoverTool" color="green">发现工具</a-tag>
          <span v-else>-</span>
        </template>
        <template v-if="column.key === 'actions'">
          <a-space>
            <a @click="openEdit(record)">编辑</a>
            <a style="color:red" @click="confirmDelete(record)">删除</a>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-drawer
      v-model:open="drawerVisible"
      :title="editingTool ? '编辑工具' : '注册新工具'"
      width="560"
    >
      <a-form :form="form" layout="vertical">
        <a-form-item name="code" label="工具码" :rules="[{required:true,message:'请输入工具码'}]">
          <a-input placeholder="如：get_order" />
        </a-form-item>
        <a-form-item name="name" label="名称" :rules="[{required:true}]">
          <a-input placeholder="如：查询订单" />
        </a-form-item>
        <a-form-item name="description" label="工具说明（给 LLM 看）" :rules="[{required:true}]">
          <a-textarea :rows="2" placeholder="根据订单号获取订单详情，当用户询问订单状态时调用" />
        </a-form-item>
        <a-form-item name="toolType" label="工具类型" initialValue="HTTP">
          <a-select>
            <a-select-option value="HTTP">HTTP（通用 HTTP 调用）</a-select-option>
            <a-select-option value="BUILTIN">BUILTIN（内置 Java 实现）</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item name="httpMethod" label="HTTP 方法" initialValue="GET">
          <a-select>
            <a-select-option value="GET">GET</a-select-option>
            <a-select-option value="POST">POST</a-select-option>
            <a-select-option value="PUT">PUT</a-select-option>
            <a-select-option value="DELETE">DELETE</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item name="urlTemplate" label="URL 模板">
          <a-input placeholder="https://api.shop.com/orders/{order_id}" />
        </a-form-item>
        <a-form-item name="paramSchema" label="参数 JSON Schema">
          <a-textarea :rows="3" placeholder='{"order_id":{"type":"string","description":"订单号"}}' />
        </a-form-item>
        <a-form-item name="responseJsonpath" label="响应提取 JSONPath">
          <a-input placeholder="$.data（为空则返回完整响应）" />
        </a-form-item>
        <a-form-item name="authType" label="认证类型" initialValue="NONE">
          <a-select>
            <a-select-option value="NONE">无认证</a-select-option>
            <a-select-option value="BEARER">Bearer Token</a-select-option>
            <a-select-option value="API_KEY">API Key</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item name="timeoutMs" label="超时（毫秒）" initialValue="5000">
          <a-input-number :min="500" :max="30000" style="width:100%" />
        </a-form-item>
        <a-form-item name="isDiscoverTool" label="可作为发现工具" valuePropName="checked">
          <a-switch />
        </a-form-item>
      </a-form>
      <template #footer>
        <a-button @click="drawerVisible = false">取消</a-button>
        <a-button type="primary" @click="save">保存</a-button>
      </template>
    </a-drawer>
  </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add apps/src/views/customerservice/dit/tools/index.vue
git commit -m "feat(DIT管理): 新增工具注册中心页"
```

---

## Task 4: 路由追加

**Files:**
- Modify: `apps/src/router/routes/modules/customerservice.ts`

- [ ] **Step 1: 在文件末尾的 children 数组中追加 DIT 路由**

找到现有路由最后一项（CustomerServiceAgent），在其后追加：

```typescript
{
  name: 'CustomerServiceDIT',
  path: '/customerservice/dit',
  meta: { icon: 'lucide:settings-2', order: 40, title: 'DIT配置' },
  children: [
    {
      name: 'CustomerServiceDITDomains',
      path: '/customerservice/dit/domains',
      component: () => import('#/views/customerservice/dit/domains/index.vue'),
      meta: {
        icon: 'lucide:layers',
        title: '领域与意图',
        authority: ['super_admin', 'kf_manager'],
      },
    },
    {
      name: 'CustomerServiceDITTools',
      path: '/customerservice/dit/tools',
      component: () => import('#/views/customerservice/dit/tools/index.vue'),
      meta: {
        icon: 'lucide:wrench',
        title: '工具注册中心',
        authority: ['super_admin', 'kf_manager'],
      },
    },
  ],
},
```

- [ ] **Step 2: 验证前端构建无报错**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
pnpm typecheck 2>&1 | head -20
```

- [ ] **Step 3: 提交**

```bash
git add apps/src/router/routes/modules/customerservice.ts
git commit -m "feat(DIT管理): 追加 DIT 菜单路由"
```

---

## 验收标准

- [ ] `/customerservice/dit/domains` 可正常访问，左侧显示领域列表
- [ ] 点击领域显示意图列表，点击意图显示基本信息/槽位/绑定 Tab
- [ ] 增删改领域/意图/槽位/绑定均正常
- [ ] `/customerservice/dit/tools` 显示工具列表，可注册/编辑/删除
- [ ] 后端执行 migration-003-dit-menus.sql 后，刷新页面侧边栏出现「DIT配置」目录
