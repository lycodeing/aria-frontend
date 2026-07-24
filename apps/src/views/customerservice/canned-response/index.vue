<script lang="ts" setup>
// 系统管理 — 快捷回复配置。
// 左：分组树（扁平列表）CRUD；右：公共快捷回复表 CRUD（按分组过滤）。
// 私人和坐席端搜索见坐席工作台 / 触发器。

import type {
  CannedResponse,
  CannedResponseGroup,
} from '#/api/canned-response/types';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, message, Modal, Select, Space, Table } from 'ant-design-vue';

import {
  createGroupApi,
  createPublicApi,
  deleteGroupApi,
  deletePublicApi,
  listGroupsApi,
  listPublicApi,
  updateGroupApi,
  updatePublicApi,
} from '#/api/canned-response';

// ===================== 分组 =====================
const groups = ref<CannedResponseGroup[]>([]);
const selectedGroupId = ref<null | number>(null);
const groupLoading = ref(false);

async function loadGroups() {
  groupLoading.value = true;
  try {
    groups.value = await listGroupsApi();
  } catch {
    message.error('加载分组失败');
  } finally {
    groupLoading.value = false;
  }
}

const groupMap = computed(
  () => new Map(groups.value.map((g) => [g.id, g.name])),
);
const groupOptions = computed(() =>
  groups.value.map((g) => ({ value: g.id, label: g.name })),
);

// 分组弹窗
const groupModalOpen = ref(false);
const groupEditingId = ref<null | number>(null);
const groupSubmitting = ref(false);
const groupForm = reactive<{
  name: string;
  parentId: number | undefined;
  sortOrder: number;
}>({ name: '', parentId: undefined, sortOrder: 0 });

function openGroupCreate() {
  groupEditingId.value = null;
  Object.assign(groupForm, { name: '', parentId: undefined, sortOrder: 0 });
  groupModalOpen.value = true;
}

function openGroupEdit(row: CannedResponseGroup) {
  groupEditingId.value = row.id;
  Object.assign(groupForm, {
    name: row.name,
    parentId: row.parentId ?? undefined,
    sortOrder: row.sortOrder,
  });
  groupModalOpen.value = true;
}

async function submitGroup() {
  if (!groupForm.name.trim()) {
    message.warning('请填写分组名称');
    return;
  }
  if (groupForm.parentId === groupEditingId.value) {
    message.warning('父分组不能是自身');
    return;
  }
  groupSubmitting.value = true;
  try {
    if (groupEditingId.value) {
      await updateGroupApi(groupEditingId.value, { ...groupForm });
      message.success('已更新分组');
    } else {
      await createGroupApi({ ...groupForm });
      message.success('已新建分组');
    }
    groupModalOpen.value = false;
    await loadGroups();
  } catch (error: unknown) {
    const err = error as { response?: { data?: { msg?: string } } };
    message.error(err?.response?.data?.msg ?? '操作失败');
  } finally {
    groupSubmitting.value = false;
  }
}

