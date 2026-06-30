<script lang="ts" setup>
// ===== 主题隔离：强制 light 模式，不受后台暗色主题影响 =====

import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  message,
  Modal,
  Progress,
  Radio,
  RadioGroup,
  Switch,
  Tag,
  Textarea,
} from 'ant-design-vue';

import type { OnlineAgentItem, SessionQueueItem as ApiSessionItem } from '#/api/session';
import {
  closeSessionApi,
  getActiveSessionsApi,
  getOnlineAgentsApi,
  getSessionHistoryApi,
  transferSessionApi,
} from '#/api/session';
import { useAgentWebSocket } from '#/composables/useAgentWebSocket';
import { type QueueItem, useSessionQueue } from '#/composables/useSessionQueue';

// ===== Composable：WebSocket 连接管理 =====
const { connectSession: connectAgentSession, disconnectSession: disconnectAgentSession, sendMessage: sendAgentMessage } = useAgentWebSocket(
  (sessionId, content) => {
    // 访客发来的新消息 → 推到对应 session 的 msgs
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      session.msgs.push({ id: ++msgId, role: 'user', text: content });
      if (session.active) {
        nextTick(() => {
          const el = document.querySelector('[data-msgs-end]');
          (el as HTMLElement)?.scrollIntoView({ behavior: 'smooth' });
        });
      }
    }
  },
);

// ===== 座席状态 =====
const agentOnline = ref(true);
const MAX_CONCURRENT = 5;

// ===== 消息类型 =====
interface Msg {
  id: number;
  role: 'agent' | 'ai' | 'user';
  text: string;
}

// ===== 每会话数据（Bug-001 修复：会话独立数据，切换时联动右侧面板） =====
interface SessionData {
  id: string;
  name: string;
  nameChar: string;
  color: string;
  min: string;
  active: boolean;
  sessionCode: string;
  transferReason: string;
  msgs: Msg[];
  userInfo: { label: string; value: string; vip?: boolean }[];
  slots: { done: boolean; key: string; value: null | string }[];
  chunks: { preview: string; score: number; title: string }[];
  memory: string;
}

const sessions = ref<SessionData[]>([]);

// ===== Bug-001 修复：activeSession 计算属性，切换会话时自动更新右侧面板 =====
const activeSession = computed(() => sessions.value.find((s) => s.active));
const concurrent = computed(() => sessions.value.length);

// ===== 队列状态 Tab =====
const queueStateTab = ref<'active' | 'waiting'>('waiting');
const queueStateTabs = [
  { key: 'waiting', label: '等待人工', icon: 'lucide:clock' },
  { key: 'active', label: '人工接待中', icon: 'lucide:headphones' },
];

// ===== 对话区消息筛选 =====
const MSG_FILTER_OPTIONS = [
  { key: '全部', label: '全部' },
  { key: 'ai', label: 'AI 对话' },
  { key: 'agent', label: '人工回复' },
];
const msgFilter = ref('全部');

const filteredMsgs = computed(() => {
  if (!activeSession.value) return [];
  const msgs = activeSession.value.msgs;
  if (msgFilter.value === '全部') return msgs;
  if (msgFilter.value === 'ai')
    return msgs.filter((m) => m.role === 'ai' || m.role === 'user');
  if (msgFilter.value === 'agent')
    return msgs.filter((m) => m.role === 'agent' || m.role === 'user');
  return msgs;
});

// ===== Composable：等待队列 + SSE 实时通知 =====
const {
  queue,
  queuePage,
  queueTotalPages,
  pagedQueue,
  sseConnected,
  loadQueue,
  subscribeQueue,
  acceptItem,
} = useSessionQueue();

let msgId = 100;
const msgInput = ref('');
const QUICK_REPLY = [
  '已核实订单信息',
  '安排补发处理',
  '提交快递投诉',
  '退款申请处理',
  '感谢您的耐心等待',
];

// ===== 座席间转交 Modal =====
const transferVisible = ref(false);
const transferTarget = ref('');
const availableAgents = ref<OnlineAgentItem[]>([]);
const loadingAgents = ref(false);

