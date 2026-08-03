<script lang="ts" setup>
// 系统管理 — 快捷回复配置。
// 左：分组列表（扁平）CRUD，含数量徽章；右：公共快捷回复 CRUD（卡片/表格两种视图）。
// 一次性加载全量数据（size=200），分组过滤 / 关键字搜索 / 排序均在前端进行。
// 私人和坐席端搜索见坐席工作台 / 触发器。

import type {
  CannedResponse,
  CannedResponseGroup,
} from '#/api/canned-response/types';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Button,
  Input,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Table,
} from 'ant-design-vue';

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

// 一次性加载全部公共快捷回复（size=200），后续过滤/搜索/排序均在前端进行
async function loadResponses() {
  respLoading.value = true;
  try {
    responses.value = await listPublicApi(null, 1, 200);
  } catch {
    message.error('加载快捷回复失败');
  } finally {
    respLoading.value = false;
  }
}

// 分组 -> 回复数量映射（用于左侧数量徽章）
const groupCounts = computed(() => {
  const map = new Map<number, number>();
  for (const r of responses.value) {
    if (r.groupId !== null) {
      map.set(r.groupId, (map.get(r.groupId) ?? 0) + 1);
    }
  }
  return map;
});
const totalCount = computed(() => responses.value.length);

// 视图模式：卡片 / 表格，默认卡片
const viewMode = ref<'card' | 'table'>('card');
// 关键字搜索（标题 + 内容）
const searchKeyword = ref('');
// 排序方式：默认 / 按使用次数
const sortBy = ref<'default' | 'useCount'>('default');

// 最大使用次数（用于条形宽度计算，最小为 1 避免除零）
const maxUseCount = computed(() =>
  Math.max(1, ...responses.value.map((r) => r.useCount)),
);

// 经过分组过滤 + 关键字搜索 + 排序后的展示列表
const displayedResponses = computed(() => {
  let list = responses.value;
  // 分组过滤
  if (selectedGroupId.value !== null) {
    list = list.filter((r) => r.groupId === selectedGroupId.value);
  }
  // 关键字过滤（标题 + 内容，不区分大小写）
  const kw = searchKeyword.value.trim().toLowerCase();
  if (kw) {
    list = list.filter(
      (r) =>
        r.title.toLowerCase().includes(kw) ||
        r.content.toLowerCase().includes(kw),
    );
  }
  // 排序：按使用次数降序
  if (sortBy.value === 'useCount') {
    list = [...list].toSorted((a, b) => b.useCount - a.useCount);
  }
  return list;
});

// 是否高频回复（使用次数 > 50）
function isHighFrequency(useCount: number) {
  return useCount > 50;
}

