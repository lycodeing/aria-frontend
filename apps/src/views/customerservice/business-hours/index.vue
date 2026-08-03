<script lang="ts" setup>
import type {
  HolidayItem,
  ScheduleItem,
  TimeRange,
} from '#/api/business-hours';

import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Badge,
  Button,
  Form,
  FormItem,
  Input,
  message,
  Modal,
  RadioButton,
  RadioGroup,
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
  createHolidayApi,
  deleteHolidayApi,
  getOfflineReplyApi,
  getScheduleApi,
  listHolidaysApi,
  syncHolidaysApi,
  updateHolidayApi,
  updateOfflineReplyApi,
  updateScheduleApi,
} from '#/api/business-hours';

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOUR_MARKS = [0, 6, 12, 18, 24];

// 时间字符串转小时数（"09:30" -> 9.5）
function timeToHours(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
}

// ===== tab =====
const activeTab = ref('schedule');

// ===== 排班 =====
const scheduleList = ref<ScheduleItem[]>([]);
const scheduleLoading = ref(false);
const scheduleSaving = ref(false);
// 排班视图模式：grid 网格视图 / table 表格视图
const scheduleViewMode = ref<'grid' | 'table'>('grid');

// Edit-schedule modal
const scheduleModalOpen = ref(false);
const editingSchedule = ref<null | ScheduleItem>(null);
const editRanges = ref<TimeRange[]>([]);

async function loadSchedule() {
  scheduleLoading.value = true;
  try {
    scheduleList.value = await getScheduleApi();
  } catch {
    message.error('加载排班失败');
  } finally {
    scheduleLoading.value = false;
  }
}

async function saveSchedule() {
  scheduleSaving.value = true;
  try {
    await updateScheduleApi(scheduleList.value);
    message.success('排班已保存');
  } catch {
    message.error('保存失败');
  } finally {
    scheduleSaving.value = false;
  }
}

function openScheduleEdit(row: ScheduleItem) {
  editingSchedule.value = row;
  editRanges.value = row.timeRanges.map((r) => ({ ...r }));
  scheduleModalOpen.value = true;
}

function addRange() {
  editRanges.value.push({ start: '09:00', end: '18:00' });
}

function removeRange(index: number) {
  editRanges.value.splice(index, 1);
}

function confirmScheduleEdit() {
  if (editingSchedule.value) {
    editingSchedule.value.timeRanges = editRanges.value.map((r) => ({ ...r }));
  }
  scheduleModalOpen.value = false;
}

const scheduleColumns = [
  { title: '星期', key: 'day', width: 80 },
  { title: '状态', key: 'status', width: 100 },
  { title: '服务时段', key: 'timeRanges' },
  { title: '操作', key: 'action', width: 100 },
];

// ===== 营业状态 =====
// 定时刷新当前时间，保证 computed 能响应
const now = ref(new Date());
let nowTimer: number | undefined;

const currentTimeStr = computed(() => {
  const n = now.value;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
});

// 营业状态：根据当前时间与今日排班计算
const businessStatus = computed(() => {
  const n = now.value;
  const dayOfWeek = n.getDay() === 0 ? 7 : n.getDay();
  const today = scheduleList.value.find((s) => s.dayOfWeek === dayOfWeek);
  if (!today || !today.isOpen) return { open: false, timeRanges: [] };
  const currentHours = n.getHours() + n.getMinutes() / 60;
  const inRange = today.timeRanges.some((r) => {
    const start = timeToHours(r.start);
    const end = timeToHours(r.end);
    return currentHours >= start && currentHours <= end;
  });
  return { open: inRange, timeRanges: today.timeRanges };
});

// ===== 节假日 =====
const holidayList = ref<HolidayItem[]>([]);
const holidayLoading = ref(false);
const holidaySyncing = ref(false);
const holidayModalOpen = ref(false);
const editingHolidayId = ref<null | number | string>(null);
const holidaySubmitting = ref(false);

const emptyHolidayForm = (): Omit<HolidayItem, 'id' | 'source'> => ({
  date: '',
  type: 'CLOSED',
  timeRanges: [],
  remark: '',
});

