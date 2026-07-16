<script setup lang="ts">
// 坐席工作台「快捷回复」浮层。
// - / 触发：父组件检测到输入中的 /query 后设置 open+query，本组件搜索并展示结果。
// - 键盘导航：父组件将 ↑/↓/Enter/Esc 转发到 move()/confirm()（通过 defineExpose）。
// - 点击结果：上报使用次数并 emit('select', item)，由父组件完成变量替换与回填。
// - 我的常用语：切换模式管理个人 PRIVATE 模板（增删改）。

import type {
  CannedResponse,
  CannedResponseSearchVO,
} from '#/api/canned-response/types';

import { computed, reactive, ref, watch } from 'vue';

import { Empty, message, Modal } from 'ant-design-vue';

import {
  createMineApi,
  deleteMineApi,
  listMineApi,
  recordUseApi,
  searchCannedApi,
  updateMineApi,
} from '#/api/canned-response';

const props = defineProps<{
  /** 是否展开（父组件 slash 检测控制） */
  open: boolean;
  /** 当前 / 后的查询词 */
  query: string;
}>();

const emit = defineEmits<{
  close: [];
  select: [item: CannedResponseSearchVO];
}>();

// ===== 搜索模式 =====
const results = ref<CannedResponseSearchVO[]>([]);
const loading = ref(false);
const activeIndex = ref(0);
let debounceTimer: null | ReturnType<typeof setTimeout> = null;

const scopeLabel = (scope: string) => (scope === 'PRIVATE' ? '个人' : '公共');

watch(
  () => [props.open, props.query] as const,
  ([open, q]) => {
    if (!open) {
      results.value = [];
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(q), 180);
  },
  { immediate: true },
);

async function runSearch(q: string) {
  loading.value = true;
  try {
    results.value = await searchCannedApi(q, undefined, 10);
    activeIndex.value = 0;
  } catch {
    results.value = [];
  } finally {
    loading.value = false;
  }
}

// ===== 我的常用语模式 =====
const showMine = ref(false);
const mineList = ref<CannedResponse[]>([]);
const mineLoading = ref(false);
const mineModalOpen = ref(false);
const mineEditingId = ref<null | number>(null);
const mineSubmitting = ref(false);
const mineForm = reactive<{ content: string; title: string }>({
  title: '',
  content: '',
});

async function toggleMine() {
  showMine.value = !showMine.value;
  if (showMine.value) {
    await loadMine();
  }
}

async function loadMine() {
  mineLoading.value = true;
  try {
    mineList.value = await listMineApi();
  } catch {
    mineList.value = [];
  } finally {
    mineLoading.value = false;
  }
}

function openMineCreate() {
  mineEditingId.value = null;
  mineForm.title = '';
  mineForm.content = '';
  mineModalOpen.value = true;
}

function openMineEdit(row: CannedResponse) {
  mineEditingId.value = row.id;
  mineForm.title = row.title;
  mineForm.content = row.content;
  mineModalOpen.value = true;
}

async function submitMine() {
  if (!mineForm.title.trim() || !mineForm.content.trim()) {
    message.warning('请填写标题与内容');
    return;
  }
  mineSubmitting.value = true;
  try {
    if (mineEditingId.value) {
      await updateMineApi(mineEditingId.value, { ...mineForm });
      message.success('已更新');
    } else {
      await createMineApi({ ...mineForm });
      message.success('已添加');
    }
    mineModalOpen.value = false;
    await loadMine();
  } catch (error: unknown) {
    const err = error as { response?: { data?: { msg?: string } } };
    message.error(err?.response?.data?.msg ?? '操作失败');
  } finally {
    mineSubmitting.value = false;
  }
}

