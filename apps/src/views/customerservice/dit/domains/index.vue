<script lang="ts" setup>
import type {
  BindingDTO,
  DomainDTO,
  IntentDTO,
  SlotDTO,
  ToolDTO,
} from '#/api/dit';

import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
  Card,
  Drawer,
  Form,
  FormItem,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  SelectOption,
  Switch,
  Textarea,
} from 'ant-design-vue';

import {
  createBindingApi,
  createDomainApi,
  createIntentApi,
  createSlotApi,
  deleteBindingApi,
  deleteDomainApi,
  deleteIntentApi,
  deleteSlotApi,
  listBindingsApi,
  listDomainsApi,
  listIntentsApi,
  listSlotsApi,
  listToolsApi,
  updateDomainApi,
  updateIntentApi,
  updateSlotApi,
} from '#/api/dit';

// ---- 状态 ----
const domains = ref<DomainDTO[]>([]);
const intents = ref<IntentDTO[]>([]);
const slots = ref<SlotDTO[]>([]);
const bindings = ref<BindingDTO[]>([]);
const allTools = ref<ToolDTO[]>([]);

const selectedDomainId = ref<null | number>(null);
const selectedIntentId = ref<null | number>(null);

const selectedDomain = computed(
  () => domains.value.find((d) => d.id === selectedDomainId.value) || null,
);

const selectedIntent = computed(
  () => intents.value.find((i) => i.id === selectedIntentId.value) || null,
);

