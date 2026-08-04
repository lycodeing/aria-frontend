<script lang="ts" setup>
import type { WebhookVO } from '#/api/webhook/index';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
  Form,
  FormItem,
  Input,
  message,
  Modal,
  Select,
  SelectOption,
  Switch,
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

// ===== 筛选 =====
const keyword = ref('');
const typeFilter = ref<'all' | WebhookVO['type']>('all');
const statusFilter = ref<'all' | 'off' | 'on'>('all');
const copiedId = ref<null | number | string>(null);

const typeFilters = [
  { key: 'all', label: '全部' },
  { key: 'FEISHU', label: '飞书' },
  { key: 'DINGTALK', label: '钉钉' },
  { key: 'WECOM', label: '企微' },
  { key: 'CUSTOM', label: '自定义' },
] as const;

const statusFilters = [
  { key: 'all', label: '全部状态' },
  { key: 'on', label: '启用' },
  { key: 'off', label: '禁用' },
] as const;

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return list.value.filter((item) => {
    const okKw =
      !kw ||
      item.name.toLowerCase().includes(kw) ||
      item.url.toLowerCase().includes(kw);
    const okType = typeFilter.value === 'all' || item.type === typeFilter.value;
    const okStatus =
      statusFilter.value === 'all' ||
      (item.isEnabled === 1 ? 'on' : 'off') === statusFilter.value;
    return okKw && okType && okStatus;
  });
});

function resetFilter() {
  keyword.value = '';
  typeFilter.value = 'all';
  statusFilter.value = 'all';
}

async function copyUrl(row: WebhookVO) {
  try {
    await navigator.clipboard.writeText(row.url);
    copiedId.value = row.id;
    message.success('已复制 URL');
    setTimeout(() => {
      if (copiedId.value === row.id) copiedId.value = null;
    }, 1500);
  } catch {
    message.error('复制失败');
  }
}

// ===== 统计概览 =====
const stats = computed(() => {
  const total = list.value.length;
  const enabled = list.value.filter((i) => i.isEnabled === 1).length;
  const types = new Set<string>();
  list.value.forEach((i) => (i.scopes ?? []).forEach((s) => types.add(s)));
  return {
    total,
    enabled,
    disabled: total - enabled,
    eventTypes: types.size,
  };
});

const statCards = computed(() => [
  {
    key: 'total',
    label: 'Webhook 总数',
    value: stats.value.total,
    icon: 'lucide:webhook',
    iconBg: 'bg-blue-50 dark:bg-blue-500/15',
    iconColor: 'text-blue-500',
  },
  {
    key: 'enabled',
    label: '已启用',
    value: stats.value.enabled,
    icon: 'lucide:check-circle-2',
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/15',
    iconColor: 'text-emerald-500',
  },
  {
    key: 'disabled',
    label: '已禁用',
    value: stats.value.disabled,
    icon: 'lucide:pause-circle',
    iconBg: 'bg-slate-100 dark:bg-slate-600/40',
    iconColor: 'text-slate-400',
  },
  {
    key: 'events',
    label: '订阅事件类型',
    value: stats.value.eventTypes,
    icon: 'lucide:list-filter',
    iconBg: 'bg-violet-50 dark:bg-violet-500/15',
    iconColor: 'text-violet-500',
  },
]);

// ===== 类型元信息（品牌色 + 图标 + 副标题）=====
const typeMeta: Record<
  WebhookVO['type'],
  { brand: string; icon: string; label: string; sub: string }
> = {
  FEISHU: {
    label: '飞书',
    brand: '#3370ff',
    icon: 'lucide:fish',
    sub: '飞书 · 签名校验',
  },
  DINGTALK: {
    label: '钉钉',
    brand: '#0089ff',
    icon: 'lucide:send',
    sub: '钉钉 · 加签',
  },
  WECOM: {
    label: '企业微信',
    brand: '#07c160',
    icon: 'lucide:message-circle',
    sub: '企业微信',
  },
  CUSTOM: {
    label: '自定义',
    brand: '#8b5cf6',
    icon: 'lucide:braces',
    sub: '自定义 · 自定义请求头',
  },
};

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
  scopes: string[];
}