function confirmDeleteMine(row: CannedResponse) {
  Modal.confirm({
    title: `删除个人常用语「${row.title}」？`,
    okType: 'danger',
    async onOk() {
      try {
        await deleteMineApi(row.id);
        message.success('已删除');
        await loadMine();
      } catch (error: unknown) {
        const err = error as { response?: { data?: { msg?: string } } };
        message.error(err?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

// ===== 选中 =====
function pick(item: CannedResponseSearchVO) {
  // 使用上报：异步、不阻塞插入
  recordUseApi(item.id).catch(() => {});
  emit('select', item);
}

// ===== 暴露给父组件：键盘导航 =====
function move(dir: number) {
  if (results.value.length === 0) return;
  const next = activeIndex.value + dir;
  activeIndex.value = Math.min(Math.max(0, next), results.value.length - 1);
}

function confirm() {
  const item = results.value[activeIndex.value];
  if (item) pick(item);
}

const hasResult = computed(() => results.value.length > 0);

defineExpose({ move, confirm });
</script>

<template>
  <div
    v-show="open"
    class="canned-picker absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[#e4e7ed] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.16)]"
  >
    <!-- 头部：模式切换 -->
    <div
      class="flex items-center justify-between border-b border-[#f0f1f5] px-3 py-2"
    >
      <span class="text-[13px] font-medium text-[#1f2937]">
        {{ showMine ? '我的常用语' : '快捷回复' }}
      </span>
      <button
        class="rounded-md px-2 py-1 text-[12px] text-[#1a73e8] transition hover:bg-[#eef1f8]"
        @click="toggleMine"
      >
        {{ showMine ? '← 搜索' : `我的常用语 (${mineList.length})` }}
      </button>
    </div>

    <!-- 搜索结果模式 -->
    <div v-if="!showMine" class="max-h-[300px] overflow-y-auto py-1">
      <div
        v-if="loading"
        class="px-3 py-6 text-center text-[13px] text-[#9ca3af]"
      >
        搜索中…
      </div>
      <Empty
        v-else-if="!hasResult"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        description="无匹配快捷回复"
        class="py-6"
      />
      <template v-else>
        <button
          v-for="(r, i) in results"
          :key="r.id"
          class="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition"
          :class="i === activeIndex ? 'bg-[#eef3ff]' : 'hover:bg-[#f7f8fc]'"
          @click="pick(r)"
          @mousemove="activeIndex = i"
        >
          <div class="flex items-center gap-2">
            <span class="truncate text-[13px] font-medium text-[#0a0a0b]">{{
              r.title
            }}</span>
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
              :class="
                r.scope === 'PRIVATE'
                  ? 'bg-[#fef3c7] text-[#b45309]'
                  : 'bg-[#e0edff] text-[#1a73e8]'
              "
              >{{ scopeLabel(r.scope) }}</span
            >
            <span class="ml-auto shrink-0 text-[11px] text-[#9ca3af]"
              >用 {{ r.useCount }}</span
            >
          </div>
          <p class="line-clamp-2 text-[12px] text-[#6b7280]">{{ r.content }}</p>
        </button>
      </template>
    </div>

    <!-- 我的常用语模式 -->
    <div v-else class="max-h-[300px] overflow-y-auto py-1">
      <div
        v-if="mineLoading"
        class="px-3 py-6 text-center text-[13px] text-[#9ca3af]"
      >
        加载中…
      </div>
      <Empty
        v-else-if="mineList.length === 0"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        description="还没有个人常用语"
        class="py-6"
      />
      <template v-else>
        <div
          v-for="m in mineList"
          :key="m.id"
          class="group flex items-start gap-2 px-3 py-2 hover:bg-[#f7f8fc]"
        >
          <button class="min-w-0 flex-1 text-left" @click="pick(m)">
            <div class="truncate text-[13px] font-medium text-[#0a0a0b]">
              {{ m.title }}
            </div>
            <p class="line-clamp-2 text-[12px] text-[#6b7280]">
              {{ m.content }}
            </p>
          </button>
          <div
            class="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100"
          >
            <button
              class="rounded px-1.5 py-0.5 text-[12px] text-[#1a73e8] hover:bg-[#eef1f8]"
              @click="openMineEdit(m)"
            >
              编辑
            </button>
            <button
              class="rounded px-1.5 py-0.5 text-[12px] text-[#ef4444] hover:bg-[#fee2e2]"
              @click="confirmDeleteMine(m)"
            >
              删除
            </button>
          </div>
        </div>
      </template>
      <button
        class="m-2 w-[calc(100%-16px)] rounded-lg border border-dashed border-[#c7cdd6] py-2 text-[13px] text-[#1a73e8] transition hover:bg-[#f0f4ff]"
        @click="openMineCreate"
      >
        + 新增个人常用语
      </button>
    </div>

    <!-- 个人常用语编辑弹窗 -->
    <Modal
      v-model:open="mineModalOpen"
      :title="mineEditingId ? '编辑个人常用语' : '新增个人常用语'"
      :confirm-loading="mineSubmitting"
      width="480px"
      @ok="submitMine"
    >
      <div class="mt-4 flex flex-col gap-3">
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">标题</label>
          <input
            v-model="mineForm.title"
            class="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
            placeholder="如：感谢等待"
          />
        </div>
        <div>
          <label class="mb-1 block text-[13px] text-[#374151]">内容</label>
          <textarea
            v-model="mineForm.content"
            rows="4"
            class="w-full resize-none rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
            placeholder="支持变量：{{visitor_name}} {{agent_name}}"
          ></textarea>
        </div>
      </div>
    </Modal>
  </div>
</template>
