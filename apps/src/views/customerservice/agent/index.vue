<script lang="ts" setup>
// ===== 主题隔离：强制 light 模式，不受后台暗色主题影响 =====

import type {
  SessionQueueItem as ApiSessionItem,
  OnlineAgentItem,
  SessionSseEvent,
} from '#/api/session';
import type { QueueItem } from '#/composables/useSessionQueue';

import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import { Icon } from '@iconify/vue';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Input,
  message,
  Modal,
  Progress,
  Radio,
  RadioGroup,
  Spin,
  Switch,
  Tag,
  Textarea,
} from 'ant-design-vue';
import { marked } from 'marked';

import {
  closeSessionApi,
  getActiveSessionsApi,
  getClosedSessionsApi,
  getOnlineAgentsApi,
  getSessionHistoryApi,
  transferSessionApi,
} from '#/api/session';
import { useAgentWebSocket } from '#/composables/useAgentWebSocket';
import {
  formatWaitTime,
  resolveTagColor,
  useSessionQueue,
} from '#/composables/useSessionQueue';

// ===== 当前座席身份（与后端 resolveAgentId 保持一致：token 即 agentId）=====
const accessStore = useAccessStore();
const currentAgentId = computed(() => accessStore.accessToken ?? '');

// ===== 座席端 lastSeq 跟踪（按 sessionId 隔离，localStorage 跨重启持久化） =====
const LAST_SEQ_KEY_PREFIX = 'agent_last_seq_';

function readLastSeq(sid: string): number {
  const raw = localStorage.getItem(LAST_SEQ_KEY_PREFIX + sid);
  if (!raw) return 0;
  const n = Number(raw);
  // 非有限数（NaN / Infinity）或负数视为脏数据，重置为 0
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function writeLastSeq(sid: string, newSeq: number) {
  if (!Number.isFinite(newSeq) || newSeq <= 0) return;
  const current = readLastSeq(sid);
  if (newSeq > current) {
    localStorage.setItem(LAST_SEQ_KEY_PREFIX + sid, String(newSeq));
  }
}

/**
 * 按 sessionId 拉增量历史，补齐 WS 断线期间漏收的访客消息。
 *
 * 实现要点：
 * - 入口快照 sinceSeq，避免 fetch 进行中 WS 推送写入更大 lastSeq 导致误判跳过本批
 * - 按 sessionId 维度并发锁，防止短时间多次重连发起多次请求
 * - 仅渲染 user 角色（座席自己的消息由本地 echo 显示，AI 不参与座席端会话）
 * - null/空 content 跳过
 */
const fetchInflight = new Set<string>();
async function fetchMissingForSession(sid: string) {
  if (fetchInflight.has(sid)) return;
  const sinceSeqSnapshot = readLastSeq(sid);
  if (sinceSeqSnapshot <= 0) return;
  fetchInflight.add(sid);
  try {
    const missing = await getSessionHistoryApi(sid, sinceSeqSnapshot);
    const session = sessions.value.find((s) => s.id === sid);
    if (!session) return;
    for (const item of missing) {
      // 后端 JacksonLongToStringConfig 将 Long 序列化为字符串，统一 Number() 归一化
      const seqNum =
        item.seq === null || item.seq === undefined
          ? Number.NaN
          : Number(item.seq);
      if (!Number.isFinite(seqNum) || seqNum <= sinceSeqSnapshot) continue;
      if (!item.content) continue;
      if (item.role === 'user') {
        session.msgs.push({
          id: ++msgId,
          role: 'user',
          text: item.content,
          time: nowTime(),
        });
      }
      writeLastSeq(sid, seqNum);
    }
  } catch (error) {
    console.warn('[WS:Agent] fetchMissingForSession failed', sid, error);
  } finally {
    fetchInflight.delete(sid);
  }
}

// ===== Composable：WebSocket 连接管理 =====
const {
  connectSession: connectAgentSession,
  disconnectSession: disconnectAgentSession,
  sendMessage: sendAgentMessage,
  getStatus: getAgentWsStatus,
} = useAgentWebSocket({
  onUserMessage: (sessionId, msg) => {
    // 跟踪 seq：每条 MESSAGE 都更新 lastSeq，重连时凭此拉增量
    // 后端 Long 序列化为 string，需归一化
    if (msg.seq !== null && msg.seq !== undefined) {
      const seqNum = Number(msg.seq);
      if (Number.isFinite(seqNum)) writeLastSeq(sessionId, seqNum);
    }
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      session.msgs.push({
        id: ++msgId,
        role: 'user',
        text: msg.content ?? '',
        time: nowTime(),
      });
      if (session.active) {
        nextTick(() => {
          const el = document.querySelector('[data-msgs-end]');
          (el as HTMLElement)?.scrollIntoView({ behavior: 'smooth' });
        });
      }
    }
  },
  onReconnect: (sessionId) => {
    // WS 连接成功（含首次连接和重连），按 sessionId 凭 lastSeq 拉增量
    void fetchMissingForSession(sessionId);
  },
});

