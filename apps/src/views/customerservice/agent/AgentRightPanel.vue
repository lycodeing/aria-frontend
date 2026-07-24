<script setup lang="ts">
import type { ClosedView, SessionData } from './types';

import type { NoteVO } from '#/api/note/index';
import type { ReplySuggestion, VisitorHistorySession } from '#/api/session';
import type { TagVO } from '#/api/tag/index';
import type { SummaryState } from '#/composables/useVisitorHistory';

import { computed, onUnmounted, ref, watch } from 'vue';

import { Icon } from '@iconify/vue';
import { Button, message, Modal, Select, Tag, Textarea } from 'ant-design-vue';

import { createNoteApi, deleteNoteApi, listNotesApi } from '#/api/note/index';
import {
  addSessionTagApi,
  addVisitorTagApi,
  listSessionTagsApi,
  listTagsApi,
  listVisitorTagsApi,
  removeSessionTagApi,
  removeVisitorTagApi,
} from '#/api/tag/index';
import { resolveTagColor } from '#/composables/useSessionQueue';

import AISuggestPanel from './AISuggestPanel.vue';

const props = defineProps<{
  activeSession: SessionData | undefined;
  closedView: ClosedView | null;
  replySuggestions: ReplySuggestion[];
  suggestionsError: boolean;
  suggestionsLoading: boolean;
  summaryMap: Record<string, SummaryState>;
  visitorHistoryList: VisitorHistorySession[];
  visitorHistoryLoading: boolean;
}>();

const emit = defineEmits<{
  applySuggestion: [content: string];
  insertSuggestion: [content: string];
  openHistoryDrawer: [];
  refreshSuggestions: [];
  refreshSuggestionsWithPrompt: [prompt: string];
}>();

function formatShortDate(isoString: string | undefined): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

// ===== Tag & Note state =====
const visitorTags = ref<TagVO[]>([]);
const sessionTags = ref<TagVO[]>([]);
const allTags = ref<TagVO[]>([]);
const tagPickerMode = ref<'session' | 'visitor'>('visitor');
const tagPickerVisibleVisitor = ref(false);
const tagPickerVisibleSession = ref(false);
const selectedTagIdVisitor = ref<string | undefined>();
const selectedTagIdSession = ref<string | undefined>();

const notes = ref<NoteVO[]>([]);
const newNoteContent = ref('');
const savingNote = ref(false);
const noteModalVisible = ref(false);
const aiPanelOpen = ref(false);

// ===== 接入时长实时刷新 =====
const now = ref(Date.now());
const nowTimer = setInterval(() => {
  now.value = Date.now();
}, 1000);
onUnmounted(() => clearInterval(nowTimer));

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec >= 86_400) {
    const d = Math.floor(sec / 86_400);
    const h = Math.floor((sec % 86_400) / 3600);
    return h > 0 ? `${d}天${h}小时` : `${d}天`;
  }
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
  }
  if (sec < 60) return `${sec}秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}分钟${String(s).padStart(2, '0')}秒`;
}

const elapsedTime = computed(() =>
  props.activeSession
    ? formatElapsed(now.value - props.activeSession.acceptedAt * 1000)
    : '—',
);

// ===== Filtered tag options (I4: hide already-applied tags) =====
const availableVisitorTags = computed(() =>
  allTags.value.filter(
    (t) => !visitorTags.value.some((v) => String(v.id) === String(t.id)),
  ),
);

const availableSessionTags = computed(() =>
  allTags.value.filter(
    (t) => !sessionTags.value.some((s) => String(s.id) === String(t.id)),
  ),
);

// ===== Load data =====
async function loadTagsAndNotes(sessionId: string) {
  try {
    const [vTags, sTags, noteList, tagDict] = await Promise.all([
      listVisitorTagsApi(sessionId),
      listSessionTagsApi(sessionId),
      listNotesApi(sessionId),
      listTagsApi(),
    ]);
    // Guard: discard results if session changed while requests were in flight
    if (props.activeSession?.id !== sessionId) return;
    visitorTags.value = vTags;
    sessionTags.value = sTags;
    notes.value = noteList;
    allTags.value = tagDict;
  } catch {
    message.error('加载标签和备注失败');
  }
}