const holidayForm =
  reactive<Omit<HolidayItem, 'id' | 'source'>>(emptyHolidayForm());

async function loadHolidays() {
  holidayLoading.value = true;
  try {
    holidayList.value = await listHolidaysApi();
  } catch {
    message.error('加载节假日失败');
  } finally {
    holidayLoading.value = false;
  }
}

async function syncHolidays() {
  holidaySyncing.value = true;
  try {
    const n = await syncHolidaysApi();
    message.success(`同步完成，写入 ${n} 条`);
    await loadHolidays();
  } catch {
    message.error('同步失败');
  } finally {
    holidaySyncing.value = false;
  }
}

function openCreateHoliday() {
  editingHolidayId.value = null;
  Object.assign(holidayForm, emptyHolidayForm());
  holidayModalOpen.value = true;
}

function openEditHoliday(row: HolidayItem) {
  editingHolidayId.value = row.id;
  Object.assign(holidayForm, {
    date: row.date,
    type: row.type,
    timeRanges: (row.timeRanges ?? []).map((r) => ({ ...r })),
    remark: row.remark ?? '',
  });
  holidayModalOpen.value = true;
}

function addHolidayRange() {
  if (!holidayForm.timeRanges) holidayForm.timeRanges = [];
  holidayForm.timeRanges.push({ start: '09:00', end: '18:00' });
}

function removeHolidayRange(index: number) {
  holidayForm.timeRanges?.splice(index, 1);
}

async function submitHoliday() {
  if (!holidayForm.date) {
    message.warning('请选择日期');
    return;
  }
  holidaySubmitting.value = true;
  try {
    const payload = { ...holidayForm };
    if (payload.type === 'CLOSED') payload.timeRanges = [];
    if (editingHolidayId.value === null) {
      await createHolidayApi(payload);
      message.success('新增成功');
    } else {
      await updateHolidayApi(editingHolidayId.value, payload);
      message.success('更新成功');
    }
    holidayModalOpen.value = false;
    await loadHolidays();
  } catch {
    message.error('操作失败');
  } finally {
    holidaySubmitting.value = false;
  }
}

function confirmDeleteHoliday(row: HolidayItem) {
  Modal.confirm({
    title: `确认删除 ${row.date} 的记录？`,
    okType: 'danger',
    async onOk() {
      try {
        await deleteHolidayApi(row.id);
        message.success('已删除');
        await loadHolidays();
      } catch {
        message.error('删除失败');
      }
    },
  });
}

const holidayColumns = [
  { title: '日期', dataIndex: 'date', key: 'date', width: 130 },
  { title: '类型', key: 'type', width: 100 },
  { title: '备注', dataIndex: 'remark', key: 'remark' },
  { title: '来源', key: 'source', width: 80 },
  { title: '操作', key: 'action', width: 140 },
];

// ===== 离线回复 =====
const offlineMsg = ref('');
const offlineLoading = ref(false);
const offlineSaving = ref(false);
// Textarea 组件 ref，用于操作光标位置
const offlineTextareaRef = ref<any>(null);
const offlineVariables = ['{nextOpenTime}', '{visitorName}'];

async function loadOfflineReply() {
  offlineLoading.value = true;
  try {
    offlineMsg.value = await getOfflineReplyApi();
  } catch {
    message.error('加载离线回复失败');
  } finally {
    offlineLoading.value = false;
  }
}

async function saveOfflineReply() {
  offlineSaving.value = true;
  try {
    await updateOfflineReplyApi(offlineMsg.value);
    message.success('离线回复已保存');
  } catch {
    message.error('保存失败');
  } finally {
    offlineSaving.value = false;
  }
}

// 将变量文本插入到 Textarea 光标位置（无光标时追加到末尾）
function insertVariable(variable: string) {
  const inst = offlineTextareaRef.value as any;
  const textarea: HTMLTextAreaElement | undefined =
    inst?.resizableTextArea?.textArea ?? inst?.input ?? undefined;
  const msg = offlineMsg.value || '';
  if (!textarea) {
    offlineMsg.value = msg + variable;
    return;
  }
  const start = textarea.selectionStart ?? msg.length;
  const end = textarea.selectionEnd ?? msg.length;
  offlineMsg.value = msg.slice(0, start) + variable + msg.slice(end);
  nextTick(() => {
    const newPos = start + variable.length;
    textarea.focus();
    textarea.setSelectionRange(newPos, newPos);
  });
}