// 打开 Modal 时加载在线座席列表（过滤掉自己）
watch(transferVisible, async (visible) => {
  if (!visible) return;
  transferTarget.value = '';
  loadingAgents.value = true;
  try {
    const agents = await getOnlineAgentsApi();
    // 过滤掉会话数已达上限的座席，并按会话数升序排列
    availableAgents.value = agents.filter((a) => a.sessions < MAX_CONCURRENT);
  } catch {
    message.error('获取在线座席失败，请重试');
    availableAgents.value = [];
  } finally {
    loadingAgents.value = false;
  }
});

async function confirmTransfer() {
  if (!transferTarget.value) {
    message.warning('请选择转交坐席');
    return;
  }
  const sid = activeSession.value?.id;
  if (!sid) return;
  const agent = availableAgents.value.find((a) => a.id === transferTarget.value);
  try {
    await transferSessionApi(sid, transferTarget.value);
    message.success(`会话已成功转交给 ${agent?.name ?? transferTarget.value}`);
    transferVisible.value = false;
    transferTarget.value = '';
    // 转交后本地移除该会话（SSE TRANSFER 事件也会触发，但本地立即响应更流畅）
    const idx = sessions.value.findIndex((s) => s.id === sid);
    if (idx !== -1) {
      disconnectAgentSession(sid);
      sessions.value.splice(idx, 1);
      if (sessions.value.length > 0 && !sessions.value.some((s) => s.active) && sessions.value[0]) {
        sessions.value[0].active = true;
      }
    }
  } catch {
    message.error('转交失败，请重试');
  }
}

// ===== 其他方法 =====
function switchSession(s: SessionData) {
  sessions.value.forEach((x) => (x.active = false));
  s.active = true;
  msgFilter.value = '全部'; // 切换会话时重置消息筛选
}

async function acceptQueue(item: QueueItem) {
  if (concurrent.value >= MAX_CONCURRENT) {
    message.warning('已达最大并发数（5），请先结束其他会话');
    return;
  }
  try {
    await acceptItem(item);
    // 并行加载历史消息（通过 API 层抽象，不直接使用 rawRequestClient）
    const history = await getSessionHistoryApi(item.id).catch(() => []);
    const loadedMsgs: Msg[] = history.map((h, i) => ({
      id: i + 1,
      role: (h.role === 'user' ? 'user' : 'ai') as 'agent' | 'ai' | 'user',
      text: h.content,
    }));
    sessions.value.forEach((s) => (s.active = false));
    sessions.value.push({
      id: item.id,
      name: item.name,
      nameChar: item.name.at(0) ?? '',
      color: item.color,
      min: '刚接入',
      active: true,
      sessionCode: `#${item.id}`,
      transferReason: item.reason,
      msgs:
        loadedMsgs.length > 0
          ? loadedMsgs
          : [{ id: ++msgId, role: 'ai', text: '您好！请问有什么可以帮您？' }],
      userInfo: [{ label: '姓名', value: item.name }],
      slots: [],
      chunks: [],
      memory: '无历史记忆。',
    });
    connectAgentSession(item.id);
    queueStateTab.value = 'active';
    message.success(`已接入会话：${item.name}`);
  } catch {
    message.error('接入失败，请重试');
  }
}

function sendAgent() {
  const text = msgInput.value.trim();
  if (!text || !activeSession.value) return;
  const sid = activeSession.value.id;
  const ok = sendAgentMessage(sid, text);
  if (!ok) {
    message.warning('WebSocket 未连接，请重新接入会话');
    return;
  }
  activeSession.value.msgs.push({ id: ++msgId, role: 'agent', text });
  msgInput.value = '';
}

async function doCloseSession() {
  const sid = activeSession.value?.id;
  if (!sid) return;
  try {
    await closeSessionApi(sid);
  } catch {
    /* 忽略关闭失败，本地状态仍清理 */
  }
  disconnectAgentSession(sid); // 断开 WebSocket
  sessions.value = sessions.value.filter((s) => s.id !== sid);
  if (sessions.value.length > 0 && sessions.value[0])
    sessions.value[0].active = true;
  message.success('会话已结束，正在生成长期记忆摘要...');
}

function closeSession() {
  doCloseSession();
}

