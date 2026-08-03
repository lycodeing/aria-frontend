<script lang="ts" setup>
import type { OnlineAgentItem } from '#/api/session/index';
import type { SlaPolicyVO } from '#/api/sla/index';

import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Checkbox,
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
} from 'ant-design-vue';

import { getOnlineAgentsApi } from '#/api/session/index';
import {
  createSlaPolicyApi,
  deleteSlaPolicyApi,
  listSlaPoliciesApi,
  updateSlaPolicyApi,
} from '#/api/sla/index';

// ===== 列表状态 =====
const list = ref<SlaPolicyVO[]>([]);
const loading = ref(false);

async function loadList() {
  loading.value = true;
  try {
    list.value = (await listSlaPoliciesApi()) ?? [];
  } catch {
    message.error('加载列表失败');
  } finally {
    loading.value = false;
  }
}

// ===== 在线座席（用于升级目标下拉） =====
const onlineAgents = ref<OnlineAgentItem[]>([]);

async function loadOnlineAgents() {
  try {
    onlineAgents.value = (await getOnlineAgentsApi()) ?? [];
  } catch {
    // 静默失败，保留上次结果
  }
}

// ===== 新增/编辑弹窗 =====
const modalOpen = ref(false);
const editingId = ref<null | number | string>(null);
const submitting = ref(false);

function emptyForm(): Omit<SlaPolicyVO, 'id'> {
  return {
    name: '',
    isEnabled: true,
    priority: 0,
    timeMode: 'CALENDAR',
    waitTimeTargetSec: 120,
    frtTargetSec: 60,
    handleTimeTargetSec: 1800,
    warningThresholdPct: 80,
    matchVisitorTags: [],
    matchTransferTags: [],
    actions: {
      recordBreachOnly: true,
      sseAlert: true,
      autoEscalate: false,
      escalateToUserId: undefined,
    },
  };
}

const form = reactive<Omit<SlaPolicyVO, 'id'>>(emptyForm());

function openCreate() {
  editingId.value = null;
  const blank = emptyForm();
  Object.assign(form, blank);
  form.actions = { ...blank.actions };
  form.matchVisitorTags = [];
  form.matchTransferTags = [];
  modalOpen.value = true;
  loadOnlineAgents();
}

function openEdit(row: SlaPolicyVO) {
  editingId.value = row.id;
  const { id: _id, ...rest } = row;
  Object.assign(form, {
    ...rest,
    matchVisitorTags: [...(rest.matchVisitorTags ?? [])],
    matchTransferTags: [...(rest.matchTransferTags ?? [])],
    actions: { ...rest.actions },
  });
  modalOpen.value = true;
  loadOnlineAgents();
}