function confirmDeleteGroup(row: CannedResponseGroup) {
  Modal.confirm({
    title: `删除分组「${row.name}」？`,
    content: '该分组下存在子分组或快捷回复时将无法删除。',
    okType: 'danger',
    async onOk() {
      try {
        await deleteGroupApi(row.id);
        message.success('已删除');
        if (selectedGroupId.value === row.id) selectedGroupId.value = null;
        await loadGroups();
        await loadResponses();
      } catch (error: unknown) {
        const err = error as { response?: { data?: { msg?: string } } };
        message.error(err?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

// ===================== 公共快捷回复 =====================
const responses = ref<CannedResponse[]>([]);
const respLoading = ref(false);

async function loadResponses() {
  respLoading.value = true;
  try {
    responses.value = await listPublicApi(selectedGroupId.value, 1, 200);
  } catch {
    message.error('加载快捷回复失败');
  } finally {
    respLoading.value = false;
  }
}

// 回复弹窗
const respModalOpen = ref(false);
const respEditingId = ref<null | number>(null);
const respSubmitting = ref(false);
const respForm = reactive<{
  content: string;
  groupId: number | undefined;
  sortOrder: number;
  title: string;
}>({ title: '', content: '', groupId: undefined, sortOrder: 0 });

function openRespCreate() {
  respEditingId.value = null;
  Object.assign(respForm, {
    title: '',
    content: '',
    groupId: selectedGroupId.value ?? undefined,
    sortOrder: 0,
  });
  respModalOpen.value = true;
}

function openRespEdit(row: CannedResponse) {
  respEditingId.value = row.id;
  Object.assign(respForm, {
    title: row.title,
    content: row.content,
    groupId: row.groupId ?? undefined,
    sortOrder: row.sortOrder,
  });
  respModalOpen.value = true;
}

async function submitResp() {
  if (!respForm.title.trim() || !respForm.content.trim()) {
    message.warning('请填写标题与内容');
    return;
  }
  respSubmitting.value = true;
  try {
    if (respEditingId.value) {
      await updatePublicApi(respEditingId.value, { ...respForm });
      message.success('已更新');
    } else {
      await createPublicApi({ ...respForm });
      message.success('已新建');
    }
    respModalOpen.value = false;
    await loadResponses();
  } catch (error: unknown) {
    const err = error as { response?: { data?: { msg?: string } } };
    message.error(err?.response?.data?.msg ?? '操作失败');
  } finally {
    respSubmitting.value = false;
  }
}

function confirmDeleteResp(row: CannedResponse) {
  Modal.confirm({
    title: `删除「${row.title}」？`,
    okType: 'danger',
    async onOk() {
      try {
        await deletePublicApi(row.id);
        message.success('已删除');
        await loadResponses();
      } catch (error: unknown) {
        const err = error as { response?: { data?: { msg?: string } } };
        message.error(err?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

// ===================== 表格列 =====================
const respColumns = [
  { title: '标题', dataIndex: 'title', key: 'title', width: 180 },
  { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
  { title: '分组', key: 'group', width: 140 },
  { title: '使用次数', dataIndex: 'useCount', key: 'useCount', width: 90 },
  { title: '排序', dataIndex: 'sortOrder', key: 'sortOrder', width: 70 },
  { title: '操作', key: 'action', width: 140 },
];

onMounted(async () => {
  await loadGroups();
  await loadResponses();
});
</script>

<template>
  <Page>
    <div class="flex gap-4">
      <!-- 左：分组 -->
      <div
        class="flex w-[280px] shrink-0 flex-col rounded-lg border border-[#e4e7ed] bg-white"
      >
        <div
          class="flex items-center justify-between border-b border-[#f0f1f5] px-4 py-3"
        >
          <span class="text-[14px] font-medium text-[#1f2937]">分组</span>
          <button
            class="rounded-md px-2 py-1 text-[13px] text-[#1a73e8] transition hover:bg-[#eef1f8]"
            @click="openGroupCreate"
          >
            + 分组
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-2" style="min-height: 420px">
          <button
            class="mb-1 w-full rounded-md px-3 py-2 text-left text-[13px] transition"
            :class="
              selectedGroupId === null
                ? 'bg-[#eef3ff] text-[#1a73e8]'
                : 'text-[#374151] hover:bg-[#f7f8fc]'
            "
            @click="selectedGroupId = null"
          >
            全部模板
          </button>
          <div
            v-for="g in groups"
            :key="g.id"
            class="group flex items-center rounded-md px-3 py-2 transition"
            :class="
              selectedGroupId === g.id ? 'bg-[#eef3ff]' : 'hover:bg-[#f7f8fc]'
            "
          >
            <button
              class="min-w-0 flex-1 truncate text-left text-[13px]"
              :class="
                selectedGroupId === g.id
                  ? 'font-medium text-[#1a73e8]'
                  : 'text-[#374151]'
              "
              @click="selectedGroupId = g.id"
            >
              {{ g.name }}
            </button>
            <div
              class="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100"
            >
              <button
                class="rounded px-1.5 py-0.5 text-[12px] text-[#1a73e8] hover:bg-[#eef1f8]"
                @click="openGroupEdit(g)"
              >
                编辑
              </button>
              <button
                class="rounded px-1.5 py-0.5 text-[12px] text-[#ef4444] hover:bg-[#fee2e2]"
                @click="confirmDeleteGroup(g)"
              >
                删除
              </button>
            </div>
          </div>
          <div
            v-if="groups.length === 0 && !groupLoading"
            class="px-3 py-8 text-center text-[13px] text-[#9ca3af]"
          >
            暂无分组
          </div>
        </div>
      </div>

      <!-- 右：公共快捷回复 -->
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="mb-3 flex items-center justify-between">
          <span class="text-[14px] text-[#6b7280]">
            当前筛选：
            <b class="text-[#1f2937]">{{
              selectedGroupId === null
                ? '全部模板'
                : groupMap.get(selectedGroupId) || '未知'
            }}</b>
          </span>
          <button
            class="rounded-lg bg-[#1a73e8] px-3 py-1.5 text-[13px] text-white transition hover:opacity-90"
            @click="openRespCreate"
          >
            + 新增快捷回复
          </button>
        </div>
        <Table
          :columns="respColumns"
          :data-source="responses"
          :loading="respLoading"
          :pagination="false"
          row-key="id"
          bordered
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'group'">
              <span class="text-[13px] text-[#6b7280]">
                {{
                  (record as CannedResponse).groupId != null
                    ? groupMap.get((record as CannedResponse).groupId as number)
                    : '—'
                }}
              </span>
            </template>
            <template v-else-if="column.key === 'action'">
              <Space>
                <Button
                  size="small"
                  @click="openRespEdit(record as CannedResponse)"
                >
                  编辑
                </Button>
                <Button
                  size="small"
                  danger
                  @click="confirmDeleteResp(record as CannedResponse)"
                >
                  删除
                </Button>
              </Space>
            </template>
          </template>
        </Table>
      </div>
    </div>

    <!-- 分组弹窗 -->
    <Modal
      v-model:open="groupModalOpen"
      :title="groupEditingId ? '编辑分组' : '新增分组'"
      :confirm-loading="groupSubmitting"
      width="460px"
      @ok="submitGroup"
    >
      <div class="mt-4 flex flex-col gap-3">
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">分组名称</label>
          <input
            v-model="groupForm.name"
            class="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
            placeholder="如：通用问候"
          />
        </div>
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">上级分组</label>
          <Select
            v-model:value="groupForm.parentId"
            :options="groupOptions"
            allow-clear
            placeholder="不选择则为顶层分组"
            style="width: 100%"
          />
        </div>
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">排序</label>
          <input
            v-model.number="groupForm.sortOrder"
            type="number"
            class="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
          />
        </div>
      </div>
    </Modal>

    <!-- 快捷回复弹窗 -->
    <Modal
      v-model:open="respModalOpen"
      :title="respEditingId ? '编辑快捷回复' : '新增快捷回复'"
      :confirm-loading="respSubmitting"
      width="560px"
      @ok="submitResp"
    >
      <div class="mt-4 flex flex-col gap-3">
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">标题</label>
          <input
            v-model="respForm.title"
            class="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
            placeholder="如：感谢等待"
          />
        </div>
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">所属分组</label>
          <Select
            v-model:value="respForm.groupId"
            :options="groupOptions"
            allow-clear
            placeholder="不选择则归入「未分组」"
            style="width: 100%"
          />
        </div>
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">内容</label>
          <textarea
            v-model="respForm.content"
            rows="5"
            class="w-full resize-none rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
            placeholder="支持变量：{{visitor_name}} {{agent_name}}"
          ></textarea>
          <p class="mt-1 text-[12px] text-[#9ca3af]">
            变量会在坐席插入时自动替换为实际值。
          </p>
        </div>
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">排序</label>
          <input
            v-model.number="respForm.sortOrder"
            type="number"
            class="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
          />
        </div>
      </div>
    </Modal>
  </Page>
</template>