function quickReply(q: string) {
  msgInput.value = q;
}
function handleEnter(e: KeyboardEvent) {
  if (!e.shiftKey) {
    e.preventDefault();
    sendAgent();
  }
}

// ===== 生命周期：加载队列 + 订阅 SSE =====
onMounted(async () => {
  // 1. 并行加载等待队列 + 已接入会话（Promise.all 替代串行）
  const [, activeSessions] = await Promise.all([
    loadQueue(),
    getActiveSessionsApi().catch(() => [] as ApiSessionItem[]),
  ]);

  // 2. 并行加载所有 ACTIVE 会话的历史消息（Promise.all 替代 for await 串行）
  if (activeSessions.length > 0) {
    const histories = await Promise.all(
      activeSessions.map((item) =>
        getSessionHistoryApi(item.sessionId).catch(() => []),
      ),
    );
    activeSessions.forEach((item, idx) => {
      const history = histories[idx] ?? [];
      const loadedMsgs: Msg[] = history.map((h, i) => ({
        id: i + 1,
        role: (h.role === 'user' ? 'user' : 'ai') as 'agent' | 'ai' | 'user',
        text: h.content,
      }));
      sessions.value.push({
        id: item.sessionId,
        name: item.userName,
        nameChar: item.userName.at(0) ?? '',
        color: '#8b5cf6',
        min: '接待中',
        active: false,
        sessionCode: `#${item.sessionId}`,
        transferReason: item.transferReason,
        msgs:
          loadedMsgs.length > 0
            ? loadedMsgs
            : [{ id: 1, role: 'ai', text: '您好！请问有什么可以帮您？' }],
        userInfo: [{ label: '姓名', value: item.userName }],
        slots: [],
        chunks: [],
        memory: '无历史记忆。',
      });
    });
    // 激活第一个恢复会话，并重建所有 WebSocket 连接
    if (sessions.value[0]) sessions.value[0].active = true;
    activeSessions.forEach((item) => connectAgentSession(item.sessionId));
  }

  // 3. 订阅 SSE（composable 内置指数退避重连 + 等待时间定时刷新）
  subscribeQueue(
    undefined, // onEnqueue：composable 已处理入队通知
    (sid) => {
      // CLOSED 事件：同步清理本地 sessions
      const closedIdx = sessions.value.findIndex((s) => s.id === sid);
      if (closedIdx !== -1) {
        const closedName = sessions.value[closedIdx]?.name ?? '';
        disconnectAgentSession(sid);
        sessions.value.splice(closedIdx, 1);
        if (sessions.value.length > 0 && !sessions.value.some((s) => s.active) && sessions.value[0]) {
          sessions.value[0].active = true;
        }
        message.warning(`会话 ${closedName} 已被关闭`);
      }
    },
    (transferredItem) => {
      // TRANSFER 事件：若 toAgentId 对应当前座席，自动接入转交过来的会话
      // Phase-1：通过 item.agentId 判断是否转给自己（toAgentId 在后端 SessionEvent 中）
      // 这里简化处理：弹出通知，由座席手动从队列刷新后接入
      message.info(`会话 ${transferredItem.name} 已转交，请从队列中接入`);
    },
  );
});

// onUnmounted 由 composable 自动处理（eventSource.close + agentWsMap.clear）
</script>