onMounted(() => {
  loadSchedule();
  loadHolidays();
  loadOfflineReply();
  // 每 30 秒刷新当前时间，驱动营业状态横幅更新
  nowTimer = window.setInterval(() => {
    now.value = new Date();
  }, 30_000);
});

onUnmounted(() => {
  if (nowTimer) window.clearInterval(nowTimer);
});
</script>

<template>
  <Page>
    <!-- 营业状态横幅 -->
    <div
      class="mb-4 overflow-hidden rounded-lg p-4 text-white shadow-sm"
      :class="
        businessStatus.open
          ? 'bg-gradient-to-r from-green-500 to-emerald-600'
          : 'bg-gradient-to-r from-orange-500 to-red-500'
      "
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2 text-lg font-semibold">
            <span
              class="inline-block h-2.5 w-2.5 rounded-full bg-white"
              :class="businessStatus.open ? 'animate-pulse' : ''"
            ></span>
            {{ businessStatus.open ? '营业中' : '非营业时间' }}
          </div>
          <div class="mt-1 text-sm opacity-90">
            当前时间 {{ currentTimeStr }}
          </div>
        </div>
        <div class="text-right">
          <div class="text-sm opacity-90">今日服务时段</div>
          <div class="mt-1 text-sm">
            <span v-if="businessStatus.timeRanges.length === 0">—</span>
            <span v-else>
              {{
                businessStatus.timeRanges
                  .map((r) => `${r.start}-${r.end}`)
                  .join(' / ')
              }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <Tabs v-model:active-key="activeTab">
      <TabPane key="schedule" tab="每周排班">
        <div class="mb-3 flex items-center justify-between" style="gap: 8px">
          <RadioGroup
            v-model:value="scheduleViewMode"
            button-style="solid"
            size="small"
          >
            <RadioButton value="grid">网格视图</RadioButton>
            <RadioButton value="table">表格视图</RadioButton>
          </RadioGroup>
          <Button
            type="primary"
            :loading="scheduleSaving"
            @click="saveSchedule"
          >
            保存排班
          </Button>
        </div>

        <!-- 网格视图 -->
        <Spin v-if="scheduleViewMode === 'grid'" :spinning="scheduleLoading">
          <div class="overflow-hidden rounded border border-gray-200 bg-white">
            <!-- 顶部小时刻度 -->
            <div class="flex border-b border-gray-200 bg-gray-50">
              <div class="w-32 shrink-0 border-r border-gray-200 p-2"></div>
              <div class="relative h-7 flex-1">
                <span
                  v-for="h in HOUR_MARKS"
                  :key="h"
                  class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-xs text-gray-500"
                  :style="{ left: `${(h / 24) * 100}%` }"
                >
                  {{ String(h).padStart(2, '0') }}:00
                </span>
              </div>
              <div class="w-24 shrink-0 border-l border-gray-200"></div>
            </div>

            <!-- 每日时间轴 -->
            <div
              v-for="item in scheduleList"
              :key="item.dayOfWeek"
              class="flex border-b border-gray-200 last:border-b-0"
            >
              <!-- 星期 + 开关 -->
              <div
                class="flex w-32 shrink-0 flex-col items-center justify-center gap-1 border-r border-gray-200 p-2"
              >
                <span class="text-sm font-medium">{{
                  DAY_NAMES[(item as ScheduleItem).dayOfWeek - 1]
                }}</span>
                <Switch
                  v-model:checked="(item as ScheduleItem).isOpen"
                  size="small"
                  checked-children="班"
                  un-checked-children="休"
                />
              </div>
              <!-- 时间网格 -->
              <div class="relative h-12 flex-1">
                <!-- 小时网格线 -->
                <div class="absolute inset-0 flex">
                  <div
                    v-for="h in 24"
                    :key="h"
                    class="flex-1 border-r border-gray-100 last:border-r-0"
                  ></div>
                </div>
                <!-- 上班日：绿色时段条 -->
                <template v-if="(item as ScheduleItem).isOpen">
                  <div
                    v-for="(r, i) in (item as ScheduleItem).timeRanges"
                    :key="i"
                    class="absolute top-1 bottom-1 flex items-center justify-center overflow-hidden rounded bg-green-500/85 text-xs text-white whitespace-nowrap"
                    :style="{
                      left: `${(timeToHours(r.start) / 24) * 100}%`,
                      width: `${
                        ((timeToHours(r.end) - timeToHours(r.start)) / 24) * 100
                      }%`,
                    }"
                  >
                    {{ r.start }}-{{ r.end }}
                  </div>
                  <div
                    v-if="(item as ScheduleItem).timeRanges.length === 0"
                    class="absolute inset-1 flex items-center justify-center rounded bg-green-100 text-xs text-green-700"
                  >
                    全天
                  </div>
                </template>
                <!-- 休息日：红色背景 -->
                <template v-else>
                  <div
                    class="absolute inset-1 flex items-center justify-center rounded bg-red-100 text-xs text-red-600"
                  >
                    休息
                  </div>
                </template>
              </div>
              <!-- 操作 -->
              <div
                class="flex w-24 shrink-0 items-center justify-center border-l border-gray-200 p-2"
              >
                <Button
                  size="small"
                  @click="openScheduleEdit(item as ScheduleItem)"
                >
                  编辑时段
                </Button>
              </div>
            </div>
          </div>
        </Spin>

        <!-- 表格视图 -->
        <Table
          v-else
          :columns="scheduleColumns"
          :data-source="scheduleList"
          :loading="scheduleLoading"
          :pagination="false"
          row-key="dayOfWeek"
          bordered
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'day'">
              {{ DAY_NAMES[(record as ScheduleItem).dayOfWeek - 1] }}
            </template>
            <template v-else-if="column.key === 'status'">
              <Switch
                v-model:checked="(record as ScheduleItem).isOpen"
                checked-children="上班"
                un-checked-children="休息"
              />
            </template>
            <template v-else-if="column.key === 'timeRanges'">
              <span v-if="!(record as ScheduleItem).isOpen" style="color: #999"
                >—</span
              >
              <span
                v-else-if="(record as ScheduleItem).timeRanges.length === 0"
                style="color: #999"
                >全天</span
              >
              <Space v-else wrap>
                <Tag
                  v-for="(r, i) in (record as ScheduleItem).timeRanges"
                  :key="i"
                  color="blue"
                >
                  {{ r.start }} – {{ r.end }}
                </Tag>
              </Space>
            </template>
            <template v-else-if="column.key === 'action'">
              <Button
                size="small"
                @click="openScheduleEdit(record as ScheduleItem)"
              >
                编辑时段
              </Button>
            </template>
          </template>
        </Table>
      </TabPane>
      <TabPane key="holidays">
        <template #tab>
          <span>节假日管理</span>
          <Badge
            :count="holidayList.length"
            :overflow-count="99"
            :offset="[8, -10]"
            :number-style="{ backgroundColor: '#52c41a' }"
          />
        </template>
        <div
          style="
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-bottom: 12px;
          "
        >
          <Button :loading="holidaySyncing" @click="syncHolidays"
            >同步法定节假日</Button
          >
          <Button type="primary" @click="openCreateHoliday">+ 新增</Button>
        </div>
        <Table
          :columns="holidayColumns"
          :data-source="holidayList"
          :loading="holidayLoading"
          :pagination="{ pageSize: 20 }"
          row-key="id"
          bordered
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'type'">
              <Tag v-if="(record as HolidayItem).type === 'CLOSED'" color="red"
                >休息</Tag
              >
              <Tag
                v-else-if="(record as HolidayItem).type === 'WORKDAY'"
                color="green"
                >补班</Tag
              >
              <Tag
                v-else-if="(record as HolidayItem).type === 'CUSTOM'"
                color="blue"
                >自定义</Tag
              >
            </template>
            <template v-else-if="column.key === 'source'">
              <Tag
                :color="
                  (record as HolidayItem).source === 'AUTO'
                    ? 'default'
                    : 'purple'
                "
              >
                {{
                  (record as HolidayItem).source === 'AUTO' ? '自动' : '手动'
                }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <Space>
                <Button
                  size="small"
                  @click="openEditHoliday(record as HolidayItem)"
                  >编辑</Button
                >
                <Button
                  size="small"
                  danger
                  @click="confirmDeleteHoliday(record as HolidayItem)"
                  >删除</Button
                >
              </Space>
            </template>
          </template>
        </Table>
      </TabPane>
      <TabPane key="offline" tab="离线回复">
        <div style="max-width: 600px; padding: 16px 0">
          <Form layout="vertical">
            <FormItem label="离线自动回复内容" help="支持占位符 {nextOpenTime}">
              <!-- 变量选择器 -->
              <div class="mb-2 flex items-center gap-2">
                <span class="text-xs text-gray-500">插入变量:</span>
                <Button
                  v-for="v in offlineVariables"
                  :key="v"
                  size="small"
                  @click="insertVariable(v)"
                >
                  {{ v }}
                </Button>
              </div>
              <Textarea
                ref="offlineTextareaRef"
                v-model:value="offlineMsg"
                :rows="5"
                :disabled="offlineLoading"
                placeholder="请输入非工作时间自动回复内容，支持占位符 {nextOpenTime}"
              />
            </FormItem>
            <FormItem>
              <Button
                type="primary"
                :loading="offlineSaving"
                @click="saveOfflineReply"
              >
                保存
              </Button>
            </FormItem>
          </Form>
        </div>
      </TabPane>
    </Tabs>
    <!-- 编辑排班时段 -->
    <Modal
      v-model:open="scheduleModalOpen"
      title="编辑服务时段"
      width="480px"
      @ok="confirmScheduleEdit"
    >
      <div style="margin: 16px 0">
        <div
          v-for="(range, idx) in editRanges"
          :key="idx"
          style="
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 8px;
          "
        >
          <Input
            v-model:value="range.start"
            style="width: 110px"
            placeholder="09:00"
          />
          <span>–</span>
          <Input
            v-model:value="range.end"
            style="width: 110px"
            placeholder="18:00"
          />
          <Button size="small" danger @click="removeRange(idx)">删除</Button>
        </div>
        <Button size="small" @click="addRange">+ 添加时段</Button>
      </div>
    </Modal>

    <!-- 新增/编辑节假日 -->
    <Modal
      v-model:open="holidayModalOpen"
      :title="editingHolidayId !== null ? '编辑节假日' : '新增节假日'"
      :confirm-loading="holidaySubmitting"
      width="520px"
      @ok="submitHoliday"
    >
      <Form layout="vertical" style="margin-top: 16px">
        <FormItem label="日期" required>
          <Input v-model:value="holidayForm.date" placeholder="2026-01-01" />
        </FormItem>
        <FormItem label="类型" required>
          <Select v-model:value="holidayForm.type" style="width: 100%">
            <SelectOption value="CLOSED">休息（CLOSED）</SelectOption>
            <SelectOption value="WORKDAY">补班（WORKDAY）</SelectOption>
            <SelectOption value="CUSTOM">自定义（CUSTOM）</SelectOption>
          </Select>
        </FormItem>
        <FormItem
          v-if="holidayForm.type === 'WORKDAY' || holidayForm.type === 'CUSTOM'"
          label="服务时段"
        >
          <div
            v-for="(range, idx) in holidayForm.timeRanges"
            :key="idx"
            style="
              display: flex;
              gap: 8px;
              align-items: center;
              margin-bottom: 8px;
            "
          >
            <Input
              v-model:value="range.start"
              style="width: 110px"
              placeholder="09:00"
            />
            <span>–</span>
            <Input
              v-model:value="range.end"
              style="width: 110px"
              placeholder="18:00"
            />
            <Button size="small" danger @click="removeHolidayRange(idx)"
              >删除</Button
            >
          </div>
          <Button size="small" @click="addHolidayRange">+ 添加时段</Button>
        </FormItem>
        <FormItem label="备注">
          <Input v-model:value="holidayForm.remark" placeholder="可选备注" />
        </FormItem>
      </Form>
    </Modal>
  </Page>
</template>
