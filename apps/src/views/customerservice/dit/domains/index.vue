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

import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
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
  TabPane,
  Tabs,
  Tag,
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
const activeTab = ref('basic');

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

// ---- 表格列定义 ----
const slotColumns = [
  { title: '槽位名', dataIndex: 'slotName', key: 'slotName' },
  { title: '类型', dataIndex: 'slotType', key: 'slotType', width: 80 },
  {
    title: '必填',
    dataIndex: 'required',
    key: 'required',
    width: 70,
  },
  {
    title: '解析策略',
    dataIndex: 'resolveStrategy',
    key: 'resolveStrategy',
    width: 180,
  },
  { title: '操作', key: 'actions', width: 120 },
];

const bindingColumns = [
  { title: '工具', key: 'toolId' },
  {
    title: '模式',
    dataIndex: 'executionMode',
    key: 'executionMode',
    width: 120,
  },
  {
    title: '顺序',
    dataIndex: 'executionOrder',
    key: 'executionOrder',
    width: 70,
  },
  { title: '操作', key: 'actions', width: 80 },
];

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
  try {
    intents.value = await listIntentsApi(id);
  } catch {
    message.error('加载意图列表失败');
  }
}

async function selectIntent(id: null | number | undefined) {
  if (!id) return;
  selectedIntentId.value = id;
  activeTab.value = 'basic';
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
          intents.value = [];
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
  intentForm.value = { autoTransfer: false, skipRag: false, sortOrder: 0 };
  exampleQueriesList.value = [];
  intentDrawerVisible.value = true;
}

