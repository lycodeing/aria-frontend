<script lang="ts" setup>
import type {
  HolidayItem,
  ScheduleItem,
  TimeRange,
} from '#/api/business-hours';

import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Form,
  FormItem,
  Input,
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

// ===== tab =====
const activeTab = ref('schedule');

// ===== 排班 =====
const scheduleList = ref<ScheduleItem[]>([]);
const scheduleLoading = ref(false);
const scheduleSaving = ref(false);

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

onMounted(() => {
  loadSchedule();
  loadHolidays();
  loadOfflineReply();
});
</script>

<template>
  <Page
    title="业务时间配置"
    description="配置客服工作时间、节假日和离线自动回复"
  >
    <Tabs v-model:active-key="activeTab">
      <TabPane key="schedule" tab="每周排班">
        <div style="margin-bottom: 12px; text-align: right">
          <Button
            type="primary"
            :loading="scheduleSaving"
            @click="saveSchedule"
          >
            保存排班
          </Button>
        </div>
        <Table
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
      <TabPane key="holidays" tab="节假日管理">
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
              <Textarea
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