// ===== 当前会话 WS 连接状态（状态点 + 断线提示） =====
const activeWsStatus = computed(() =>
  activeSession.value ? getAgentWsStatus(activeSession.value.id) : 'closed',
);
const wsStatusMeta = computed(() => {
  switch (activeWsStatus.value) {
    case 'connecting': {
      return { color: '#f59e0b', text: '连接中' };
    }
    case 'open': {
      return { color: '#10b981', text: '已连接' };
    }
    default: {
      return { color: '#ef4444', text: '已断开' };
    }
  }
});

/** 历史/事件消息角色 → 前端 Msg.role（system 居中提示，其余按角色渲染） */
function mapMsgRole(role: string | undefined): Msg['role'] {
  if (role === 'user') return 'user';
  if (role === 'agent') return 'agent';
  if (role === 'system') return 'system';
  return 'ai';
}

// ===== 队列搜索（客户端过滤：姓名 / 标签 / 会话编号） =====
const queueSearch = ref('');
function matchKeyword(
  keyword: string,
  ...fields: (string | undefined)[]
): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(k));
}
const visiblePagedQueue = computed(() =>
  pagedQueue.value.filter((q) =>
    matchKeyword(queueSearch.value, q.name, q.tag, q.id),
  ),
);
const visibleSessions = computed(() =>
  sessions.value.filter((s) =>
    matchKeyword(queueSearch.value, s.name, s.tag, s.sessionCode, s.id),
  ),
);

// ===== 结束会话确认弹窗 =====
const closeConfirmVisible = ref(false);
function requestCloseSession() {
  if (!activeSession.value) return;
  closeConfirmVisible.value = true;
}
async function confirmCloseSession() {
  closeConfirmVisible.value = false;
  await doCloseSession();
}

// ===== SSE 事件处理（命名函数：onMounted 订阅与手动重连复用） =====
function handleQueueClosed(sid: string) {
  const closedIdx = sessions.value.findIndex((s) => s.id === sid);
  if (closedIdx !== -1) {
    const closedName = sessions.value[closedIdx]?.name ?? '';
    disconnectAgentSession(sid);
    sessions.value.splice(closedIdx, 1);
    if (
      sessions.value.length > 0 &&
      !sessions.value.some((s) => s.active) &&
      sessions.value[0]
    ) {
      sessions.value[0].active = true;
    }
    message.warning(`会话 ${closedName} 已被关闭`);
  }
}
async function handleQueueTransfer(event: SessionSseEvent) {
  const myId = currentAgentId.value;
  const sid = event.item.sessionId;
  if (!myId) return;
  // 发起方：本地已在 confirmTransfer 中清理，保持静默
  if (event.fromAgentId === myId) return;
  // 接收方：自动接入转交过来的会话
  if (event.toAgentId === myId) {
    if (sessions.value.some((s) => s.id === sid)) return;
    if (concurrent.value >= MAX_CONCURRENT) {
      message.warning(`收到转交会话 ${event.item.userName}，但已达最大并发数`);
      return;
    }
    try {
      await addSessionLocal({
        id: sid,
        name: event.item.userName,
        color: '#8b5cf6',
        transferReason: event.item.transferReason,
        minLabel: '刚转入',
        tag: event.item.tag,
        waitSince: event.item.waitSince,
      });
      queueStateTab.value = 'active';
      message.success(`已自动接入转交会话：${event.item.userName}`);
    } catch {
      message.error('自动接入转交会话失败');
    }
  }
}
function reconnectQueue() {
  subscribeQueue(undefined, handleQueueClosed, handleQueueTransfer);
}
function reconnectActiveSession() {
  const sid = activeSession.value?.id;
  if (sid) connectAgentSession(sid);
}