// ===== Tag operations =====
async function removeVisitorTag(tagId: number | string) {
  const sid = props.activeSession?.id;
  if (!sid) return;
  try {
    await removeVisitorTagApi(sid, tagId);
    visitorTags.value = visitorTags.value.filter((t) => t.id !== tagId);
  } catch {
    message.error('移除标签失败');
  }
}

async function removeSessionTag(tagId: number | string) {
  const sid = props.activeSession?.id;
  if (!sid) return;
  try {
    await removeSessionTagApi(sid, tagId);
    sessionTags.value = sessionTags.value.filter((t) => t.id !== tagId);
  } catch {
    message.error('移除标签失败');
  }
}

async function confirmAddVisitorTag(tagId: string) {
  const sid = props.activeSession?.id;
  if (!sid || !tagId) return;
  try {
    const added = await addVisitorTagApi(sid, { tagId });
    visitorTags.value.push(added);
    selectedTagIdVisitor.value = undefined;
    tagPickerVisibleVisitor.value = false;
  } catch {
    message.error('添加标签失败');
  }
}

async function confirmAddSessionTag(tagId: string) {
  const sid = props.activeSession?.id;
  if (!sid || !tagId) return;
  try {
    const added = await addSessionTagApi(sid, { tagId });
    sessionTags.value.push(added);
    selectedTagIdSession.value = undefined;
    tagPickerVisibleSession.value = false;
  } catch {
    message.error('添加标签失败');
  }
}

function showTagPicker(mode: 'session' | 'visitor') {
  tagPickerMode.value = mode;
  if (mode === 'visitor') {
    tagPickerVisibleVisitor.value = true;
  } else {
    tagPickerVisibleSession.value = true;
  }
}

// ===== Note operations =====
async function saveNote() {
  const sid = props.activeSession?.id;
  if (!newNoteContent.value.trim() || !sid) return;
  savingNote.value = true;
  try {
    const note = await createNoteApi(sid, newNoteContent.value);
    notes.value.push(note);
    newNoteContent.value = '';
    noteModalVisible.value = false;
  } catch {
    message.error('保存备注失败');
  } finally {
    savingNote.value = false;
  }
}

async function deleteNote(noteId: number | string) {
  const sid = props.activeSession?.id;
  if (!sid) return;
  Modal.confirm({
    title: '删除备注',
    content: '确定要删除这条备注吗？',
    okType: 'danger',
    async onOk() {
      try {
        await deleteNoteApi(sid, noteId);
        notes.value = notes.value.filter((n) => n.id !== noteId);
      } catch {
        message.error('删除备注失败');
      }
    },
  });
}

// ===== Watch session change =====
watch(
  () => props.activeSession?.id,
  (newId) => {
    if (newId) {
      visitorTags.value = [];
      sessionTags.value = [];
      notes.value = [];
      loadTagsAndNotes(newId);
    }
  },
  { immediate: true },
);
</script>