const selectedIntentExamples = computed(() => {
  if (!selectedIntent.value?.exampleQueries) return [];
  try {
    const arr = JSON.parse(selectedIntent.value.exampleQueries);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
});

const selectedIntentKeywords = computed(() => {
  if (!selectedIntent.value?.keywords) return [];
  try {
    const arr = JSON.parse(selectedIntent.value.keywords);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
});

// ---- 抽屉状态 ----
const domainDrawerVisible = ref(false);
const intentDrawerVisible = ref(false);
const slotDrawerVisible = ref(false);
const bindingDrawerVisible = ref(false);

// ---- 防双提 loading 状态 ----
const savingDomain = ref(false);
const savingIntent = ref(false);
const savingSlot = ref(false);
const savingBinding = ref(false);

const editingDomain = ref<DomainDTO | null>(null);
const editingIntent = ref<IntentDTO | null>(null);
const editingSlot = ref<null | SlotDTO>(null);

const domainForm = ref<Partial<DomainDTO>>({});
const intentForm = ref<Partial<IntentDTO>>({});
const slotForm = ref<Partial<SlotDTO>>({});
const bindingForm = ref<Partial<BindingDTO>>({});

// ---- 加载 ----
onMounted(async () => {
  await loadDomains();
  try {
    allTools.value = await listToolsApi();
  } catch {
    message.error('加载工具列表失败');
  }
});

async function loadDomains() {
  try {
    domains.value = await listDomainsApi();
  } catch {
    message.error('加载领域列表失败');
  }
}

async function selectDomain(id: null | number | undefined) {
  if (!id) return;
  selectedDomainId.value = id;
  selectedIntentId.value = null;
  slots.value = [];
  bindings.value = [];
  try {
    intents.value = await listIntentsApi(id);
  } catch {
    message.error('加载意图列表失败');
  }
}

async function selectIntent(id: null | number | undefined) {
  if (!id) return;
  selectedIntentId.value = id;
  try {
    const [s, b] = await Promise.all([listSlotsApi(id), listBindingsApi(id)]);
    slots.value = s;
    bindings.value = b;
  } catch {
    message.error('加载槽位/绑定失败');
  }
}

function toolName(toolId: number) {
  return allTools.value.find((t) => t.id === toolId)?.name || String(toolId);
}

function parseResolveStrategy(raw: string): string[] {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// ---- 领域 CRUD ----
function openCreateDomain() {
  editingDomain.value = null;
  domainForm.value = { enabled: true };
  domainDrawerVisible.value = true;
}

function openEditDomain(d: DomainDTO) {
  editingDomain.value = d;
  domainForm.value = { ...d };
  domainDrawerVisible.value = true;
}

async function saveDomain() {
  if (!domainForm.value.code || !domainForm.value.name) {
    message.error('code 和名称为必填');
    return;
  }
  savingDomain.value = true;
  try {
    if (editingDomain.value?.id) {
      await updateDomainApi(
        editingDomain.value.id,
        domainForm.value as DomainDTO,
      );
      message.success('更新成功');
    } else {
      await createDomainApi(domainForm.value as DomainDTO);
      message.success('创建成功');
    }
    domainDrawerVisible.value = false;
    await loadDomains();
  } catch {
    message.error('操作失败，请重试');
  } finally {
    savingDomain.value = false;
  }
}

function confirmDeleteDomain(d: DomainDTO) {
  Modal.confirm({
    title: `删除领域「${d.name}」？`,
    content: '将同时删除所有意图和槽位，不可恢复',
    okType: 'danger',
    async onOk() {
      try {
        if (!d.id) return;
        await deleteDomainApi(d.id);
        message.success('已删除');
        if (selectedDomainId.value === d.id) {
          selectedDomainId.value = null;
          selectedIntentId.value = null;
          intents.value = [];
          slots.value = [];
          bindings.value = [];
        }
        await loadDomains();
      } catch {
        message.error('删除失败，请重试');
      }
    },
  });
}

// ---- 示例句子列表编辑器 ----
const exampleQueriesList = ref<string[]>([]);

function addExampleQuery() {
  exampleQueriesList.value.push('');
}

function removeExampleQuery(index: number) {
  exampleQueriesList.value.splice(index, 1);
}

// ---- 关键词列表编辑器 ----
const keywordsList = ref<string[]>([]);

function addKeyword() {
  keywordsList.value.push('');
}

function removeKeyword(index: number) {
  keywordsList.value.splice(index, 1);
}

// ---- 解析策略列表编辑器 ----
const resolveStrategyList = ref<string[]>([]);

function addResolveStrategy() {
  resolveStrategyList.value.push('');
}

function removeResolveStrategy(index: number) {
  resolveStrategyList.value.splice(index, 1);
}

// ---- 意图 CRUD ----
function openCreateIntent() {
  editingIntent.value = null;
  intentForm.value = {
    autoTransfer: false,
    skipRag: false,
    sortOrder: 0,
    keywordMatchMode: 'ANY_CONTAINS',
  };
  exampleQueriesList.value = [];
  keywordsList.value = [];
  intentDrawerVisible.value = true;
}

function openEditIntent(i: IntentDTO) {
  editingIntent.value = i;
  intentForm.value = { ...i };
  // 解析示例句子
  try {
    const arr = JSON.parse(i.exampleQueries || '[]');
    exampleQueriesList.value = Array.isArray(arr) ? arr : [];
  } catch {
    exampleQueriesList.value = [];
  }
  // 解析关键词列表
  try {
    const arr = JSON.parse(i.keywords || '[]');
    keywordsList.value = Array.isArray(arr) ? arr : [];
  } catch {
    keywordsList.value = [];
  }
  intentDrawerVisible.value = true;
}

async function saveIntent() {
  if (
    !intentForm.value.code ||
    !intentForm.value.name ||
    !intentForm.value.description
  ) {
    message.error('code、名称、描述为必填');
    return;
  }
  const domainId = selectedDomainId.value;
  if (!domainId) return;
  savingIntent.value = true;
  const data = {
    ...intentForm.value,
    domainId,
    exampleQueries: JSON.stringify(exampleQueriesList.value.filter(Boolean)),
    keywords: JSON.stringify(keywordsList.value.filter(Boolean)),
  } as IntentDTO;
  try {
    if (editingIntent.value?.id) {
      await updateIntentApi(editingIntent.value.id, data);
      message.success('更新成功');
    } else {
      await createIntentApi(data);
      message.success('创建成功');
    }
    intentDrawerVisible.value = false;
    intents.value = await listIntentsApi(domainId);
  } catch {
    message.error('操作失败，请重试');
  } finally {
    savingIntent.value = false;
  }
}

async function confirmDeleteIntent(i: IntentDTO) {
  // 在 Modal 打开时快照当前 domainId，避免用户确认前点击别处导致 .value 变化
  const domainId = selectedDomainId.value;
  if (!domainId) return;
  Modal.confirm({
    title: `删除意图「${i.name}」？`,
    okType: 'danger',
    async onOk() {
      try {
        if (!i.id) return;
        await deleteIntentApi(i.id);
        message.success('已删除');
        if (selectedIntentId.value === i.id) {
          selectedIntentId.value = null;
          slots.value = [];
          bindings.value = [];
        }
        intents.value = await listIntentsApi(domainId);
      } catch {
        message.error('删除失败，请重试');
      }
    },
  });
}

// ---- 槽位 CRUD ----
function openCreateSlot() {
  editingSlot.value = null;
  slotForm.value = {
    slotType: 'string',
    required: false,
    resolveStrategy: '["EXTRACT","SESSION","DISCOVER","ASK_USER"]',
    sortOrder: 0,
  };
  resolveStrategyList.value = ['EXTRACT', 'SESSION', 'DISCOVER', 'ASK_USER'];
  slotDrawerVisible.value = true;
}

function openEditSlot(s: SlotDTO) {
  editingSlot.value = s;
  slotForm.value = { ...s };
  try {
    const arr = JSON.parse(s.resolveStrategy || '[]');
    resolveStrategyList.value = Array.isArray(arr) ? arr : [];
  } catch {
    resolveStrategyList.value = [];
  }
  slotDrawerVisible.value = true;
}

async function saveSlot() {
  if (!slotForm.value.slotName || !slotForm.value.description) {
    message.error('槽位名和说明为必填');
    return;
  }
  savingSlot.value = true;
  const intentId = selectedIntentId.value;
  if (!intentId) return;
  const data = {
    ...slotForm.value,
    intentId,
    resolveStrategy: JSON.stringify(resolveStrategyList.value.filter(Boolean)),
  } as SlotDTO;
  try {
    await (editingSlot.value?.id
      ? updateSlotApi(editingSlot.value.id, data)
      : createSlotApi(data));
    message.success('保存成功');
    slotDrawerVisible.value = false;
    slots.value = await listSlotsApi(intentId);
  } catch {
    message.error('保存失败，请重试');
  } finally {
    savingSlot.value = false;
  }
}

function confirmDeleteSlot(s: SlotDTO) {
  // 快照 intentId，避免用户确认前切换意图导致列表刷新到错误的意图
  const intentId = selectedIntentId.value;
  if (!intentId) return;
  Modal.confirm({
    title: `删除槽位「${s.slotName}」？`,
    okType: 'danger',
    async onOk() {
      try {
        if (!s.id) return;
        await deleteSlotApi(s.id);
        message.success('已删除');
        slots.value = await listSlotsApi(intentId);
      } catch {
        message.error('删除失败，请重试');
      }
    },
  });
}

// ---- 绑定 CRUD ----
function openCreateBinding() {
  bindingForm.value = { executionMode: 'OPTIONAL', executionOrder: 0 };
  bindingDrawerVisible.value = true;
}

async function saveBinding() {
  if (!bindingForm.value.toolId) {
    message.error('请选择工具');
    return;
  }
  savingBinding.value = true;
  const intentId = selectedIntentId.value;
  if (!intentId) {
    savingBinding.value = false;
    return;
  }
  const data = {
    ...bindingForm.value,
    intentId,
  } as BindingDTO;
  try {
    await createBindingApi(data);
    message.success('绑定成功');
    bindingDrawerVisible.value = false;
    bindings.value = await listBindingsApi(intentId);
  } catch {
    message.error('绑定失败，请重试');
  } finally {
    savingBinding.value = false;
  }
}

function confirmDeleteBinding(b: BindingDTO) {
  // 快照 intentId，避免用户确认前切换意图
  const intentId = selectedIntentId.value;
  if (!intentId) return;
  Modal.confirm({
    title: '解除工具绑定？',
    okType: 'danger',
    async onOk() {
      try {
        if (!b.id) return;
        await deleteBindingApi(b.id);
        message.success('已解除');
        bindings.value = await listBindingsApi(intentId);
      } catch {
        message.error('解除失败，请重试');
      }
    },
  });
}
</script>

<template>
  <Page auto-content-height>
    <div class="flex h-full min-h-0 flex-col gap-3">
      <!-- 页面标题 + 统计胶囊 -->
      <div class="flex shrink-0 items-center justify-between">
        <h1 class="text-lg font-bold text-foreground">领域与意图</h1>
        <div class="flex gap-2">
          <span
            class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
          >
            领域 {{ domains.length }}
          </span>
          <span
            class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400"
          >
            意图 {{ intents.length }}
          </span>
          <span
            class="inline-flex items-center gap-1 rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
          >
            槽位 {{ slots.length }}
          </span>
        </div>
      </div>

      <!-- 面包屑 -->
      <div
        class="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm"
      >
        <span class="text-muted-foreground">领域管理</span>
        <template v-if="selectedDomain">
          <span class="text-muted-foreground/50">/</span>
          <span class="font-semibold text-primary">{{
            selectedDomain.name
          }}</span>
        </template>
        <template v-if="selectedIntent">
          <span class="text-muted-foreground/50">/</span>
          <span class="font-semibold text-foreground">{{
            selectedIntent.name
          }}</span>
        </template>
      </div>

      <!-- 三栏布局 -->
      <div class="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <!-- 第1栏：领域列表 -->
        <Card
          :bordered="false"
          size="small"
          class="flex h-full w-[220px] min-h-0 shrink-0 flex-col overflow-hidden shadow-sm"
          :body-style="{
            flex: '1 1 0%',
            minHeight: '0',
            overflowY: 'auto',
            padding: '8px',
          }"
        >
          <template #title>
            <span class="text-sm font-semibold">领域</span>
          </template>
          <template #extra>
            <Button type="primary" size="small" @click="openCreateDomain">
              <Icon icon="lucide:plus" class="mr-0.5 h-3 w-3" />
              新建
            </Button>
          </template>
          <div
            v-for="d in domains"
            :key="d.id"
            class="group mb-1 flex items-start justify-between rounded-lg border-l-[3px] px-3 py-2.5 transition-all"
            :class="
              selectedDomainId === d.id
                ? 'border-l-blue-500 bg-blue-50 dark:border-l-blue-400 dark:bg-blue-900/20'
                : 'cursor-pointer border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
            "
            @click="selectDomain(d.id)"
          >
            <div class="min-w-0 flex-1">
              <div
                class="truncate text-[13px] font-semibold"
                :class="
                  selectedDomainId === d.id
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-foreground'
                "
              >
                {{ d.name }}
              </div>
              <div
                class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
              >
                {{ d.code }}
              </div>
              <div class="mt-1.5 flex items-center gap-1">
                <span
                  class="rounded px-1.5 py-px text-[10px] font-medium"
                  :class="
                    d.enabled !== false
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  "
                >
                  {{ d.enabled !== false ? '启用' : '停用' }}
                </span>
                <span
                  v-if="selectedDomainId === d.id"
                  class="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                >
                  {{ intents.length }} 意图
                </span>
              </div>
            </div>
            <div
              class="flex flex-shrink-0 gap-0.5 transition-opacity"
              :class="
                selectedDomainId === d.id
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100'
              "
            >
              <button
                type="button"
                class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                @click.stop="openEditDomain(d)"
              >
                <Icon icon="lucide:pencil" class="h-3 w-3" />
              </button>
              <button
                type="button"
                class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                @click.stop="confirmDeleteDomain(d)"
              >
                <Icon icon="lucide:trash-2" class="h-3 w-3" />
              </button>
            </div>
          </div>
          <div
            v-if="!domains.length"
            class="py-10 text-center text-sm text-muted-foreground"
          >
            暂无领域
          </div>
        </Card>

        <!-- 第2栏：意图列表 -->
        <Card
          :bordered="false"
          size="small"
          class="flex h-full w-[260px] min-h-0 shrink-0 flex-col overflow-hidden shadow-sm"
          :body-style="{
            flex: '1 1 0%',
            minHeight: '0',
            overflowY: 'auto',
            padding: '8px',
          }"
        >
          <template #title>
            <span v-if="selectedDomainId" class="text-sm font-semibold">
              意图
              <span class="ml-1 text-xs font-normal text-muted-foreground">
                {{ intents.length }}
              </span>
            </span>
            <span v-else class="text-sm text-muted-foreground">请选择领域</span>
          </template>
          <template v-if="selectedDomainId" #extra>
            <Button size="small" @click="openCreateIntent">
              <Icon icon="lucide:plus" class="mr-0.5 h-3 w-3" />
              新建
            </Button>
          </template>

          <template v-if="selectedDomainId">
            <div
              v-for="i in intents"
              :key="i.id"
              class="group mb-1 cursor-pointer rounded-lg border-l-[3px] px-3 py-2.5 transition-all"
              :class="
                selectedIntentId === i.id
                  ? 'border-l-blue-500 bg-blue-50 dark:border-l-blue-400 dark:bg-blue-900/20'
                  : 'border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'
              "
              @click="selectIntent(i.id)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div
                    class="truncate text-[13px] font-semibold"
                    :class="
                      selectedIntentId === i.id
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-foreground'
                    "
                  >
                    {{ i.name }}
                  </div>
                  <div
                    class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
                  >
                    {{ i.code }}
                  </div>
                </div>
                <div
                  class="flex flex-shrink-0 gap-0.5 transition-opacity"
                  :class="
                    selectedIntentId === i.id
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  "
                >
                  <button
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    @click.stop="openEditIntent(i)"
                  >
                    <Icon icon="lucide:pencil" class="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    @click.stop="confirmDeleteIntent(i)"
                  >
                    <Icon icon="lucide:trash-2" class="h-3 w-3" />
                  </button>
                </div>
              </div>
              <!-- 标签行 -->
              <div
                v-if="i.autoTransfer || i.skipRag"
                class="mt-1.5 flex flex-wrap gap-1"
              >
                <span
                  v-if="i.autoTransfer"
                  class="rounded bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                >
                  转人工
                </span>
                <span
                  v-if="i.skipRag"
                  class="rounded bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                >
                  跳过RAG
                </span>
              </div>
              <!-- 统计行：仅选中意图显示真实计数 -->
              <div
                v-if="selectedIntentId === i.id"
                class="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground"
              >
                <span>槽位 {{ slots.length }}</span>
                <span class="opacity-50">|</span>
                <span>工具 {{ bindings.length }}</span>
              </div>
            </div>
            <div
              v-if="!intents.length"
              class="py-10 text-center text-sm text-muted-foreground"
            >
              暂无意图
            </div>
          </template>
          <div v-else class="py-10 text-center text-sm text-muted-foreground">
            请先在左侧选择领域
          </div>
        </Card>

        <!-- 第3栏：意图详情 -->
        <Card
          :bordered="false"
          size="small"
          class="flex h-full min-w-0 flex-1 flex-col overflow-hidden shadow-sm"
          :body-style="{
            flex: '1 1 0%',
            minHeight: '0',
            overflowY: 'auto',
            padding: '16px',
          }"
        >
          <template #title>
            <span v-if="selectedIntent" class="text-sm font-semibold"
              >意图详情</span
            >
            <span v-else class="text-sm text-muted-foreground">请选择意图</span>
          </template>
          <template v-if="selectedIntent" #extra>
            <Button
              type="link"
              size="small"
              @click="openEditIntent(selectedIntent)"
            >
              <Icon icon="lucide:pencil" class="mr-0.5 h-3 w-3" />
              编辑意图
            </Button>
          </template>

          <template v-if="selectedIntent">
            <!-- 意图头部卡片 -->
            <div
              class="mb-4 flex items-start justify-between gap-4 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:border-blue-900/30 dark:from-blue-900/20 dark:to-indigo-900/20"
            >
              <div class="min-w-0 flex-1">
                <div class="text-lg font-bold text-foreground">
                  {{ selectedIntent.name }}
                </div>
                <div class="mt-0.5 font-mono text-xs text-muted-foreground">
                  {{ selectedIntent.code }}
                </div>
                <div class="mt-1.5 max-w-md text-xs text-muted-foreground">
                  {{ selectedIntent.description }}
                </div>
                <div
                  v-if="selectedIntent.autoTransfer || selectedIntent.skipRag"
                  class="mt-2 flex flex-wrap gap-1"
                >
                  <span
                    v-if="selectedIntent.autoTransfer"
                    class="rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
                  >
                    转人工
                  </span>
                  <span
                    v-if="selectedIntent.skipRag"
                    class="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                  >
                    跳过RAG
                  </span>
                </div>
              </div>
              <div class="flex flex-shrink-0 gap-2">
                <Button size="small" @click="openCreateSlot">
                  <Icon icon="lucide:plus" class="mr-0.5 h-3 w-3" />
                  槽位
                </Button>
                <Button size="small" @click="openCreateBinding">
                  <Icon icon="lucide:plus" class="mr-0.5 h-3 w-3" />
                  工具
                </Button>
              </div>
            </div>

            <!-- 信息网格 -->
            <div class="mb-4 grid grid-cols-4 gap-2">
              <div class="rounded-lg border border-border bg-card px-3 py-2.5">
                <div class="mb-0.5 text-[11px] text-muted-foreground">
                  关键词匹配
                </div>
                <div class="text-sm font-semibold text-primary">
                  {{ selectedIntent.keywordMatchMode || 'ANY_CONTAINS' }}
                </div>
              </div>
              <div class="rounded-lg border border-border bg-card px-3 py-2.5">
                <div class="mb-0.5 text-[11px] text-muted-foreground">
                  兜底回复
                </div>
                <div
                  class="text-sm font-semibold"
                  :class="
                    selectedIntent.fallbackReply
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  "
                >
                  {{ selectedIntent.fallbackReply || '暂无' }}
                </div>
              </div>
              <div class="rounded-lg border border-border bg-card px-3 py-2.5">
                <div class="mb-0.5 text-[11px] text-muted-foreground">排序</div>
                <div class="text-sm font-semibold text-foreground">
                  {{ selectedIntent.sortOrder ?? 0 }}
                </div>
              </div>
              <div class="rounded-lg border border-border bg-card px-3 py-2.5">
                <div class="mb-0.5 text-[11px] text-muted-foreground">状态</div>
                <div
                  class="text-sm font-semibold"
                  :class="
                    selectedIntent.enabled !== false
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  "
                >
                  {{ selectedIntent.enabled !== false ? '启用' : '禁用' }}
                </div>
              </div>
            </div>

            <!-- 关键词标签区 -->
            <div class="mb-4">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
              >
                <span class="h-3 w-[3px] rounded bg-emerald-500"></span>
                关键词规则 ({{ selectedIntentKeywords.length }})
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(kw, idx) in selectedIntentKeywords"
                  :key="idx"
                  class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                >
                  {{ kw }}
                </span>
                <span
                  class="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                >
                  {{ selectedIntent.keywordMatchMode || 'ANY_CONTAINS' }}
                </span>
                <span
                  v-if="!selectedIntentKeywords.length"
                  class="text-xs text-muted-foreground"
                >
                  未配置（仅 BERT + LLM 分类）
                </span>
              </div>
            </div>

            <!-- 示例句子区 -->
            <div class="mb-4">
              <div
                class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
              >
                <span class="h-3 w-[3px] rounded bg-blue-500"></span>
                示例句子 ({{ selectedIntentExamples.length }})
              </div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(ex, idx) in selectedIntentExamples"
                  :key="idx"
                  class="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                >
                  {{ ex }}
                </span>
                <span
                  v-if="!selectedIntentExamples.length"
                  class="text-xs text-muted-foreground"
                >
                  暂无示例
                </span>
              </div>
            </div>

            <!-- 槽位 + 工具绑定 左右分栏 -->
            <div class="grid grid-cols-2 gap-3">
              <!-- 槽位配置卡片 -->
              <div class="overflow-hidden rounded-lg border border-border">
                <div
                  class="flex items-center justify-between border-b border-border bg-slate-50/50 px-3.5 py-2.5 dark:bg-slate-800/30"
                >
                  <div class="flex items-center gap-1.5 text-sm font-semibold">
                    <span class="h-3.5 w-[3px] rounded bg-blue-500"></span>
                    槽位配置
                    <span class="text-xs font-normal text-muted-foreground">
                      ({{ slots.length }})
                    </span>
                  </div>
                  <Button type="link" size="small" @click="openCreateSlot">
                    <Icon icon="lucide:plus" class="mr-0.5 h-3 w-3" />
                    添加
                  </Button>
                </div>
                <div class="px-3.5">
                  <div
                    v-for="s in slots"
                    :key="s.id"
                    class="flex items-center gap-2 border-b border-border py-2 last:border-0"
                  >
                    <span class="min-w-[72px] font-mono text-xs font-semibold">
                      {{ s.slotName }}
                    </span>
                    <span
                      class="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                    >
                      {{ s.slotType || 'string' }}
                    </span>
                    <div class="flex flex-1 flex-wrap gap-1">
                      <span
                        v-for="(strat, idx) in parseResolveStrategy(
                          s.resolveStrategy || '',
                        )"
                        :key="idx"
                        class="rounded bg-purple-50 px-1.5 py-0.5 text-[9px] text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
                      >
                        {{ strat }}
                      </span>
                    </div>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px]"
                      :class="
                        s.required
                          ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      "
                    >
                      {{ s.required ? '必填' : '可选' }}
                    </span>
                    <div class="flex gap-0.5">
                      <button
                        type="button"
                        class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                        @click="openEditSlot(s)"
                      >
                        <Icon icon="lucide:pencil" class="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        @click="confirmDeleteSlot(s)"
                      >
                        <Icon icon="lucide:trash-2" class="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div
                    v-if="!slots.length"
                    class="py-6 text-center text-xs text-muted-foreground"
                  >
                    暂无槽位
                  </div>
                </div>
              </div>

              <!-- 工具绑定卡片 -->
              <div class="overflow-hidden rounded-lg border border-border">
                <div
                  class="flex items-center justify-between border-b border-border bg-slate-50/50 px-3.5 py-2.5 dark:bg-slate-800/30"
                >
                  <div class="flex items-center gap-1.5 text-sm font-semibold">
                    <span class="h-3.5 w-[3px] rounded bg-purple-500"></span>
                    工具绑定
                    <span class="text-xs font-normal text-muted-foreground">
                      ({{ bindings.length }})
                    </span>
                  </div>
                  <Button type="link" size="small" @click="openCreateBinding">
                    <Icon icon="lucide:plus" class="mr-0.5 h-3 w-3" />
                    绑定
                  </Button>
                </div>
                <div class="px-3.5">
                  <div
                    v-for="b in bindings"
                    :key="b.id"
                    class="flex items-center gap-2 border-b border-border py-2 last:border-0"
                  >
                    <span class="flex-1 truncate text-xs font-semibold">
                      {{ toolName(b.toolId) }}
                    </span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px]"
                      :class="
                        b.executionMode === 'REQUIRED'
                          ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                          : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                      "
                    >
                      {{ b.executionMode || 'OPTIONAL' }}
                    </span>
                    <span class="text-[10px] text-muted-foreground">
                      顺序 {{ b.executionOrder ?? 0 }}
                    </span>
                    <button
                      type="button"
                      class="inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      @click="confirmDeleteBinding(b)"
                    >
                      <Icon icon="lucide:x" class="h-3 w-3" />
                    </button>
                  </div>
                  <div
                    v-if="!bindings.length"
                    class="py-6 text-center text-xs text-muted-foreground"
                  >
                    暂无绑定
                  </div>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="py-10 text-center text-sm text-muted-foreground">
            {{ selectedDomainId ? '请选择意图查看详情' : '请先选择领域' }}
          </div>
        </Card>
      </div>
    </div>

    <!-- 领域抽屉 -->
    <Drawer
      v-model:open="domainDrawerVisible"
      :title="editingDomain ? '编辑领域' : '新建领域'"
      width="480"
    >
      <Form layout="vertical">
        <FormItem label="领域码" required>
          <Input v-model:value="domainForm.code" placeholder="如：ecommerce" />
        </FormItem>
        <FormItem label="名称" required>
          <Input v-model:value="domainForm.name" placeholder="如：电商客服" />
        </FormItem>
        <FormItem label="描述">
          <Input v-model:value="domainForm.description" />
        </FormItem>
        <FormItem label="System Prompt 追加">
          <Textarea v-model:value="domainForm.systemPromptAddon" :rows="4" />
        </FormItem>
        <FormItem label="启用">
          <Switch v-model:checked="domainForm.enabled" />
        </FormItem>
      </Form>
      <template #footer>
        <Button @click="domainDrawerVisible = false">取消</Button>
        <Button
          type="primary"
          style="margin-left: 8px"
          :loading="savingDomain"
          @click="saveDomain"
        >
          保存
        </Button>
      </template>
    </Drawer>

    <!-- 意图抽屉 -->
    <Drawer
      v-model:open="intentDrawerVisible"
      :title="editingIntent ? '编辑意图' : '新建意图'"
      width="520"
    >
      <Form layout="vertical">
        <FormItem label="意图码" required>
          <Input
            v-model:value="intentForm.code"
            placeholder="如：query_order"
          />
        </FormItem>
        <FormItem label="名称" required>
          <Input v-model:value="intentForm.name" placeholder="如：查询订单" />
        </FormItem>
        <FormItem label="描述" required>
          <Textarea v-model:value="intentForm.description" :rows="2" />
        </FormItem>
        <FormItem label="示例句子">
          <div class="flex flex-col gap-2">
            <div
              v-for="(_, idx) in exampleQueriesList"
              :key="idx"
              class="flex items-center gap-2"
            >
              <Input
                v-model:value="exampleQueriesList[idx]"
                placeholder="如：帮我查订单"
                class="flex-1"
              />
              <Button
                type="link"
                danger
                size="small"
                @click="removeExampleQuery(idx)"
              >
                删除
              </Button>
            </div>
            <Button size="small" @click="addExampleQuery">
              + 添加示例句子
            </Button>
          </div>
        </FormItem>
        <FormItem
          label="关键词（Layer 1 规则匹配）"
          help="配置关键词后，用户消息命中时直接返回本意图，跳过 BERT 和 LLM，延迟 < 1ms"
        >
          <div class="flex flex-col gap-2">
            <div
              v-for="(_, idx) in keywordsList"
              :key="idx"
              class="flex items-center gap-2"
            >
              <Input
                v-model:value="keywordsList[idx]"
                placeholder="如：转人工"
                class="flex-1"
              />
              <Button
                type="link"
                danger
                size="small"
                @click="removeKeyword(idx)"
              >
                删除
              </Button>
            </div>
            <Button size="small" @click="addKeyword">+ 添加关键词</Button>
          </div>
        </FormItem>
        <FormItem label="关键词匹配模式">
          <Select
            v-model:value="intentForm.keywordMatchMode"
            style="width: 100%"
          >
            <SelectOption value="ANY_CONTAINS">
              ANY_CONTAINS — 任意关键词命中即触发（默认）
            </SelectOption>
            <SelectOption value="ALL_CONTAINS">
              ALL_CONTAINS — 所有关键词同时出现才触发
            </SelectOption>
            <SelectOption value="REGEX">
              REGEX — keywords[0] 作为正则表达式匹配
            </SelectOption>
          </Select>
        </FormItem>
        <FormItem label="自动转人工">
          <Switch v-model:checked="intentForm.autoTransfer" />
        </FormItem>
        <FormItem label="跳过RAG">
          <Switch v-model:checked="intentForm.skipRag" />
        </FormItem>
        <FormItem label="工具失败兜底回复">
          <Input v-model:value="intentForm.fallbackReply" />
        </FormItem>
      </Form>
      <template #footer>
        <Button @click="intentDrawerVisible = false">取消</Button>
        <Button
          type="primary"
          style="margin-left: 8px"
          :loading="savingIntent"
          @click="saveIntent"
        >
          保存
        </Button>
      </template>
    </Drawer>

    <!-- 槽位抽屉 -->
    <Drawer
      v-model:open="slotDrawerVisible"
      :title="editingSlot ? '编辑槽位' : '添加槽位'"
      width="480"
    >
      <Form layout="vertical">
        <FormItem label="槽位名" required>
          <Input v-model:value="slotForm.slotName" placeholder="如：order_id" />
        </FormItem>
        <FormItem label="类型">
          <Select v-model:value="slotForm.slotType" style="width: 100%">
            <SelectOption value="string">string</SelectOption>
            <SelectOption value="number">number</SelectOption>
            <SelectOption value="date">date</SelectOption>
            <SelectOption value="enum">enum</SelectOption>
          </Select>
        </FormItem>
        <FormItem label="说明" required>
          <Input v-model:value="slotForm.description" />
        </FormItem>
        <FormItem label="必填">
          <Switch v-model:checked="slotForm.required" />
        </FormItem>
        <FormItem label="解析策略">
          <div class="flex flex-col gap-2">
            <div
              v-for="(_, idx) in resolveStrategyList"
              :key="idx"
              class="flex items-center gap-2"
            >
              <Select
                v-model:value="resolveStrategyList[idx]"
                class="flex-1"
                placeholder="选择策略"
              >
                <SelectOption value="EXTRACT"
                  >EXTRACT（从用户消息中提取）</SelectOption
                >
                <SelectOption value="SESSION"
                  >SESSION（从会话上下文获取）</SelectOption
                >
                <SelectOption value="DISCOVER"
                  >DISCOVER（调用发现工具查询）</SelectOption
                >
                <SelectOption value="ASK_USER"
                  >ASK_USER（反问用户获取）</SelectOption
                >
              </Select>
              <Button
                type="link"
                danger
                size="small"
                @click="removeResolveStrategy(idx)"
              >
                删除
              </Button>
            </div>
            <Button size="small" @click="addResolveStrategy">
              + 添加策略
            </Button>
          </div>
        </FormItem>
        <FormItem label="发现工具码">
          <Input v-model:value="slotForm.discoverToolCode" />
        </FormItem>
        <FormItem label="询问话术">
          <Input v-model:value="slotForm.askUserPrompt" />
        </FormItem>
      </Form>
      <template #footer>
        <Button @click="slotDrawerVisible = false">取消</Button>
        <Button
          type="primary"
          style="margin-left: 8px"
          :loading="savingSlot"
          @click="saveSlot"
        >
          保存
        </Button>
      </template>
    </Drawer>

    <!-- 绑定抽屉 -->
    <Drawer v-model:open="bindingDrawerVisible" title="绑定工具" width="420">
      <Form layout="vertical">
        <FormItem label="工具" required>
          <Select
            v-model:value="bindingForm.toolId"
            style="width: 100%"
            placeholder="请选择工具"
          >
            <SelectOption v-for="t in allTools" :key="t.id" :value="t.id">
              {{ t.name }} ({{ t.code }})
            </SelectOption>
          </Select>
        </FormItem>
        <FormItem label="执行模式">
          <Select v-model:value="bindingForm.executionMode" style="width: 100%">
            <SelectOption value="REQUIRED">REQUIRED（必须执行）</SelectOption>
            <SelectOption value="OPTIONAL">OPTIONAL（LLM 决策）</SelectOption>
          </Select>
        </FormItem>
        <FormItem label="执行顺序">
          <InputNumber
            v-model:value="bindingForm.executionOrder"
            :min="0"
            style="width: 100%"
          />
        </FormItem>
      </Form>
      <template #footer>
        <Button @click="bindingDrawerVisible = false">取消</Button>
        <Button
          type="primary"
          style="margin-left: 8px"
          :loading="savingBinding"
          @click="saveBinding"
        >
          绑定
        </Button>
      </template>
    </Drawer>
  </Page>
</template>