// ===== 座席状态 =====
const agentOnline = ref(true);
const MAX_CONCURRENT = 5;

// ===== 消息类型 =====
interface Msg {
  id: number;
  role: 'agent' | 'ai' | 'system' | 'user';
  text: string;
  time?: string;
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function copyMsgText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败');
  }
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
  /** 问题标签（来自转人工请求，后端唯一真实字段） */
  tag: string;
  /** 入队时间戳（epoch 秒），用于派生「排队时长」 */
  waitSince: number;
  msgs: Msg[];
}

const sessions = ref<SessionData[]>([]);

// ===== Bug-001 修复：activeSession 计算属性，切换会话时自动更新右侧面板 =====
const activeSession = computed(() => sessions.value.find((s) => s.active));
const concurrent = computed(() => sessions.value.length);

// ===== 队列状态 Tab =====
const queueStateTab = ref<'active' | 'closed' | 'waiting'>('waiting');
const queueStateTabs = [
  { key: 'waiting', label: '等待人工', icon: 'lucide:clock' },
  { key: 'active', label: '人工接待中', icon: 'lucide:headphones' },
  { key: 'closed', label: '已结束', icon: 'lucide:archive' },
];

// ===== 已结束会话 =====
interface ClosedSessionItem {
  id: string;
  name: string;
  nameChar: string;
  endedAt: string;
  transferReason: string;
  tag: string;
}
const closedSessions = ref<ClosedSessionItem[]>([]);
const closedLoading = ref(false);

/** 当前正在只读查看的已结束会话 */
const closedView = ref<null | {
  msgs: Msg[];
  session: ClosedSessionItem;
}>(null);
const closedViewLoading = ref(false);

async function loadClosedSessions() {
  closedLoading.value = true;
  try {
    const list = await getClosedSessionsApi();
    closedSessions.value = list.map((item) => ({
      id: item.sessionId,
      name: item.userName,
      nameChar: item.userName.at(0) ?? '?',
      endedAt:
        item.waitSince > 0
          ? new Date(item.waitSince * 1000).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
      transferReason: item.transferReason,
      tag: item.tag,
    }));
  } catch {
    message.error('加载历史会话失败');
  } finally {
    closedLoading.value = false;
  }
}

async function viewClosedSession(item: ClosedSessionItem) {
  closedViewLoading.value = true;
  closedView.value = { session: item, msgs: [] };
  try {
    const history = await getSessionHistoryApi(item.id, 0);
    closedView.value.msgs = history
      .filter((h) => h.role !== 'tool')
      .map((h) => ({
        id: ++msgId,
        role: mapMsgRole(h.role),
        text: h.content ?? '',
        time: h.timestamp
          ? new Date(Number(h.timestamp)).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : undefined,
      }));
  } catch {
    message.error('加载会话记录失败');
  } finally {
    closedViewLoading.value = false;
  }
}

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

// 切换到「已结束」Tab 时懒加载一次
watch(queueStateTab, (tab) => {
  if (tab === 'closed' && closedSessions.value.length === 0) {
    void loadClosedSessions();
  }
  // 切走时清除只读视图，节省内存
  if (tab !== 'closed') {
    closedView.value = null;
  }
});