<template>
  <aside
    class="relative flex h-full flex-col gap-3.5 overflow-hidden bg-white"
    style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
  >
    <!-- 主内容：可滚动 -->
    <div
      class="flex h-full flex-col gap-3.5 overflow-y-auto p-4"
      style="scrollbar-color: #d4d8e3 transparent; scrollbar-width: thin"
    >
      <!-- ===== 进行中会话视图 ===== -->
      <template v-if="activeSession">
        <!-- Session info card -->
        <div class="rounded-xl bg-[#f7f8fc] p-3.5">
          <div class="flex items-center justify-between">
            <span class="text-[15px] font-medium text-[#0a0a0b]">会话信息</span>
            <span
              class="rounded bg-[#eef1f8] px-2 py-0.5 text-[12px] text-[#1a73e8]"
              >进行中</span
            >
          </div>

          <div class="mt-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#52525b]">访客姓名</span>
              <span class="text-[13px] font-medium text-[#0a0a0b]">{{
                activeSession.name
              }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#52525b]">会话编号</span>
              <span class="text-[13px] font-medium text-[#0a0a0b]">{{
                activeSession.sessionCode
              }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#52525b]">问题标签</span>
              <span
                class="rounded px-2 py-0.5 text-[11px]"
                :style="
                  resolveTagColor(activeSession.tag) === 'red'
                    ? 'background:#fff1f0;color:#cf1322'
                    : resolveTagColor(activeSession.tag) === 'orange'
                      ? 'background:#fff7e6;color:#d46b08'
                      : 'background:#e8f0ff;color:#1a73e8'
                "
              >
                {{ activeSession.tag || '未标记' }}
              </span>
            </div>
          </div>

          <!-- Stats row -->
          <div class="mt-3 flex gap-2">
            <div class="flex flex-1 flex-col gap-0.5 rounded-lg bg-white p-2.5">
              <span class="text-[11px] text-[#9ca3af]">接入时长</span>
              <span class="text-[14px] font-semibold text-[#0a0a0b]">{{
                elapsedTime
              }}</span>
            </div>
            <div class="flex flex-1 flex-col gap-0.5 rounded-lg bg-white p-2.5">
              <span class="text-[11px] text-[#9ca3af]">消息数</span>
              <span class="text-[14px] font-semibold text-[#0a0a0b]">
                {{
                  activeSession.msgs.filter((m) => m.role !== 'agent').length
                }}
              </span>
            </div>
            <div class="flex flex-1 flex-col gap-0.5 rounded-lg bg-white p-2.5">
              <span class="text-[11px] text-[#9ca3af]">接入状态</span>
              <span class="text-[13px] font-medium text-[#1a73e8]">进行中</span>
            </div>
          </div>

          <!-- Transfer reason -->
          <div class="mt-3">
            <div class="mb-1.5 text-[11px] text-[#9ca3af]">转接原因</div>
            <div
              class="flex items-start gap-2 rounded-lg bg-[#fff7ed] px-2.5 py-2"
            >
              <Icon
                icon="lucide:info"
                class="mt-0.5 shrink-0 text-[13px] text-[#d46b08]"
              />
              <p class="text-[12px] leading-[1.5] text-[#923b0e]">
                {{ activeSession.transferReason || '用户主动请求转人工' }}
              </p>
            </div>
          </div>

          <!-- 访客标签 -->
          <div class="mt-3">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-[11px] text-[#9ca3af]">访客标签</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Tag
                v-for="tag in visitorTags"
                :key="tag.id"
                :color="tag.color"
                closable
                class="!text-[11px]"
                @close="removeVisitorTag(tag.id)"
                >{{ tag.name }}</Tag
              >
              <template v-if="tagPickerVisibleVisitor">
                <Select
                  v-model:value="selectedTagIdVisitor"
                  size="small"
                  style="width: 110px"
                  placeholder="选择标签"
                  :options="
                    availableVisitorTags.map((t) => ({
                      value: String(t.id),
                      label: t.name,
                    }))
                  "
                  @change="(v: any) => confirmAddVisitorTag(String(v))"
                  @blur="tagPickerVisibleVisitor = false"
                />
              </template>
              <button
                v-else
                class="rounded border border-dashed border-[#d4d8e3] px-2 py-0.5 text-[11px] text-[#9ca3af] transition-colors hover:border-[#1a73e8] hover:text-[#1a73e8]"
                @click="showTagPicker('visitor')"
              >
                + 添加
              </button>
            </div>
          </div>

          <!-- 会话标签 -->
          <div class="mt-2.5">
            <div class="mb-1.5 text-[11px] text-[#9ca3af]">会话标签</div>
            <div class="flex flex-wrap gap-1.5">
              <Tag
                v-for="tag in sessionTags"
                :key="tag.id"
                :color="tag.color"
                closable
                class="!text-[11px]"
                @close="removeSessionTag(tag.id)"
                >{{ tag.name }}</Tag
              >
              <template v-if="tagPickerVisibleSession">
                <Select
                  v-model:value="selectedTagIdSession"
                  size="small"
                  style="width: 110px"
                  placeholder="选择标签"
                  :options="
                    availableSessionTags.map((t) => ({
                      value: String(t.id),
                      label: t.name,
                    }))
                  "
                  @change="(v: any) => confirmAddSessionTag(String(v))"
                  @blur="tagPickerVisibleSession = false"
                />
              </template>
              <button
                v-else
                class="rounded border border-dashed border-[#d4d8e3] px-2 py-0.5 text-[11px] text-[#9ca3af] transition-colors hover:border-[#1a73e8] hover:text-[#1a73e8]"
                @click="showTagPicker('session')"
              >
                + 添加
              </button>
            </div>
          </div>

          <!-- 内部备注 -->
          <div class="mt-3">
            <div class="mb-1.5 flex items-center justify-between">
              <span class="text-[11px] text-[#9ca3af]">内部备注</span>
              <button
                class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-[#1a73e8] transition-colors hover:bg-[#eef1f8]"
                @click="noteModalVisible = true"
              >
                <Icon icon="lucide:plus" class="text-[12px]" />
                添加
              </button>
            </div>
            <div class="space-y-1.5">
              <div
                v-for="note in notes"
                :key="note.id"
                class="group flex items-start justify-between gap-2"
              >
                <p class="flex-1 text-[12px] leading-[1.6] text-[#0a0a0b]">
                  {{ note.content }}
                </p>
                <button
                  class="mt-0.5 shrink-0 text-[11px] text-[#d4d8e3] opacity-0 transition-all group-hover:opacity-100 hover:!text-red-400"
                  @click="deleteNote(note.id)"
                >
                  删除
                </button>
              </div>
              <p v-if="notes.length === 0" class="text-[11px] text-[#9ca3af]">
                暂无备注
              </p>
            </div>
          </div>
        </div>

        <div class="h-px w-full bg-[#e4e7ed]"></div>

        <!-- History sessions -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-[14px] font-medium text-[#0a0a0b]">历史会话</span>
            <span
              class="rounded-[9px] bg-[#f7f8fc] px-2 py-0.5 text-[12px] text-[#52525b]"
            >
              {{ visitorHistoryList.length }} 条记录
            </span>
          </div>

          <!-- Preview: latest 2 entries -->
          <div
            v-if="!visitorHistoryLoading && visitorHistoryList.length > 0"
            class="space-y-1.5"
          >
            <div
              v-for="item in visitorHistoryList.slice(0, 2)"
              :key="item.sessionId"
              class="flex items-center gap-1.5 rounded-lg bg-[#f7f8fc] px-2.5 py-2 text-[12px]"
            >
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                :style="
                  resolveTagColor(item.tag) === 'red'
                    ? 'background:#fff1f0;color:#cf1322'
                    : resolveTagColor(item.tag) === 'orange'
                      ? 'background:#fff7e6;color:#d46b08'
                      : 'background:#e8f0ff;color:#1a73e8'
                "
                >{{ item.tag }}</span
              >
              <span class="min-w-0 flex-1 truncate text-[#52525b]">{{
                item.transferReason
              }}</span>
              <span class="shrink-0 text-[#9ca3af]">{{
                formatShortDate(item.endedAt)
              }}</span>
            </div>
          </div>

          <!-- Empty state -->
          <div
            v-else-if="!visitorHistoryLoading"
            class="flex items-center gap-3 rounded-xl bg-[#fafbff] p-3.5"
          >
            <div
              class="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0f2f5] text-[16px]"
            >
              💬
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-medium text-[#0a0a0b]">暂无历史会话</p>
              <p class="mt-0.5 text-[11px] text-[#9ca3af]">
                该访客此前未发起过会话
              </p>
            </div>
          </div>

          <Button
            block
            size="small"
            :loading="visitorHistoryLoading"
            class="mt-0.5"
            @click="emit('openHistoryDrawer')"
          >
            <template #icon><Icon icon="lucide:history" /></template>
            查看全部会话
          </Button>
        </div>
      </template>

      <!-- ===== 已结束 / AI 旁观 只读信息 ===== -->
      <template v-else-if="closedView">
        <div class="rounded-xl bg-[#f7f8fc] p-3.5">
          <div class="flex items-center justify-between">
            <span class="text-[15px] font-medium text-[#0a0a0b]">会话信息</span>
            <span
              v-if="closedView.kind === 'ai'"
              class="rounded bg-[#e8f0ff] px-2 py-0.5 text-[12px] text-[#1a73e8]"
              >AI 处理中</span
            >
            <span
              v-else
              class="rounded bg-[#f0f2f5] px-2 py-0.5 text-[12px] text-[#9ca3af]"
              >已结束</span
            >
          </div>
          <div class="mt-3 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#52525b]">访客姓名</span>
              <span class="text-[13px] font-medium text-[#0a0a0b]">{{
                closedView.session.name
              }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#52525b]">会话编号</span>
              <span class="text-[13px] font-medium text-[#0a0a0b]"
                >#{{ closedView.session.id }}</span
              >
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[13px] text-[#52525b]">问题标签</span>
              <span
                class="rounded bg-[#f0f2f5] px-2 py-0.5 text-[11px] text-[#9ca3af]"
              >
                {{ closedView.session.tag || '未标记' }}
              </span>
            </div>
            <div
              v-if="closedView.kind !== 'ai'"
              class="flex items-center justify-between"
            >
              <span class="text-[13px] text-[#52525b]">结束时间</span>
              <span class="text-[13px] font-medium text-[#0a0a0b]">{{
                closedView.session.endedAt
              }}</span>
            </div>
          </div>
        </div>
        <div class="h-px w-full bg-[#e4e7ed]"></div>
        <div class="flex flex-col gap-2">
          <span class="text-[14px] font-medium text-[#0a0a0b]">转接原因</span>
          <div class="flex items-start gap-2.5 rounded-lg bg-[#fff0eb] p-3">
            <div
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fff2c7] text-[14px]"
            >
              💡
            </div>
            <p class="text-[12px] leading-[1.5] text-[#923b0e]">
              {{ closedView.session.transferReason || '—' }}
            </p>
          </div>
        </div>
      </template>
    </div>
    <!-- /主内容滚动区 -->

    <!-- AI 建议触发按钮：仅进行中会话显示 -->
    <button
      v-if="activeSession"
      class="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-[#1a73e8] px-3.5 py-2 text-[13px] font-medium text-white shadow-lg transition-all hover:bg-[#1763c4] hover:shadow-xl"
      @click="aiPanelOpen = true"
    >
      <Icon icon="lucide:zap" class="text-[14px]" />
      AI 回复建议
      <span
        v-if="replySuggestions.length"
        class="flex h-4 min-w-4 items-center justify-center rounded-full bg-white/30 px-1 text-[10px]"
        >{{ replySuggestions.length }}</span
      >
    </button>

    <!-- AI 建议悬浮层：absolute inset-0 覆盖整个右栏 -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="aiPanelOpen && activeSession"
        class="absolute inset-0 z-20 flex flex-col bg-white"
      >
        <!-- overlay header -->
        <div
          class="flex shrink-0 items-center justify-between border-b border-[#e4e7ed] px-4 py-3"
        >
          <div class="flex items-center gap-1.5">
            <Icon icon="lucide:zap" class="text-[#1a73e8]" />
            <span class="text-[14px] font-medium text-[#0a0a0b]"
              >AI 回复建议</span
            >
          </div>
          <button
            class="flex h-7 w-7 items-center justify-center rounded-full text-[#9ca3af] transition-colors hover:bg-[#f7f8fc] hover:text-[#0a0a0b]"
            @click="aiPanelOpen = false"
          >
            <Icon icon="lucide:x" class="text-[15px]" />
          </button>
        </div>

        <!-- panel content fills remaining height -->
        <AISuggestPanel
          :session-id="activeSession.id"
          :suggestions="replySuggestions"
          :loading="suggestionsLoading"
          :has-error="suggestionsError"
          class="min-h-0 flex-1"
          @apply="
            emit('applySuggestion', $event);
            aiPanelOpen = false;
          "
          @insert="
            emit('insertSuggestion', $event);
            aiPanelOpen = false;
          "
          @refresh="emit('refreshSuggestions')"
          @refresh-with-prompt="emit('refreshSuggestionsWithPrompt', $event)"
        />
      </div>
    </Transition>
  </aside>

  <!-- 添加备注弹窗 -->
  <Modal
    v-model:open="noteModalVisible"
    title="添加备注"
    ok-text="保存"
    cancel-text="取消"
    :confirm-loading="savingNote"
    @ok="saveNote"
    @cancel="newNoteContent = ''"
  >
    <Textarea
      v-model:value="newNoteContent"
      :rows="4"
      placeholder="输入备注内容..."
      class="!text-[13px]"
    />
  </Modal>
</template>