const emptyForm = (): FormState => ({
  name: '',
  type: 'FEISHU',
  url: '',
  secret: '',
  customHeadersJson: '{}',
  messageTemplate: '',
  isEnabled: true,
  scopes: ['SLA_BREACH'], // 默认只订阅 SLA 违规，与后端默认一致
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
    scopes: row.scopes ?? ['SLA_BREACH'],
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
    scopes: form.scopes,
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
  if (form.scopes.length === 0) {
    // 空数组 = 不订阅任何事件，后端允许保存；仅提示、不阻断
    message.warning(
      '未选择任何事件范围，该 Webhook 不会收到任何推送（如需保存请继续）',
    );
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

// ===== 事件范围 =====
// 事件范围选项（值=后端枚举名，label=展示名）
const scopeOptions = [
  { value: 'SLA_BREACH', label: 'SLA违规告警' },
  { value: 'SESSION_CREATED', label: '新会话' },
  { value: 'SESSION_TRANSFERRED', label: '转人工' },
  { value: 'SESSION_CLOSED', label: '会话关闭' },
  { value: 'CSAT_RATED', label: '客户评价' },
];

const scopeLabelMap: Record<string, string> = {
  SLA_BREACH: 'SLA违规',
  SESSION_CREATED: '新会话',
  SESSION_TRANSFERRED: '转人工',
  SESSION_CLOSED: '会话关闭',
  CSAT_RATED: '客户评价',
};

onMounted(loadList);
</script>

<template>
  <Page>
    <template #extra>
      <Button type="primary" @click="openCreate">＋ 新增 Webhook</Button>
    </template>

    <!-- 统计概览 -->
    <div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div
        v-for="s in statCards"
        :key="s.key"
        class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-lg"
          :class="s.iconBg"
        >
          <Icon :icon="s.icon" class="text-[18px]" :class="s.iconColor" />
        </div>
        <div class="min-w-0">
          <div
            class="text-[20px] font-bold leading-tight text-slate-800 dark:text-slate-100"
          >
            {{ s.value }}
          </div>
          <div class="text-[12px] text-slate-500 dark:text-slate-400">
            {{ s.label }}
          </div>
        </div>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div
        class="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
      >
        <Icon icon="lucide:search" class="shrink-0" />
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索名称 / URL"
          class="h-full w-full bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
        />
      </div>
      <div
        class="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-700"
      >
        <button
          v-for="t in typeFilters"
          :key="t.key"
          type="button"
          class="h-7 rounded-md px-3 text-[12px] font-medium transition-colors"
          :class="
            typeFilter === t.key
              ? 'bg-white text-blue-500 shadow-sm dark:bg-slate-600 dark:text-blue-300'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="typeFilter = t.key"
        >
          {{ t.label }}
        </button>
      </div>
      <div
        class="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-700"
      >
        <button
          v-for="s in statusFilters"
          :key="s.key"
          type="button"
          class="h-7 rounded-md px-3 text-[12px] font-medium transition-colors"
          :class="
            statusFilter === s.key
              ? 'bg-white text-blue-500 shadow-sm dark:bg-slate-600 dark:text-blue-300'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          "
          @click="statusFilter = s.key"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div
      v-if="loading && list.length === 0"
      class="flex justify-center py-16 text-slate-400"
    >
      <Icon icon="lucide:loader-2" class="animate-spin text-[24px]" />
    </div>

    <!-- 卡片网格 -->
    <div
      v-else-if="filteredList.length"
      class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      <div
        v-for="item in filteredList"
        :key="item.id"
        class="group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-700 dark:bg-slate-800"
      >
        <!-- 左侧品牌色条 -->
        <div
          class="absolute left-0 top-0 bottom-0 w-1"
          :style="{ background: typeMeta[item.type]?.brand }"
        ></div>

        <!-- 头部 -->
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
            :style="{ background: typeMeta[item.type]?.brand }"
          >
            <Icon
              :icon="typeMeta[item.type]?.icon ?? 'lucide:webhook'"
              class="text-[18px]"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="
                  item.isEnabled === 1
                    ? 'bg-emerald-500'
                    : 'bg-slate-300 dark:bg-slate-600'
                "
              ></span>
              <span
                class="truncate text-[14.5px] font-semibold text-slate-800 dark:text-slate-100"
              >
                {{ item.name }}
              </span>
            </div>
            <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {{ typeMeta[item.type]?.sub ?? item.type }}
            </div>
          </div>
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            :class="
              item.isEnabled === 1
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
            "
          >
            {{ item.isEnabled === 1 ? '启用' : '禁用' }}
          </span>
        </div>

        <!-- URL -->
        <div
          class="mt-3 flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-700/40"
        >
          <Icon icon="lucide:link" class="shrink-0 text-slate-400" />
          <span
            class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-slate-600 dark:text-slate-300"
          >
            {{ item.url }}
          </span>
          <button
            type="button"
            :title="copiedId === item.id ? '已复制' : '复制 URL'"
            class="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/15"
            @click="copyUrl(item)"
          >
            <Icon
              :icon="copiedId === item.id ? 'lucide:check' : 'lucide:copy'"
              class="text-[13px]"
            />
          </button>
        </div>

        <!-- 事件范围 -->
        <div class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-for="sc in item.scopes ?? []"
            :key="sc"
            class="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
          >
            {{ scopeLabelMap[sc] ?? sc }}
          </span>
          <span
            v-if="!(item.scopes ?? []).length"
            class="text-[11.5px] text-slate-400"
            >未订阅任何事件</span
          >
        </div>

        <!-- 操作 -->
        <div
          class="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700"
        >
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-[12.5px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            @click="openEdit(item)"
          >
            <Icon icon="lucide:pencil" class="text-[13px]" /> 编辑
          </button>
          <button
            type="button"
            :disabled="testingId === item.id"
            class="flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-[12.5px] font-medium text-sky-600 transition-colors hover:border-sky-200 hover:bg-sky-50 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-sky-500/15"
            :class="
              testingId === item.id
                ? 'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10'
                : 'border-slate-200 dark:border-slate-600'
            "
            @click="testWebhook(item)"
          >
            <Icon
              :icon="testingId === item.id ? 'lucide:loader-2' : 'lucide:zap'"
              class="text-[13px]"
              :class="{ 'animate-spin': testingId === item.id }"
            />
            测试
          </button>
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-[12.5px] font-medium text-rose-600 transition-colors hover:border-rose-200 hover:bg-rose-50 dark:border-slate-600 dark:text-rose-400 dark:hover:bg-rose-500/15"
            @click="confirmDelete(item)"
          >
            <Icon icon="lucide:trash-2" class="text-[13px]" /> 删除
          </button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-else
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-5 py-16 text-center dark:border-slate-700 dark:bg-slate-800"
    >
      <div
        class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-500 dark:bg-blue-500/15"
      >
        <Icon icon="lucide:webhook" class="text-[26px]" />
      </div>
      <h3 class="text-[15px] font-semibold text-slate-700 dark:text-slate-200">
        {{ list.length === 0 ? '还没有任何 Webhook' : '没有匹配的 Webhook' }}
      </h3>
      <p
        class="mt-1.5 max-w-[320px] text-[13px] text-slate-500 dark:text-slate-400"
      >
        {{
          list.length === 0
            ? '添加第一个通知配置，把客服事件实时推送到你常用的协作工具。'
            : '试着调整搜索关键词或筛选条件。'
        }}
      </p>
      <Button
        v-if="list.length === 0"
        type="primary"
        class="mt-4"
        @click="openCreate"
        >＋ 新增 Webhook</Button
      >
      <Button v-else class="mt-4" @click="resetFilter">清空筛选</Button>
    </div>

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
        <FormItem label="事件范围" required>
          <Select
            v-model:value="form.scopes"
            mode="multiple"
            style="width: 100%"
            placeholder="请选择订阅的事件范围"
          >
            <SelectOption
              v-for="opt in scopeOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </SelectOption>
          </Select>
          <div
            style="margin-top: 4px; font-size: 12px; color: rgb(0 0 0 / 45%)"
          >
            选择该 Webhook 订阅的事件，未选择任何事件将不会收到推送
          </div>
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