// 打开 Modal 时加载在线座席列表
// 过滤规则：① 排除当前座席自己；② 排除已达并发上限的座席
// 排序规则：按当前会话数升序，引导转给负载较低的同事
watch(transferVisible, async (visible) => {
  if (!visible) return;
  // 重置状态，防止上次的数据闪烁
  transferTarget.value = '';
  availableAgents.value = [];
  loadingAgents.value = true;
  try {
    const agents = await getOnlineAgentsApi();
    availableAgents.value = agents
      .filter(
        (a) => a.id !== currentAgentId.value && a.sessions < MAX_CONCURRENT,
      )
      .toSorted((a, b) => a.sessions - b.sessions);
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
  const agent = availableAgents.value.find(
    (a) => a.id === transferTarget.value,
  );
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
      if (
        sessions.value.length > 0 &&
        !sessions.value.some((s) => s.active) &&
        sessions.value[0]
      ) {
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

/**
 * 把会话加入本地 sessions 列表并建立 WebSocket 连接。
 * 提取为公共方法，供主动接入（acceptQueue）和被动接收转交（onTransfer）复用。
 */
async function addSessionLocal(params: {
  color: string;
  id: string;
  minLabel: string;
  name: string;
  /** 问题标签（来自转人工请求） */
  tag: string;
  transferReason: string;
  /** 入队时间戳（epoch 秒） */
  waitSince: number;
}) {
  // 首次接入时从全量历史初始化 lastSeq，避免后续 WS 重连重复拉全量
  const history = await getSessionHistoryApi(params.id).catch(() => []);
  let maxSeq = 0;
  const loadedMsgs: Msg[] = history.map((h) => {
    // seq 后端 Long 序列化为 string，需 Number() 归一化
    const seqNum =
      h.seq === null || h.seq === undefined ? Number.NaN : Number(h.seq);
    if (Number.isFinite(seqNum) && seqNum > maxSeq) {
      maxSeq = seqNum;
    }
    return {
      id: ++msgId,
      role: mapMsgRole(h.role),
      text: h.content,
      time: h.timestamp
        ? new Date(Number(h.timestamp)).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : undefined,
    };
  });
  if (maxSeq > 0) {
    writeLastSeq(params.id, maxSeq);
  }
  sessions.value.forEach((s) => (s.active = false));
  sessions.value.push({
    id: params.id,
    name: params.name,
    nameChar: params.name.at(0) ?? '',
    color: params.color,
    min: params.minLabel,
    active: true,
    sessionCode: `#${params.id}`,
    transferReason: params.transferReason,
    tag: params.tag,
    waitSince: params.waitSince,
    msgs:
      loadedMsgs.length > 0
        ? loadedMsgs
        : [
            {
              id: ++msgId,
              role: 'ai',
              text: '您好！请问有什么可以帮您？',
              time: nowTime(),
            },
          ],
  });
  connectAgentSession(params.id);
}

async function acceptQueue(item: QueueItem) {
  if (concurrent.value >= MAX_CONCURRENT) {
    message.warning('已达最大并发数（5），请先结束其他会话');
    return;
  }
  try {
    await acceptItem(item);
    await addSessionLocal({
      id: item.id,
      name: item.name,
      color: item.color,
      transferReason: item.reason,
      tag: item.tag,
      waitSince: item.waitSince,
      minLabel: '刚接入',
    });
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
  activeSession.value.msgs.push({
    id: ++msgId,
    role: 'agent',
    text,
    time: nowTime(),
  });
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
  requestCloseSession();
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
      // I-11 修复：onMounted 恢复会话时同样需要写入 lastSeq，
      // 否则 WS 重连后 sinceSeqSnapshot<=0 提前返回，丢失离线消息
      let maxSeq = 0;
      const loadedMsgs: Msg[] = history.map((h) => {
        // S-07：使用全局 ++msgId 保证 id 全局唯一，避免 :key 碰撞导致 DOM 错乱
        const seqNum =
          h.seq === null || h.seq === undefined ? Number.NaN : Number(h.seq);
        if (Number.isFinite(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
        return {
          id: ++msgId,
          role: mapMsgRole(h.role),
          text: h.content,
        };
      });
      if (maxSeq > 0) writeLastSeq(item.sessionId, maxSeq);
      sessions.value.push({
        id: item.sessionId,
        name: item.userName,
        nameChar: item.userName.at(0) ?? '',
        color: '#8b5cf6',
        min: '接待中',
        active: false,
        sessionCode: `#${item.sessionId}`,
        transferReason: item.transferReason,
        tag: item.tag,
        waitSince: item.waitSince,
        msgs:
          loadedMsgs.length > 0
            ? loadedMsgs
            : [{ id: ++msgId, role: 'ai', text: '您好！请问有什么可以帮您？' }],
      });
    });
    // 激活第一个恢复会话，并重建所有 WebSocket 连接
    if (sessions.value[0]) sessions.value[0].active = true;
    activeSessions.forEach((item) => connectAgentSession(item.sessionId));
  }

  // 3. 订阅 SSE（composable 内置指数退避重连 + 等待时间定时刷新）
  //    复用命名处理函数，reconnectQueue() 可据此手动重连，保持逻辑单一来源
  subscribeQueue(undefined, handleQueueClosed, handleQueueTransfer);
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
    <!-- SSE 实时连接断开横幅：composable 已内置指数退避自动重连，此处提供手动「立即重试」 -->
    <Alert
      v-if="!sseConnected"
      class="mb-3"
      type="warning"
      show-icon
      message="实时连接已断开，正在自动重连…"
    >
      <template #action>
        <Button size="small" @click="reconnectQueue">立即重试</Button>
      </template>
    </Alert>
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

          <!-- 队列搜索：按姓名 / 标签 / 会话编号过滤（等待 + 接待中两个 Tab 共用） -->
          <Input
            v-model:value="queueSearch"
            allow-clear
            class="mb-2"
            placeholder="搜索姓名 / 标签 / 会话编号"
            size="small"
          >
            <template #prefix>
              <Icon icon="lucide:search" class="text-gray-400" />
            </template>
          </Input>

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
                >{{ queue.length }}</span
              >
              <span
                v-if="tab.key === 'active' && sessions.length"
                class="ml-0.5 rounded-full bg-indigo-500 px-1 text-white"
                style="font-size: 10px; line-height: 16px"
                >{{ sessions.length }}</span
              >
            </span>
          </div>

          <!-- 等待人工 Tab -->
          <template v-if="queueStateTab === 'waiting'">
            <div v-if="visiblePagedQueue.length" class="space-y-2">
              <div
                v-for="item in visiblePagedQueue"
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
                    /> </template
                  >接入会话
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
                <span class="text-xs text-gray-400"
                  >{{ queuePage }} / {{ queueTotalPages }}</span
                >
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

            <!-- 搜索无匹配 / 空队列提示 -->
            <div
              v-if="queue.length && !visiblePagedQueue.length"
              class="flex flex-col items-center justify-center py-6 text-center"
            >
              <Icon
                icon="lucide:search-x"
                class="mb-2 text-2xl text-gray-200"
              />
              <p class="text-xs text-gray-400">
                未找到匹配“{{ queueSearch }}”的会话
              </p>
            </div>
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
          <template v-else-if="queueStateTab === 'active'">
            <div v-if="visibleSessions.length" class="space-y-2">
              <div
                v-for="s in visibleSessions"
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
              v-if="sessions.length && !visibleSessions.length"
              class="flex flex-col items-center justify-center py-6 text-center"
            >
              <Icon
                icon="lucide:search-x"
                class="mb-2 text-2xl text-gray-200"
              />
              <p class="text-xs text-gray-400">
                未找到匹配“{{ queueSearch }}”的会话
              </p>
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

          <!-- 已结束 Tab -->
          <template v-else-if="queueStateTab === 'closed'">
            <div v-if="closedLoading" class="flex justify-center py-6">
              <Spin size="small" />
            </div>
            <div v-else-if="closedSessions.length" class="space-y-2">
              <div
                v-for="item in closedSessions"
                :key="item.id"
                class="cursor-pointer rounded-xl border p-2.5 transition"
                :class="[
                  closedView?.session.id === item.id
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-gray-100 bg-white hover:border-gray-200',
                ]"
                @click="viewClosedSession(item)"
              >
                <div class="flex items-center gap-2">
                  <Avatar :size="26" style="background: #9ca3af">
                    {{ item.nameChar }}
                  </Avatar>
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium text-gray-700">
                      {{ item.name }}
                    </p>
                    <p class="text-xs text-gray-400">{{ item.endedAt }}</p>
                  </div>
                  <Tag color="default" class="shrink-0 text-xs">
                    {{ item.tag }}
                  </Tag>
                </div>
              </div>
            </div>
            <div
              v-else
              class="flex flex-col items-center justify-center py-6 text-center"
            >
              <Icon icon="lucide:archive" class="mb-2 text-2xl text-gray-200" />
              <p class="text-xs text-gray-400">暂无已结束会话</p>
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
          <div class="ml-auto flex items-center gap-2">
            <!-- 当前会话 WS 连接状态点 -->
            <span
              class="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs"
              :title="`WebSocket 状态：${wsStatusMeta.text}`"
            >
              <span
                class="h-2 w-2 rounded-full"
                :style="{ background: wsStatusMeta.color }"
              ></span>
              {{ wsStatusMeta.text }}
            </span>
            <!-- Bug-002 修复：转交按钮打开 Modal -->
            <Button size="small" @click="transferVisible = true">
              <template #icon><Icon icon="ant-design:swap-outlined" /></template
              >转交
            </Button>
            <Button type="primary" size="small" @click="closeSession">
              <template #icon>
                <Icon icon="ant-design:check-outlined" /> </template
              >结束会话
            </Button>
          </div>
        </div>

        <!-- 当前会话连接断开提示 + 重连 -->
        <Alert
          v-if="activeSession && activeWsStatus !== 'open'"
          banner
          class="mx-3 mt-2"
          type="error"
          :message="
            activeWsStatus === 'connecting'
              ? '会话连接建立中，消息可能短暂延迟'
              : '当前会话连接已断开，消息可能延迟或丢失'
          "
        >
          <template #action>
            <Button size="small" @click="reconnectActiveSession">重连</Button>
          </template>
        </Alert>

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
              >{{ opt.label }}</span
            >
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

          <template v-for="m in filteredMsgs" :key="m.id">
            <!-- 系统消息：居中提示，无头像气泡 -->
            <div v-if="m.role === 'system'" class="flex justify-center">
              <span
                class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-400"
                >{{ m.text }}</span
              >
            </div>
            <!-- 普通消息：头像 + 气泡 -->
            <div
              v-else
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
              <div>
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
                  <!-- AI/用户消息：Markdown 渲染 -->
                  <div
                    v-if="m.role === 'ai'"
                    class="agent-ai-md"
                    v-html="marked.parse(m.text)"
                  ></div>
                  <!-- 座席/用户：纯文本 -->
                  <span
                    v-else
                    style="overflow-wrap: break-word; white-space: pre-wrap"
                    >{{ m.text }}</span
                  >
                </div>
                <!-- 时间戳 + 复制 -->
                <div
                  v-if="m.time"
                  class="mt-0.5 flex items-center gap-1.5"
                  :class="m.role === 'user' ? 'justify-start' : 'justify-end'"
                >
                  <span class="text-xs text-gray-300">{{ m.time }}</span>
                  <button
                    v-if="m.text"
                    class="text-xs text-gray-300 transition hover:text-gray-500"
                    title="复制"
                    @click.stop="copyMsgText(m.text)"
                  >
                    <Icon icon="lucide:copy" class="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </template>
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

      <!-- 中栏：已结束会话只读视图 -->
      <div
        v-else-if="closedView"
        class="flex flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-sm"
      >
        <!-- 顶栏 -->
        <div
          class="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3"
        >
          <Avatar :size="36" style="background: #9ca3af">
            {{ closedView.session.nameChar }}
          </Avatar>
          <div>
            <p class="text-sm font-medium text-gray-800">
              {{ closedView.session.name }}
            </p>
            <p class="text-xs text-gray-500">
              会话 #{{ closedView.session.id }} · 结束于
              {{ closedView.session.endedAt }} · 原因：{{
                closedView.session.transferReason
              }}
            </p>
          </div>
          <div class="ml-auto">
            <Tag color="default">已结束</Tag>
          </div>
        </div>

        <!-- 消息列表（只读） -->
        <div class="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
          <div v-if="closedViewLoading" class="flex justify-center py-10">
            <Spin />
          </div>
          <template v-else>
            <div class="flex justify-center">
              <Tag color="default" class="text-xs">
                共
                {{ closedView.msgs.filter((m) => m.role !== 'agent').length }}
                轮对话
              </Tag>
            </div>
            <template v-for="m in closedView.msgs" :key="m.id">
              <div v-if="m.role === 'system'" class="flex justify-center">
                <span
                  class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-400"
                  >{{ m.text }}</span
                >
              </div>
              <div
                v-else
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
                  class="shrink-0"
                >
                  {{
                    m.role === 'user'
                      ? closedView.session.nameChar
                      : m.role === 'agent'
                        ? '客'
                        : 'AI'
                  }}
                </Avatar>
                <div
                  class="max-w-xs rounded-xl px-3 py-2 text-sm leading-relaxed"
                  :class="[
                    m.role === 'user'
                      ? 'rounded-tl-none border border-gray-200 bg-white text-gray-700'
                      : m.role === 'agent'
                        ? 'rounded-tr-none bg-indigo-500 text-white'
                        : 'rounded-tr-none bg-indigo-50 text-indigo-800 opacity-80',
                  ]"
                >
                  <div
                    v-if="m.role === 'ai'"
                    class="agent-ai-md"
                    v-html="marked.parse(m.text)"
                  ></div>
                  <span
                    v-else
                    style="overflow-wrap: break-word; white-space: pre-wrap"
                    >{{ m.text }}</span
                  >
                </div>
              </div>
            </template>
          </template>
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
          <span class="text-xs text-emerald-500"
            >实时监听中，新会话将自动推送</span
          >
        </div>
      </div>

      <!-- 右栏：上下文面板（Bug-001 修复：随 activeSession 联动） -->
      <div
        v-if="activeSession"
        class="flex w-64 shrink-0 flex-col gap-3 overflow-auto"
      >
        <Card title="会话信息" :bordered="false" class="shadow-sm" size="small">
          <Descriptions :column="1" size="small">
            <DescriptionsItem label="访客姓名">
              {{ activeSession.name }}
            </DescriptionsItem>
            <DescriptionsItem label="会话编号">
              {{ activeSession.sessionCode }}
            </DescriptionsItem>
            <DescriptionsItem label="问题标签">
              <Tag :color="resolveTagColor(activeSession.tag)">
                {{ activeSession.tag || '未标记' }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem
              v-if="activeSession.waitSince > 0"
              label="排队时长"
            >
              {{ formatWaitTime(activeSession.waitSince) }}
            </DescriptionsItem>
            <DescriptionsItem label="消息轮数">
              {{ activeSession.msgs.filter((m) => m.role !== 'agent').length }}
            </DescriptionsItem>
            <DescriptionsItem label="接入状态">
              <Tag color="processing">进行中</Tag>
            </DescriptionsItem>
          </Descriptions>
        </Card>

        <Card title="转接原因" :bordered="false" class="shadow-sm" size="small">
          <Alert
            :message="activeSession.transferReason || '用户主动请求转人工'"
            type="warning"
            show-icon
          />
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
            <Tag :color="agent.sessions === 0 ? 'success' : 'warning'">
              {{ agent.sessions === 0 ? '空闲' : '忙碌' }}
            </Tag>
          </div>
        </div>
        <div v-else-if="loadingAgents" class="flex justify-center py-8">
          <Spin />
        </div>
        <div
          v-else
          class="flex flex-col items-center justify-center py-8 text-center"
        >
          <Icon icon="lucide:users" class="mb-2 text-2xl text-gray-300" />
          <p class="text-sm text-gray-400">当前无可转交的座席</p>
          <p class="mt-1 text-xs text-gray-300">其他座席离线或已达并发上限</p>
        </div>
      </RadioGroup>
    </Modal>

    <!-- 结束会话确认弹窗 -->
    <Modal
      v-model:open="closeConfirmVisible"
      title="结束会话"
      ok-text="确认结束"
      cancel-text="取消"
      @ok="confirmCloseSession"
    >
      <p class="text-sm text-gray-600">
        确认结束与 <strong>{{ activeSession?.name }}</strong> 的会话吗？<br />
        结束后访客端会话将关闭且不可恢复。
      </p>
    </Modal>
  </Page>
</template>

<style>
.agent-ai-md p {
  margin: 0.3em 0;
}

.agent-ai-md p:first-child {
  margin-top: 0;
}

.agent-ai-md p:last-child {
  margin-bottom: 0;
}

.agent-ai-md ul,
.agent-ai-md ol {
  padding-left: 1.3em;
  margin: 0.3em 0;
}

.agent-ai-md li {
  margin: 0.15em 0;
}

.agent-ai-md code {
  padding: 1px 4px;
  font-family: monospace;
  font-size: 11px;
  background: #dde2ee;
  border-radius: 3px;
}

.agent-ai-md pre {
  padding: 8px;
  margin: 0.3em 0;
  overflow-x: auto;
  font-size: 11px;
  background: #dde2ee;
  border-radius: 4px;
}

.agent-ai-md pre code {
  padding: 0;
  background: none;
}

.agent-ai-md strong {
  font-weight: 600;
}

.agent-ai-md h1,
.agent-ai-md h2,
.agent-ai-md h3 {
  margin: 0.4em 0 0.2em;
  font-weight: 600;
}

.agent-ai-md blockquote {
  padding-left: 8px;
  margin: 0.3em 0;
  color: #4338ca;
  border-left: 2px solid #6366f1;
  opacity: 0.8;
}

.agent-ai-md table {
  margin: 0.3em 0;
  font-size: 11px;
  border-collapse: collapse;
}

.agent-ai-md th,
.agent-ai-md td {
  padding: 3px 6px;
  border: 1px solid #c7d2fe;
}

.agent-ai-md th {
  background: #e0e7ff;
}
</style>