// 复制内容到剪贴板
async function copyContent(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    message.success('已复制到剪贴板');
  } catch {
    message.error('复制失败，请手动选择文本复制');
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
          <!-- 全部模板 -->
          <button
            class="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition"
            :class="
              selectedGroupId === null
                ? 'bg-[#eef3ff] text-[#1a73e8]'
                : 'text-[#374151] hover:bg-[#f7f8fc]'
            "
            @click="selectedGroupId = null"
          >
            <span class="w-[14px] shrink-0"></span>
            <span class="flex-1 truncate">全部模板</span>
            <span
              class="shrink-0 rounded-full bg-[#f0f1f5] px-1.5 py-0.5 text-[11px] text-[#6b7280]"
            >
              {{ totalCount }}
            </span>
          </button>
          <!-- 分组列表 -->
          <div
            v-for="g in groups"
            :key="g.id"
            class="group flex items-center gap-2 rounded-md px-2 py-2 transition"
            :class="
              selectedGroupId === g.id ? 'bg-[#eef3ff]' : 'hover:bg-[#f7f8fc]'
            "
          >
            <Icon
              icon="lucide:grip-vertical"
              class="shrink-0 cursor-grab text-[#9ca3af] active:cursor-grabbing"
              width="14"
            />
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
            <span
              class="shrink-0 rounded-full bg-[#f0f1f5] px-1.5 py-0.5 text-[11px] text-[#6b7280]"
            >
              {{ groupCounts.get(g.id) ?? 0 }}
            </span>
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
        <!-- 工具栏：筛选信息 + 搜索 + 排序 + 视图切换 + 新增 -->
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span class="text-[14px] text-[#6b7280]">
            当前筛选：
            <b class="text-[#1f2937]">{{
              selectedGroupId === null
                ? '全部模板'
                : groupMap.get(selectedGroupId) || '未知'
            }}</b>
            <span class="ml-2 text-[12px] text-[#9ca3af]">
              共 {{ displayedResponses.length }} 条
            </span>
          </span>
          <div class="flex flex-wrap items-center gap-2">
            <Input
              v-model:value="searchKeyword"
              allow-clear
              placeholder="搜索标题或内容"
              style="width: 220px"
            >
              <template #prefix>
                <Icon
                  icon="ant-design:search-outlined"
                  class="text-[#9ca3af]"
                  width="14"
                />
              </template>
            </Input>
            <button
              class="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[13px] transition"
              :class="
                sortBy === 'useCount'
                  ? 'border-[#1a73e8] bg-[#eef3ff] text-[#1a73e8]'
                  : 'border-[#e4e7ed] text-[#6b7280] hover:text-[#1a73e8]'
              "
              @click="sortBy = sortBy === 'useCount' ? 'default' : 'useCount'"
            >
              <Icon icon="ant-design:bar-chart-outlined" width="14" />
              按使用次数
            </button>
            <!-- 视图切换 -->
            <div
              class="flex overflow-hidden rounded-md border border-[#e4e7ed]"
            >
              <button
                class="flex items-center px-2.5 py-1.5 transition"
                :class="
                  viewMode === 'card'
                    ? 'bg-[#1a73e8] text-white'
                    : 'text-[#6b7280] hover:bg-[#f7f8fc]'
                "
                title="卡片视图"
                @click="viewMode = 'card'"
              >
                <Icon icon="ant-design:appstore-outlined" width="14" />
              </button>
              <button
                class="flex items-center px-2.5 py-1.5 transition"
                :class="
                  viewMode === 'table'
                    ? 'bg-[#1a73e8] text-white'
                    : 'text-[#6b7280] hover:bg-[#f7f8fc]'
                "
                title="表格视图"
                @click="viewMode = 'table'"
              >
                <Icon icon="ant-design:unordered-list-outlined" width="14" />
              </button>
            </div>
            <button
              class="rounded-lg bg-[#1a73e8] px-3 py-1.5 text-[13px] text-white transition hover:opacity-90"
              @click="openRespCreate"
            >
              + 新增快捷回复
            </button>
          </div>
        </div>

        <!-- 卡片视图 -->
        <Spin v-if="viewMode === 'card'" :spinning="respLoading">
          <div class="grid grid-cols-3 gap-3">
            <div
              v-for="r in displayedResponses"
              :key="r.id"
              class="flex flex-col rounded-lg border border-[#e4e7ed] bg-white p-3 transition hover:shadow-md"
            >
              <!-- 标题 + 高频标签 -->
              <div class="mb-2 flex items-start justify-between gap-2">
                <span
                  class="line-clamp-1 text-[14px] font-semibold text-[#1f2937]"
                >
                  {{ r.title }}
                </span>
                <span
                  v-if="isHighFrequency(r.useCount)"
                  class="shrink-0 rounded bg-[#fff7e6] px-1.5 py-0.5 text-[11px] text-[#fa8c16]"
                >
                  高频
                </span>
              </div>
              <!-- 内容预览（截断 2 行） -->
              <div
                class="mb-3 line-clamp-2 rounded bg-gray-50 p-2 text-[12px] leading-relaxed text-[#4b5563]"
              >
                {{ r.content }}
              </div>
              <!-- 底部：分组 + 使用次数条形可视化 -->
              <div class="mt-auto">
                <div
                  class="mb-1.5 flex items-center justify-between text-[11px] text-[#9ca3af]"
                >
                  <span class="truncate">
                    {{ r.groupId != null ? groupMap.get(r.groupId) : '未分组' }}
                  </span>
                  <span>使用 {{ r.useCount }} 次</span>
                </div>
                <div class="mb-2 h-1 overflow-hidden rounded-full bg-[#f0f1f5]">
                  <div
                    class="h-full rounded-full bg-[#1a73e8] transition-all"
                    :style="{
                      width: `${(r.useCount / maxUseCount) * 100}%`,
                    }"
                  ></div>
                </div>
                <!-- 操作行 -->
                <div
                  class="flex items-center divide-x divide-[#f0f1f5] border-t border-[#f0f1f5]"
                >
                  <button
                    class="flex-1 py-1.5 text-[12px] text-[#1a73e8] transition hover:bg-[#eef3ff]"
                    @click="copyContent(r.content)"
                  >
                    复制
                  </button>
                  <button
                    class="flex-1 py-1.5 text-[12px] text-[#6b7280] transition hover:bg-[#f7f8fc]"
                    @click="openRespEdit(r)"
                  >
                    编辑
                  </button>
                  <button
                    class="flex-1 py-1.5 text-[12px] text-[#ef4444] transition hover:bg-[#fee2e2]"
                    @click="confirmDeleteResp(r)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
            <!-- 空状态 -->
            <div
              v-if="displayedResponses.length === 0 && !respLoading"
              class="col-span-3 py-12 text-center text-[13px] text-[#9ca3af]"
            >
              暂无快捷回复
            </div>
          </div>
        </Spin>

        <!-- 表格视图 -->
        <Table
          v-else
          :columns="respColumns"
          :data-source="displayedResponses"
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