async function submit() {
  if (!form.name?.trim()) {
    message.warning('请填写策略名称');
    return;
  }
  submitting.value = true;
  try {
    if (editingId.value === null) {
      await createSlaPolicyApi(form);
      message.success('创建成功');
    } else {
      await updateSlaPolicyApi(editingId.value, form);
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
function confirmDelete(row: SlaPolicyVO) {
  Modal.confirm({
    title: `确认删除「${row.name}」？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    async onOk() {
      try {
        await deleteSlaPolicyApi(row.id);
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

// ===== 表格列定义 =====
const columns = [
  { title: '策略名称', dataIndex: 'name', key: 'name' },
  { title: '优先级', dataIndex: 'priority', key: 'priority', width: 80 },
  {
    title: '等待超时(s)',
    dataIndex: 'waitTimeTargetSec',
    key: 'waitTimeTargetSec',
    width: 110,
  },
  {
    title: '首响超时(s)',
    dataIndex: 'frtTargetSec',
    key: 'frtTargetSec',
    width: 110,
  },
  {
    title: '处理超时(s)',
    dataIndex: 'handleTimeTargetSec',
    key: 'handleTimeTargetSec',
    width: 110,
  },
  { title: '匹配条件', key: 'matchConditions', width: 200 },
  { title: '状态', key: 'status', width: 80 },
  { title: '操作', key: 'action', width: 160 },
];
</script>

<template>
  <Page>
    <template #extra>
      <Button type="primary" @click="openCreate">+ 新增策略</Button>
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
        <template v-if="column.key === 'matchConditions'">
          <Space :size="4" wrap>
            <Tag
              v-for="t in (record as SlaPolicyVO).matchVisitorTags"
              :key="t"
              color="blue"
            >
              {{ t }}
            </Tag>
            <Tag
              v-for="t in (record as SlaPolicyVO).matchTransferTags"
              :key="t"
              color="purple"
            >
              {{ t }}
            </Tag>
            <span
              v-if="
                !(record as SlaPolicyVO).matchVisitorTags?.length &&
                !(record as SlaPolicyVO).matchTransferTags?.length
              "
              style="font-size: 12px; color: #aaa"
            >
              全部
            </span>
          </Space>
        </template>

        <template v-else-if="column.key === 'status'">
          <Tag :color="(record as SlaPolicyVO).isEnabled ? 'green' : 'default'">
            {{ (record as SlaPolicyVO).isEnabled ? '启用' : '禁用' }}
          </Tag>
        </template>

        <template v-else-if="column.key === 'action'">
          <Space>
            <Button size="small" @click="openEdit(record as SlaPolicyVO)">
              编辑
            </Button>
            <Button
              size="small"
              danger
              @click="confirmDelete(record as SlaPolicyVO)"
            >
              删除
            </Button>
          </Space>
        </template>
      </template>
    </Table>

    <!-- 新增 / 编辑弹窗 -->
    <Modal
      v-model:open="modalOpen"
      :title="editingId !== null ? '编辑 SLA 策略' : '新增 SLA 策略'"
      :confirm-loading="submitting"
      width="600px"
      @ok="submit"
    >
      <Form layout="vertical" style="margin-top: 16px" :model="form">
        <!-- 策略名称 -->
        <FormItem
          label="策略名称"
          name="name"
          :rules="[{ required: true, message: '请输入策略名称' }]"
        >
          <Input
            v-model:value="form.name"
            placeholder="如：VIP客户优先级策略"
          />
        </FormItem>

        <div style="display: flex; gap: 12px">
          <!-- 优先级 -->
          <FormItem label="优先级" style="flex: 1">
            <InputNumber
              v-model:value="form.priority"
              :min="0"
              :max="9999"
              style="width: 100%"
            />
          </FormItem>
          <!-- 是否启用 -->
          <FormItem label="是否启用" style="flex: 1">
            <Switch
              v-model:checked="form.isEnabled"
              checked-children="启用"
              un-checked-children="禁用"
            />
          </FormItem>
        </div>

        <!-- 时间计算模式 -->
        <FormItem label="时间计算模式">
          <Select v-model:value="form.timeMode" style="width: 100%">
            <SelectOption value="CALENDAR">日历时间</SelectOption>
            <SelectOption value="BUSINESS_HOURS">业务时间</SelectOption>
          </Select>
        </FormItem>

        <!-- 超时设置三列 -->
        <div style="display: flex; gap: 12px">
          <FormItem label="等待超时(秒)" style="flex: 1">
            <InputNumber
              v-model:value="form.waitTimeTargetSec"
              :min="1"
              style="width: 100%"
            />
          </FormItem>
          <FormItem label="首响超时(秒)" style="flex: 1">
            <InputNumber
              v-model:value="form.frtTargetSec"
              :min="1"
              style="width: 100%"
            />
          </FormItem>
          <FormItem label="处理超时(秒)" style="flex: 1">
            <InputNumber
              v-model:value="form.handleTimeTargetSec"
              :min="1"
              style="width: 100%"
            />
          </FormItem>
        </div>

        <!-- 预警百分比 -->
        <FormItem label="预警阈值%">
          <InputNumber
            v-model:value="form.warningThresholdPct"
            :min="0"
            :max="100"
            style="width: 160px"
          />
        </FormItem>

        <!-- 匹配访客标签 -->
        <FormItem label="匹配访客标签" help="留空表示匹配所有访客">
          <Select
            v-model:value="form.matchVisitorTags"
            mode="tags"
            style="width: 100%"
            placeholder="输入标签后按回车确认"
            :token-separators="[',']"
          />
        </FormItem>

        <!-- 匹配转人工原因 -->
        <FormItem label="匹配转人工原因" help="留空表示匹配所有转人工原因">
          <Select
            v-model:value="form.matchTransferTags"
            mode="tags"
            style="width: 100%"
            placeholder="输入原因后按回车确认"
            :token-separators="[',']"
          />
        </FormItem>

        <!-- 违规行为 -->
        <div
          style="
            padding: 12px 16px;
            margin-bottom: 16px;
            border: 1px solid #f0f0f0;
            border-radius: 6px;
          "
        >
          <div style="margin-bottom: 12px; font-weight: 500; color: #333">
            违规行为
          </div>

          <!-- SSE 实时告警 -->
          <FormItem label="SSE 实时告警" style="margin-bottom: 8px">
            <Checkbox v-model:checked="form.actions.sseAlert">
              触发违规时推送 SSE 事件通知座席端
            </Checkbox>
          </FormItem>

          <!-- 自动升级 -->
          <FormItem label="自动升级" style="margin-bottom: 8px">
            <Switch
              v-model:checked="form.actions.autoEscalate"
              checked-children="开"
              un-checked-children="关"
            />
          </FormItem>

          <!-- 升级目标坐席（autoEscalate 开启时显示） -->
          <FormItem
            v-if="form.actions.autoEscalate"
            label="升级目标坐席"
            style="margin-bottom: 8px"
          >
            <Select
              v-model:value="form.actions.escalateToUserId"
              style="width: 100%"
              placeholder="选择在线座席"
              allow-clear
            >
              <SelectOption
                v-for="agent in onlineAgents"
                :key="agent.id"
                :value="agent.id"
              >
                {{ agent.name }}
                <span style="font-size: 12px; color: #aaa">
                  （{{ agent.sessions }} 个会话）
                </span>
              </SelectOption>
            </Select>
          </FormItem>

          <!-- 违规通知：由 Webhook 配置的事件范围自动匹配 -->
          <div style="font-size: 13px; color: #999">
            违规通知按 Webhook 配置的事件范围自动匹配
          </div>
        </div>
      </Form>
    </Modal>
  </Page>
</template>