function openEditIntent(i: IntentDTO) {
  editingIntent.value = i;
  intentForm.value = { ...i };
  // 解析 JSON 数组字符串为列表
  try {
    const arr = JSON.parse(i.exampleQueries || '[]');
    exampleQueriesList.value = Array.isArray(arr) ? arr : [];
  } catch {
    exampleQueriesList.value = [];
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
  savingIntent.value = true;
  const domainId = selectedDomainId.value;
  if (!domainId) return;
  const data = {
    ...intentForm.value,
    domainId,
    exampleQueries: JSON.stringify(exampleQueriesList.value.filter(Boolean)),
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
        if (selectedIntentId.value === i.id) selectedIntentId.value = null;
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
    <div class="flex h-full min-h-0 gap-4 overflow-hidden">
      <!-- 左侧领域列表 -->
      <Card
        :bordered="false"
        class="w-56 shrink-0 overflow-auto shadow-sm"
        size="small"
      >
        <template #title>领域列表</template>
        <template #extra>
          <Button type="primary" size="small" @click="openCreateDomain">
            + 新建
          </Button>
        </template>
        <div
          v-for="d in domains"
          :key="d.id"
          class="domain-item"
          :class="[{ active: selectedDomainId === d.id }]"
          @click="selectDomain(d.id)"
        >
          <span>{{ d.name }}</span>
          <Space size="small" class="domain-actions">
            <Button type="link" size="small" @click.stop="openEditDomain(d)"
              >编辑</Button
            >
            <Button
              type="link"
              danger
              size="small"
              @click.stop="confirmDeleteDomain(d)"
              >删除</Button
            >
          </Space>
        </div>
      </Card>

      <!-- 右侧详情 -->
      <Card
        :bordered="false"
        class="flex-1 overflow-auto shadow-sm"
        size="small"
      >
        <template #title>
          <span v-if="selectedDomainId">意图列表</span>
          <span v-else>请选择领域</span>
        </template>
        <template v-if="selectedDomainId" #extra>
          <Button size="small" @click="openCreateIntent">+ 新建意图</Button>
        </template>

        <template v-if="selectedDomainId">
          <!-- 意图列表 -->
          <div class="intent-list">
            <div
              v-for="i in intents"
              :key="i.id"
              class="intent-item"
              :class="[{ active: selectedIntentId === i.id }]"
              @click="selectIntent(i.id)"
            >
              <span
                >{{ i.name }}
                <small style="color: #999">({{ i.code }})</small></span
              >
              <Space size="small">
                <Tag v-if="i.autoTransfer" color="orange">转人工</Tag>
                <Tag v-if="i.skipRag" color="blue">跳过RAG</Tag>
                <Button type="link" size="small" @click.stop="openEditIntent(i)"
                  >编辑</Button
                >
                <Button
                  type="link"
                  danger
                  size="small"
                  @click.stop="confirmDeleteIntent(i)"
                  >删除</Button
                >
              </Space>
            </div>
          </div>
        </template>

        <!-- 意图详情 Tabs -->
        <template v-if="selectedIntentId && selectedIntent">
          <Tabs v-model:active-key="activeTab" style="margin-top: 16px">
            <!-- 基本信息 -->
            <TabPane key="basic" tab="基本信息">
              <Descriptions :column="2" bordered size="small">
                <DescriptionsItem label="意图码">
                  {{ selectedIntent.code }}
                </DescriptionsItem>
                <DescriptionsItem label="名称">
                  {{ selectedIntent.name }}
                </DescriptionsItem>
                <DescriptionsItem label="自动转人工">
                  <Tag
                    :color="selectedIntent.autoTransfer ? 'orange' : 'default'"
                  >
                    {{ selectedIntent.autoTransfer ? '是' : '否' }}
                  </Tag>
                </DescriptionsItem>
                <DescriptionsItem label="跳过RAG">
                  <Tag :color="selectedIntent.skipRag ? 'blue' : 'default'">
                    {{ selectedIntent.skipRag ? '是' : '否' }}
                  </Tag>
                </DescriptionsItem>
                <DescriptionsItem label="描述" :span="2">
                  {{ selectedIntent.description }}
                </DescriptionsItem>
                <DescriptionsItem label="示例句子" :span="2">
                  <template v-if="selectedIntentExamples.length">
                    <Space wrap>
                      <Tag
                        v-for="(ex, idx) in selectedIntentExamples"
                        :key="idx"
                        color="blue"
                      >
                        {{ ex }}
                      </Tag>
                    </Space>
                  </template>
                  <span v-else>-</span>
                </DescriptionsItem>
              </Descriptions>
            </TabPane>

            <!-- 槽位配置 -->
            <TabPane key="slots" tab="槽位配置">
              <Button
                size="small"
                style="margin-bottom: 8px"
                @click="openCreateSlot"
              >
                + 添加槽位
              </Button>
              <Table
                :data-source="slots"
                :columns="slotColumns"
                size="small"
                :pagination="false"
                row-key="id"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'required'">
                    <Tag :color="record.required ? 'error' : 'default'">
                      {{ record.required ? '必填' : '可选' }}
                    </Tag>
                  </template>
                  <template v-if="column.key === 'resolveStrategy'">
                    <Space wrap>
                      <Tag
                        v-for="(s, idx) in parseResolveStrategy(
                          record.resolveStrategy,
                        )"
                        :key="idx"
                        color="purple"
                      >
                        {{ s }}
                      </Tag>
                    </Space>
                  </template>
                  <template v-if="column.key === 'actions'">
                    <Space>
                      <Button
                        type="link"
                        size="small"
                        @click="openEditSlot(record as SlotDTO)"
                        >编辑</Button
                      >
                      <Button
                        type="link"
                        danger
                        size="small"
                        @click="confirmDeleteSlot(record as SlotDTO)"
                        >删除</Button
                      >
                    </Space>
                  </template>
                </template>
              </Table>
            </TabPane>

            <!-- 工具绑定 -->
            <TabPane key="tools" tab="工具绑定">
              <Button
                size="small"
                style="margin-bottom: 8px"
                @click="openCreateBinding"
              >
                + 绑定工具
              </Button>
              <Table
                :data-source="bindings"
                :columns="bindingColumns"
                size="small"
                :pagination="false"
                row-key="id"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'toolId'">
                    {{ toolName(record.toolId) }}
                  </template>
                  <template v-if="column.key === 'executionMode'">
                    <Tag
                      :color="
                        record.executionMode === 'REQUIRED'
                          ? 'error'
                          : 'processing'
                      "
                    >
                      {{ record.executionMode }}
                    </Tag>
                  </template>
                  <template v-if="column.key === 'actions'">
                    <Button
                      type="link"
                      danger
                      size="small"
                      @click="confirmDeleteBinding(record as BindingDTO)"
                      >解除</Button
                    >
                  </template>
                </template>
              </Table>
            </TabPane>
          </Tabs>
        </template>
      </Card>
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

<style scoped>
.domain-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.domain-item:hover,
.domain-item.active {
  background: #e6f7ff;
}

.domain-actions {
  opacity: 0;
  transition: opacity 0.15s;
}

.domain-item:hover .domain-actions {
  opacity: 1;
}

.intent-list {
  margin-bottom: 16px;
}

.intent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 4px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s;
}

.intent-item:hover,
.intent-item.active {
  background: #f0f5ff;
}
</style>