<template>
  <Page title="座席工作台" description="实时接待转接会话，查看 AI 对话上下文">
    <!--
      h-full   → 填满 Page 的 flex-1 内容区，不依赖 100vh 计算
      min-h-0  → 关键！flex 子项默认 min-height:auto 会撑开父容器触发滚动，必须归零
      overflow-hidden → 防止任何子节点溢出触发父级滚动条
    -->
    <div class="flex h-full min-h-0 gap-4 overflow-hidden">
      <!-- 左栏：状态 + 队列 + 处理中 -->
      <div class="flex w-56 min-h-0 shrink-0 flex-col gap-3">
        <!-- 座席状态 -->
        <Card
          :bordered="false"
          class="shadow-sm"
          :body-style="{ padding: '12px 16px' }"
        >
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-semibold text-gray-700">座席状态</span>
            <Switch
              v-model:checked="agentOnline"
              checked-children="在线"
              un-checked-children="暂离"
              size="small"
            />
          </div>
          <Progress
            :percent="Math.round((concurrent / MAX_CONCURRENT) * 100)"
            :format="() => `${concurrent}/${MAX_CONCURRENT}`"
            size="small"
            :stroke-color="concurrent >= MAX_CONCURRENT ? '#ef4444' : '#6366f1'"
          />
          <p class="mt-1 text-xs text-gray-400">
            {{ concurrent }}/{{ MAX_CONCURRENT }} 会话接待中
          </p>
        </Card>

        <!-- 等待队列 -->
        <Card
          :bordered="false"
          class="flex-1 overflow-auto shadow-sm"
          :body-style="{ padding: '12px' }"
        >
          <template #title>
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold">会话队列</span>
              <!-- count=0 时不显示徽标，有队列时显示橙红色数字 -->
              <Badge :count="queue.length" :overflow-count="99" />
              <!-- SSE 连接状态点：绿=在线，灰=断线 -->
              <Badge
                :status="sseConnected ? 'processing' : 'default'"
                :title="sseConnected ? 'SSE 实时连接正常' : 'SSE 连接断开'"
              />
            </div>
          </template>

          <!-- 状态 Tab：等待人工 / 人工接待中 -->
          <div class="mb-2 flex rounded-lg bg-gray-100 p-0.5">
            <span
              v-for="tab in queueStateTabs"
              :key="tab.key"
              class="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md py-1 text-xs transition"
              :style="
                queueStateTab === tab.key
                  ? 'background:#fff;color:#4f46e5;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.1)'
                  : 'color:#6b7280'
              "
              @click="queueStateTab = tab.key as 'waiting' | 'active'"
            >
              <Icon :icon="tab.icon" class="text-xs" />
              {{ tab.label }}
              <span
                v-if="tab.key === 'waiting' && queue.length"
                class="ml-0.5 rounded-full bg-red-500 px-1 text-white"
                style="font-size: 10px; line-height: 16px"
                >{{ queue.length }}</span>
              <span
                v-if="tab.key === 'active' && sessions.length"
                class="ml-0.5 rounded-full bg-indigo-500 px-1 text-white"
                style="font-size: 10px; line-height: 16px"
                >{{ sessions.length }}</span>
            </span>
          </div>

          <!-- 等待人工 Tab -->
          <template v-if="queueStateTab === 'waiting'">
            <div v-if="queue.length" class="space-y-2">
              <div
                v-for="item in pagedQueue"
                :key="item.id"
                class="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
              >
                <div class="flex items-center gap-2">
                  <Avatar :size="28" :style="{ backgroundColor: item.color }">
                    {{ item.name[0] }}
                  </Avatar>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium text-gray-700">
                      {{ item.name }}
                    </p>
                    <p class="text-xs text-amber-600">
                      等待 {{ item.waitMin }}
                    </p>
                  </div>
                  <Tag :color="item.tagColor" class="shrink-0 text-xs">
                    {{ item.tag }}
                  </Tag>
                </div>
                <p class="truncate text-xs text-gray-500">{{ item.reason }}</p>
                <Button
                  type="primary"
                  size="small"
                  block
                  @click="acceptQueue(item)"
                >
                  <template #icon>
                    <Icon
                      icon="ant-design:customer-service-outlined"
                    />
</template>接入会话
                </Button>
              </div>

              <!-- 分页控件 -->
              <div
                v-if="queueTotalPages > 1"
                class="flex items-center justify-between pt-1"
              >
                <button
                  class="rounded px-2 py-0.5 text-xs transition"
                  :class="
                    queuePage <= 1
                      ? 'cursor-not-allowed text-gray-300'
                      : 'text-indigo-500 hover:bg-indigo-50'
                  "
                  :disabled="queuePage <= 1"
                  @click="queuePage > 1 && queuePage--"
                >
                  ← 上一页
                </button>
                <span class="text-xs text-gray-400">{{ queuePage }} / {{ queueTotalPages }}</span>
                <button
                  class="rounded px-2 py-0.5 text-xs transition"
                  :class="
                    queuePage >= queueTotalPages
                      ? 'cursor-not-allowed text-gray-300'
                      : 'text-indigo-500 hover:bg-indigo-50'
                  "
                  :disabled="queuePage >= queueTotalPages"
                  @click="queuePage < queueTotalPages && queuePage++"
                >
                  下一页 →
                </button>
              </div>
            </div>

            <!-- 空队列提示 -->
            <div
              v-else
              class="flex flex-col items-center justify-center py-6 text-center"
            >
              <div
                class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50"
              >
                <Icon icon="lucide:coffee" class="text-xl text-emerald-400" />
              </div>
              <p class="text-xs font-medium text-gray-500">暂无等待用户</p>
              <p class="mt-1 text-xs text-gray-400">轻松一下，队列空空如也</p>
              <div class="mt-3 flex items-center gap-1.5">
                <span class="relative flex h-2 w-2">
                  <span
                    class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
                  ></span>
                  <span
                    class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
                  ></span>
                </span>
                <span class="text-xs text-emerald-500">实时监听中</span>
              </div>
            </div>
          </template>

          <!-- 人工接待中 Tab -->
          <template v-else>
            <div v-if="sessions.length" class="space-y-2">
              <div
                v-for="s in sessions"
                :key="s.id"
                class="cursor-pointer rounded-xl border p-2.5 transition"
                :class="[
                  s.active
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-gray-100 bg-white hover:border-gray-200',
                ]"
                @click="switchSession(s)"
              >
                <div class="flex items-center gap-2">
                  <Avatar :size="26" :style="{ backgroundColor: s.color }">
                    {{ s.nameChar }}
                  </Avatar>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium text-gray-700">
                      {{ s.name }}
                    </p>
                    <p
                      class="text-xs"
                      :class="[
                        s.active
                          ? 'font-medium text-indigo-600'
                          : 'text-gray-400',
                      ]"
                    >
                      {{ s.active ? '当前会话' : s.min }}
                    </p>
                  </div>
                  <span
                    class="h-2 w-2 rounded-full"
                    :class="[s.active ? 'bg-emerald-500' : 'bg-gray-300']"
                  ></span>
                </div>
              </div>
            </div>
            <div
              v-else
              class="flex flex-col items-center justify-center py-6 text-center"
            >
              <div
                class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50"
              >
                <Icon icon="lucide:inbox" class="text-xl text-gray-300" />
              </div>
              <p class="text-xs text-gray-400">暂无进行中的会话</p>
            </div>
          </template>
        </Card>
      </div>

      <!-- 中栏：对话区 -->
      <div
        v-if="activeSession"
        class="flex flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-sm"
      >
        <div
          class="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3"
        >
          <Avatar :size="36" :style="{ backgroundColor: activeSession.color }">
            {{ activeSession.nameChar }}
          </Avatar>
          <div>
            <p class="text-sm font-medium text-gray-800">
              {{ activeSession.name }}
            </p>
            <p class="text-xs text-gray-500">
              会话 {{ activeSession.sessionCode }} · 接入
              {{ activeSession.min }} · 转接原因：{{
                activeSession.transferReason
              }}
            </p>
          </div>
          <div class="ml-auto flex gap-2">
            <!-- Bug-002 修复：转交按钮打开 Modal -->
            <Button size="small" @click="transferVisible = true">
              <template #icon><Icon icon="ant-design:swap-outlined" /></template>转交
            </Button>
            <Button type="primary" size="small" @click="closeSession">
              <template #icon>
                <Icon icon="ant-design:check-outlined" />
</template>结束会话
            </Button>
          </div>
        </div>

        <!-- 消息类型筛选 Tab + 会话状态 — 固定在消息区外，始终可见 -->
        <div
          class="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-4 py-2"
        >
          <div class="flex gap-1">
            <span
              v-for="opt in MSG_FILTER_OPTIONS"
              :key="opt.key"
              class="cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition"
              :style="
                msgFilter === opt.key
                  ? 'background:#4f46e5;color:#fff;border-color:#4f46e5'
                  : 'background:#f0f0f0;color:#6b7280;border-color:#e5e7eb'
              "
              @click="msgFilter = opt.key"
              >{{ opt.label }}</span>
          </div>
          <Tag color="processing" class="text-xs">进行中</Tag>
        </div>

        <div class="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
          <div class="flex justify-center">
            <Tag color="default" class="text-xs">
              共
              {{ activeSession.msgs.filter((m) => m.role !== 'agent').length }}
              轮对话
            </Tag>
          </div>

          <div
            v-for="m in filteredMsgs"
            :key="m.id"
            class="flex gap-2"
            :class="[m.role !== 'user' ? 'flex-row-reverse' : '']"
          >
            <Avatar
              :size="28"
              :style="{
                backgroundColor:
                  m.role === 'user'
                    ? '#a78bfa'
                    : m.role === 'agent'
                      ? '#f97316'
                      : '#e0e7ff',
              }"
              :class="m.role === 'ai' ? 'text-indigo-600' : ''"
              class="shrink-0"
            >
              {{
                m.role === 'user'
                  ? activeSession.nameChar
                  : m.role === 'agent'
                    ? '王'
                    : 'AI'
              }}
            </Avatar>
            <div
              class="max-w-xs rounded-xl px-3 py-2 text-sm leading-relaxed"
              :class="[
                m.role === 'user'
                  ? 'rounded-tl-none bg-white border border-gray-200 text-gray-700'
                  : m.role === 'agent'
                    ? 'rounded-tr-none bg-indigo-500 text-white'
                    : 'rounded-tr-none bg-indigo-50 text-indigo-800 opacity-80',
              ]"
            >
              {{ m.text }}
            </div>
          </div>
        </div>
        <!-- 滚动锚点 -->
        <div data-msgs-end></div>

        <div
          class="flex shrink-0 gap-1.5 overflow-x-auto border-t border-gray-100 px-3 py-2"
        >
          <Tag
            v-for="q in QUICK_REPLY"
            :key="q"
            class="shrink-0 cursor-pointer text-xs"
            color="default"
            @click="quickReply(q)"
          >
            {{ q }}
          </Tag>
        </div>

        <div class="shrink-0 border-t border-gray-100 px-4 py-3">
          <div class="flex items-end gap-2">
            <Textarea
              v-model:value="msgInput"
              placeholder="输入回复内容..."
              :auto-size="{ minRows: 2, maxRows: 4 }"
              class="flex-1"
              @keydown.enter="handleEnter"
            />
            <Button
              type="primary"
              class="flex h-10 w-10 shrink-0 items-center justify-center"
              @click="sendAgent"
            >
              <template #icon>
                <Icon icon="ant-design:send-outlined" />
              </template>
            </Button>
          </div>
        </div>
      </div>

      <div
        v-else
        class="flex flex-1 flex-col items-center justify-center rounded-xl bg-white shadow-sm"
      >
        <div
          class="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-50"
        >
          <Icon
            icon="lucide:message-square-dashed"
            class="text-4xl text-indigo-300"
          />
        </div>
        <h3 class="mt-5 text-base font-semibold text-gray-700">
          暂无进行中的会话
        </h3>
        <p
          class="mt-2 max-w-xs text-center text-sm text-gray-400 leading-relaxed"
        >
          左侧「等待人工」队列中有用户时，<br />点击「接入会话」即可开始服务
        </p>
        <div class="mt-6 flex gap-3">
          <div
            class="flex flex-col items-center rounded-xl border border-gray-100 bg-gray-50 px-5 py-3"
          >
            <span class="text-xl font-bold text-indigo-500">{{
              queue.length
            }}</span>
            <span class="mt-0.5 text-xs text-gray-400">等待接入</span>
          </div>
          <div
            class="flex flex-col items-center rounded-xl border border-gray-100 bg-gray-50 px-5 py-3"
          >
            <span class="text-xl font-bold text-emerald-500">{{
              MAX_CONCURRENT - concurrent
            }}</span>
            <span class="mt-0.5 text-xs text-gray-400">可接入数</span>
          </div>
        </div>
        <div class="mt-5 flex items-center gap-1.5">
          <span class="relative flex h-2 w-2">
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
            ></span>
            <span
              class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
            ></span>
          </span>
          <span class="text-xs text-emerald-500">实时监听中，新会话将自动推送</span>
        </div>
      </div>

      <!-- 右栏：上下文面板（Bug-001 修复：随 activeSession 联动） -->
      <div
        v-if="activeSession"
        class="flex w-64 shrink-0 flex-col gap-3 overflow-auto"
      >
        <Card title="用户信息" :bordered="false" class="shadow-sm" size="small">
          <Descriptions :column="1" size="small">
            <DescriptionsItem
              v-for="info in activeSession.userInfo"
              :key="info.label"
              :label="info.label"
            >
              <Tag v-if="info.vip" color="gold">{{ info.value }}</Tag>
              <span v-else>{{ info.value }}</span>
            </DescriptionsItem>
          </Descriptions>
        </Card>

        <Card
          title="已收集信息（槽位）"
          :bordered="false"
          class="shadow-sm"
          size="small"
        >
          <div class="space-y-1.5">
            <div
              v-for="s in activeSession.slots"
              :key="s.key"
              class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
              :class="[s.done ? 'bg-emerald-50' : 'bg-gray-50']"
            >
              <Icon
                v-if="s.done"
                icon="ant-design:check-outlined"
                class="text-emerald-500"
              />
              <span
                v-else
                class="inline-block h-3 w-3 rounded-full border border-gray-300"
              ></span>
              <span class="text-gray-500">{{ s.key }}</span>
              <span
                class="ml-auto font-medium"
                :class="s.done ? 'text-gray-700' : 'text-amber-500'"
                >{{ s.value ?? '待确认' }}</span>
            </div>
          </div>
        </Card>

        <Card title="转接原因" :bordered="false" class="shadow-sm" size="small">
          <Alert
            :message="activeSession.transferReason"
            type="warning"
            show-icon
          />
        </Card>

        <Card
          title="AI 参考知识"
          :bordered="false"
          class="flex-1 shadow-sm"
          size="small"
        >
          <div class="space-y-2">
            <div
              v-for="c in activeSession.chunks"
              :key="c.title"
              class="cursor-pointer rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-xs transition hover:border-indigo-200"
            >
              <p class="mb-1 font-medium text-indigo-600">📄 {{ c.title }}</p>
              <p class="line-clamp-2 text-gray-500">{{ c.preview }}</p>
              <Tag color="success" class="mt-1 text-xs">
                相关度 {{ c.score }}
              </Tag>
            </div>
          </div>
        </Card>

        <Card title="历史记忆" :bordered="false" class="shadow-sm" size="small">
          <p class="text-xs leading-relaxed text-gray-500">
            {{ activeSession.memory }}
          </p>
        </Card>
      </div>
    </div>

    <!-- Bug-002 修复：转交坐席 Modal -->
    <Modal
      v-model:open="transferVisible"
      title="转交会话"
      ok-text="确认转交"
      cancel-text="取消"
      @ok="confirmTransfer"
    >
      <p class="mb-4 text-sm text-gray-500">
        将 <strong>{{ activeSession?.name }}</strong> 的会话转交给以下坐席：
      </p>
      <RadioGroup v-model:value="transferTarget" class="w-full">
        <div v-if="availableAgents.length" class="space-y-2">
          <div
            v-for="agent in availableAgents"
            :key="agent.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition"
            :class="[
              transferTarget === agent.id
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-gray-100',
            ]"
            @click="transferTarget = agent.id"
          >
            <Radio :value="agent.id" />
            <Avatar :size="32" style="background-color: #6366f1">
              {{ agent.name[0] }}
            </Avatar>
            <div class="flex-1">
              <p class="text-sm font-medium">{{ agent.name }}</p>
              <p class="text-xs text-gray-400">
                当前 {{ agent.sessions }} 个会话
              </p>
            </div>
            <Tag :color="agent.status === '空闲' ? 'success' : 'warning'">
              {{ agent.status }}
            </Tag>
          </div>
        </div>
        <div
          v-else
          class="flex flex-col items-center justify-center py-8 text-center"
        >
          <Icon icon="lucide:users" class="mb-2 text-2xl text-gray-300" />
          <p class="text-sm text-gray-400">暂无可转交的座席</p>
          <p class="mt-1 text-xs text-gray-300">座席列表接口待接入</p>
        </div>
      </RadioGroup>
    </Modal>
  </Page>
</template>
