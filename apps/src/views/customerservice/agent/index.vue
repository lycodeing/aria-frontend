<script lang="ts" setup>
// ===== 主题隔离：强制 light 模式，不受后台暗色主题影响 =====

import type { ClosedSessionItem, ClosedView, Msg, SessionData } from './types';

import type {
  SessionQueueItem as ApiSessionItem,
  ChatToolCall,
  OnlineAgentItem,
  SessionSseEvent,
} from '#/api/session';
import type { QueueItem } from '#/composables/useSessionQueue';

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore, useUserStore } from '@vben/stores';

import { Icon } from '@iconify/vue';
import {
  Alert,
  Button,
  Collapse,
  CollapsePanel,
  Drawer,
  message,
  Modal,
  Radio,
  RadioGroup,
  Spin,
} from 'ant-design-vue';

import {
  acceptSessionApi,
  closeSessionApi,
  getOnlineAgentsApi,
  getSessionHistoryApi,
  transferSessionApi,
} from '#/api/session';
import { useAgentWebSocket } from '#/composables/useAgentWebSocket';
import { useAgentWsChannel } from '#/composables/useAgentWsChannel';
import { useReplySuggestions } from '#/composables/useReplySuggestions';
import { resolveTagColor } from '#/composables/useSessionQueue';
import { useSessionQueueChannel } from '#/composables/useSessionQueueChannel';
import { useVisitorHistory } from '#/composables/useVisitorHistory';

import AgentChatArea from './AgentChatArea.vue';
import AgentLeftPanel from './AgentLeftPanel.vue';
import AgentRightPanel from './AgentRightPanel.vue';

// ===== 当前座席身份 =====
const userStore = useUserStore();
// currentAgentId 取 userId（Sa-Token loginId），与后端 SSE 事件中的 fromAgentId/toAgentId 一致
// 不能用 accessToken（Bearer token 字符串），两者不是同一个值
const currentAgentId = computed(() => userStore.userInfo?.userId ?? '');

// ===== 座席端 lastSeq 跟踪 =====
const LAST_SEQ_KEY_PREFIX = 'agent_last_seq_';

function readLastSeq(sid: string): number {
  const raw = localStorage.getItem(LAST_SEQ_KEY_PREFIX + sid);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function writeLastSeq(sid: string, newSeq: number) {
  if (!Number.isFinite(newSeq) || newSeq <= 0) return;
  const current = readLastSeq(sid);
  if (newSeq > current) {
    localStorage.setItem(LAST_SEQ_KEY_PREFIX + sid, String(newSeq));
  }
}

const fetchInflight = new Set<string>();
// 已补齐消息的 seq 集合，避免断线补偿与实时消息重复（去重）
const seenSeqBySession = new Map<string, Set<number>>();
async function fetchMissingForSession(sid: string) {
  if (fetchInflight.has(sid)) return;
  const sinceSeqSnapshot = readLastSeq(sid);
  if (sinceSeqSnapshot <= 0) return;
  fetchInflight.add(sid);
  try {
    const missing = await getSessionHistoryApi(sid, sinceSeqSnapshot);
    const session = sessions.value.find((s) => s.id === sid);
    if (!session) return;
    const seen = seenSeqBySession.get(sid) ?? new Set<number>();
    for (const item of missing) {
      const seqNum =
        item.seq === null || item.seq === undefined
          ? Number.NaN
          : Number(item.seq);
      // 仅补齐断连期间缺失的消息；用 seq 去重，避免与已到达的实时消息重复
      if (!Number.isFinite(seqNum) || seqNum <= sinceSeqSnapshot) continue;
      if (!item.content) continue;
      if (seen.has(seqNum)) continue;
      seen.add(seqNum);
      // 回灌全部角色（user / ai / agent / system / tool），保持对话上下文完整
      session.msgs.push(historyItemToMsg(item));
      writeLastSeq(sid, seqNum);
    }
    seenSeqBySession.set(sid, seen);
  } catch (error) {
    console.warn('[WS:Agent] fetchMissingForSession failed', sid, error);
  } finally {
    fetchInflight.delete(sid);
  }
}

// ===== 访客输入中状态：sessionId → 自动清除 timer =====
const visitorTypingMap = ref<Record<string, boolean>>({});
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setVisitorTyping(sessionId: string) {
  visitorTypingMap.value[sessionId] = true;
  const existing = typingTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  // 3 秒无新信号则自动清除（网络抖动或访客停止输入）
  typingTimers.set(
    sessionId,
    setTimeout(() => {
      visitorTypingMap.value[sessionId] = false;
      typingTimers.delete(sessionId);
    }, 3000),
  );
  // 滚动控制已下沉到 AgentChatArea：仅在贴近底部时自动滚动，上翻历史时不强制拽回
}

// ===== Composable：WebSocket 连接管理 =====
const {
  connectSession: connectAgentSession,
  disconnectSession: disconnectAgentSession,
  sendMessage: sendAgentMessage,
  getStatus: getAgentWsStatus,
} = useAgentWebSocket({
  onUserMessage: (sessionId, msg) => {
    if (msg.seq !== null && msg.seq !== undefined) {
      const seqNum = Number(msg.seq);
      if (Number.isFinite(seqNum)) writeLastSeq(sessionId, seqNum);
    }
    const session = sessions.value.find((s) => s.id === sessionId);
    if (session) {
      // 收到真实消息，清除输入中状态
      visitorTypingMap.value[sessionId] = false;
      const t = typingTimers.get(sessionId);
      if (t) {
        clearTimeout(t);
        typingTimers.delete(sessionId);
      }
      session.msgs.push({
        id: ++msgId,
        role: 'user',
        text: msg.content ?? '',
        time: nowTime(),
        ts: Date.now(),
      });
      if (session.active) {
        // 滚动控制已下沉到 AgentChatArea（贴近底部才自动滚）
        refreshSuggestions(sessionId, 800);
      } else {
        // 非当前会话：累计未读数
        session.unread = (session.unread ?? 0) + 1;
      }
    }
  },
  onTyping: (sessionId) => {
    setVisitorTyping(sessionId);
  },
  onReconnect: (sessionId) => {
    void fetchMissingForSession(sessionId);
  },
});

// ===== 当前会话 WS 连接状态 =====
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

function mapMsgRole(role: string | undefined): Msg['role'] {
  if (role === 'user') return 'user';
  if (role === 'agent') return 'agent';
  if (role === 'system') return 'system';
  if (role === 'tool') return 'tool';
  return 'ai';
}

/**
 * 过滤历史记录中残留的 TYPING 信号。
 * 旧版后端在 TYPING 过滤逻辑上线前会把 {"type":"TYPING"} 当普通消息写入历史，
 * 前端加载时需要识别并丢弃，避免渲染成用户消息气泡。
 */
function isTypingSignal(content?: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed?.type === 'TYPING';
  } catch {
    return false;
  }
}

function historyItemToMsg(h: {
  content?: string;
  role?: string;
  timestamp?: null | number;
  toolCalls?: ChatToolCall[] | null;
  toolName?: null | string;
  toolRequestId?: null | string;
}): Msg {
  return {
    id: ++msgId,
    role: mapMsgRole(h.role),
    text: h.content ?? '',
    time: h.timestamp
      ? new Date(Number(h.timestamp)).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : undefined,
    ts: h.timestamp ? Number(h.timestamp) : undefined,
    toolName: h.toolName ?? undefined,
    toolRequestId: h.toolRequestId ?? undefined,
    toolCalls: h.toolCalls ?? undefined,
  };
}

function formatShortDate(isoString: string | undefined): string {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

// ===== 队列搜索 =====
const queueSearch = ref('');
function matchKeyword(
  keyword: string,
  ...fields: (string | undefined)[]
): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(k));
}
// 等待队列：先过滤再分页（定义见下方分页区块）
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

// ===== SSE 事件处理 =====
function handleQueueClosed(sid: string) {
  const closedIdx = sessions.value.findIndex((s) => s.id === sid);
  if (closedIdx !== -1) {
    const closedName = sessions.value[closedIdx]?.name ?? '';
    disconnectAgentSession(sid);
    sessions.value.splice(closedIdx, 1);
    // 清理 typing 状态
    const t1 = typingTimers.get(sid);
    if (t1) {
      clearTimeout(t1);
      typingTimers.delete(sid);
    }
    visitorTypingMap.value[sid] = false;
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
  if (event.fromAgentId === myId) return;
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
  queueChannel.reconnect();
}
// 真正重建 WS 通道（带 token），重连成功后 channel 会自动按 sinceSeq 补齐漏消息
const agentWsChannel = useAgentWsChannel();
function reconnectActiveSession() {
  agentWsChannel.reconnect(useAccessStore().accessToken ?? '');
}

// ===== 座席状态 =====
const agentOnline = ref(true);
const MAX_CONCURRENT = 5;

// ===== 工具消息展开状态 =====
const toolExpanded = ref<Record<number, boolean>>({});
function toggleTool(id: number) {
  toolExpanded.value[id] = !toolExpanded.value[id];
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

// ===== 每会话数据 =====
const sessions = ref<SessionData[]>([]);
const activeSession = computed(() => sessions.value.find((s) => s.active));
const concurrent = computed(() => sessions.value.length);

// ===== 队列状态 Tab =====
const queueStateTab = ref<'active' | 'ai' | 'closed' | 'waiting'>('waiting');

// ===== 已结束会话 =====
const closedSessions = computed<ClosedSessionItem[]>(() =>
  queueChannel.closedQueue.value.map((item) => ({
    id: item.id,
    name: item.name,
    nameChar: item.name.at(0) ?? '?',
    endedAt:
      item.waitSince > 0
        ? new Date(item.waitSince * 1000).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
    transferReason: item.reason,
    tag: item.tag,
  })),
);
const closedView = ref<ClosedView | null>(null);
const closedViewLoading = ref(false);

async function viewClosedSession(item: ClosedSessionItem) {
  closedViewLoading.value = true;
  closedView.value = { kind: 'closed', session: item, msgs: [] };
  try {
    const history = await getSessionHistoryApi(item.id, 0);
    closedView.value.msgs = history
      .filter((h) => !isTypingSignal(h.content))
      .map((h) => historyItemToMsg(h));
  } catch {
    message.error('加载会话记录失败');
  } finally {
    closedViewLoading.value = false;
  }
}

// 旁观 AI 对话：点击「AI 对话」Tab 的会话项，中栏只读预览 AI↔访客对话（不可发消息）
async function viewAiSession(item: QueueItem) {
  closedViewLoading.value = true;
  closedView.value = {
    kind: 'ai',
    session: {
      id: item.id,
      name: item.name,
      nameChar: item.name.at(0) ?? '?',
      endedAt: '',
      transferReason: item.reason,
      tag: item.tag,
    },
    msgs: [],
  };
  try {
    const history = await getSessionHistoryApi(item.id, 0);
    closedView.value.msgs = history
      .filter((h) => !isTypingSignal(h.content))
      .map((h) => historyItemToMsg(h));
  } catch {
    message.error('加载 AI 对话记录失败');
  } finally {
    closedViewLoading.value = false;
  }
}

// 接管 AI 对话：从旁观预览切到人工接待，复用 acceptQueue 流程
// 注意：依赖后端 acceptSessionApi 是否允许对 AI_CHAT 状态的会话接入
function takeoverAiSession() {
  const id = closedView.value?.session.id;
  if (!id) return;
  const item = aiQueue.value.find((q) => q.id === id);
  if (!item) {
    message.warning('该会话已不在 AI 对话队列，可能已升级或结束');
    return;
  }
  closedView.value = null;
  acceptQueue(item);
}

// ===== 对话区消息筛选 =====
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

// ===== 全局 SSE Queue Channel（由 layouts/basic.vue 持有连接） =====
const queueChannel = useSessionQueueChannel();
const { aiQueue, waitingQueue, sseConnected } = queueChannel;

// 分页：先按关键词过滤，再分页（修复搜索命中藏在第 2 页误报空结果）
const queuePage = ref(1);
const filteredWaitingQueue = computed(() =>
  waitingQueue.value.filter((q) =>
    matchKeyword(queueSearch.value, q.name, q.tag, q.id),
  ),
);
const queueTotalPages = computed(() =>
  Math.max(1, Math.ceil(filteredWaitingQueue.value.length / 5)),
);
const pagedWaitingQueue = computed(() => {
  const start = (queuePage.value - 1) * 5;
  return filteredWaitingQueue.value.slice(start, start + 5);
});
const visiblePagedWaitingQueue = computed(() => pagedWaitingQueue.value);
// 新会话入队 或 关键词变化时，重置到第 1 页
watch(
  () => waitingQueue.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) queuePage.value = 1;
  },
);
watch(queueSearch, () => {
  queuePage.value = 1;
});

async function acceptItem(item: QueueItem): Promise<ApiSessionItem> {
  await acceptSessionApi(item.id);
  // 乐观更新：从 sessions 中移除该条目。
  // 后续 SSE ACCEPTED 事件到来时条目已不存在，channel 层的状态迁移会静默跳过；
  // 本地人工会话由 addSessionLocal() 负责创建，不依赖 channel.activeQueue。
  queueChannel.removeFromSessions(item.id);
  return {
    sessionId: item.id,
    userName: item.name,
    transferReason: item.reason,
    tag: item.tag,
    waitSince: item.waitSince,
    status: 'ACTIVE',
  };
}

// ===== Composable：访客历史工单 =====
const {
  historyList: visitorHistoryList,
  loading: visitorHistoryLoading,
  drawerVisible: historyDrawerVisible,
  summaryMap,
  openDrawer: openHistoryDrawer,
  preload: preloadHistory,
  generateSummary,
  regenerateSummary,
} = useVisitorHistory();

// ===== Composable：AI 回复建议 =====
const {
  suggestions: replySuggestions,
  loading: suggestionsLoading,
  hasError: suggestionsError,
  refresh: refreshSuggestions,
  refreshNow: refreshSuggestionsNow,
  clear: clearSuggestions,
} = useReplySuggestions();

watch(activeSession, (session, prevSession) => {
  if (prevSession?.id !== session?.id) {
    clearSuggestions();
    if (session) {
      preloadHistory(session.name, session.id);
      refreshSuggestions(session.id, 0);
    }
  }
});

// 替换当前会话草稿（建议卡「替换」动作）
function applySuggestion(content: string): void {
  if (activeSession.value) drafts.value.set(activeSession.value.id, content);
}
// 追加到当前会话草稿，不覆盖正在输入的内容（建议卡「插入」动作）
function insertSuggestion(content: string): void {
  if (activeSession.value) {
    const cur = drafts.value.get(activeSession.value.id) ?? '';
    drafts.value.set(activeSession.value.id, cur + content);
  }
}

let msgId = 100;
// 每会话草稿隔离：切换会话自动按 sessionId 保存/恢复，避免草稿串台误发
const drafts = ref<Map<string, string>>(new Map());
const msgInput = computed({
  get() {
    return activeSession.value
      ? (drafts.value.get(activeSession.value.id) ?? '')
      : '';
  },
  set(v: string) {
    if (activeSession.value) drafts.value.set(activeSession.value.id, v);
  },
});
const QUICK_REPLY = [
  '已核实订单信息',
  '安排补发处理',
  '提交快递投诉',
  '退款申请处理',
  '感谢您的耐心等待',
];

// ===== 转交 Modal =====
const transferVisible = ref(false);
const transferTarget = ref('');
const availableAgents = ref<OnlineAgentItem[]>([]);
const loadingAgents = ref(false);

watch(queueStateTab, (tab) => {
  if (tab !== 'closed') closedView.value = null;
});

watch(transferVisible, async (visible) => {
  if (!visible) return;
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
  s.unread = 0;
  msgFilter.value = '全部';
  // 切回活跃会话时退出已结束只读视图（草稿由 drafts 按 id 自动保留/恢复）
  closedView.value = null;
}

async function addSessionLocal(params: {
  color: string;
  id: string;
  minLabel: string;
  name: string;
  tag: string;
  transferReason: string;
  waitSince: number;
}) {
  const history = await getSessionHistoryApi(params.id).catch(() => []);
  let maxSeq = 0;
  const loadedMsgs: Msg[] = history
    .filter((h) => !isTypingSignal(h.content))
    .map((h) => {
      const seqNum =
        h.seq === null || h.seq === undefined ? Number.NaN : Number(h.seq);
      if (Number.isFinite(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
      return historyItemToMsg(h);
    });
  if (maxSeq > 0) writeLastSeq(params.id, maxSeq);
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
    unread: 0,
    msgs:
      loadedMsgs.length > 0
        ? loadedMsgs
        : [
            {
              id: ++msgId,
              role: 'ai',
              text: '您好！请问有什么可以帮您？',
              time: nowTime(),
              ts: Date.now(),
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
    ts: Date.now(),
  });
  // 清空当前会话草稿（computed setter 会写入 drafts 当前 id）
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
  disconnectAgentSession(sid);
  // 清理 typing 状态
  const t2 = typingTimers.get(sid);
  if (t2) {
    clearTimeout(t2);
    typingTimers.delete(sid);
  }
  visitorTypingMap.value[sid] = false;
  sessions.value = sessions.value.filter((s) => s.id !== sid);
  if (sessions.value.length > 0 && sessions.value[0])
    sessions.value[0].active = true;
  message.success('会话已结束，正在生成长期记忆摘要...');
}

function quickReply(q: string) {
  // 快捷回复默认可追加，避免覆盖正在输入的内容
  insertSuggestion(q);
}

// ===== 生命周期 =====
onMounted(async () => {
  queueChannel.onClosed(handleQueueClosed);
  queueChannel.onTransfer(handleQueueTransfer);

  // Ensure sessions are loaded — handles direct-URL navigation (page refresh,
  // bookmarked URL) where basic.vue's loadSessions() may not have resolved yet.
  // On the normal post-login flow, sessions.value is already populated and this
  // call is skipped.
  if (queueChannel.sessions.value.length === 0) {
    await queueChannel.loadSessions();
  }

  const activeSessions = queueChannel.activeQueue.value;

  if (activeSessions.length > 0) {
    const histories = await Promise.all(
      activeSessions.map((item) =>
        getSessionHistoryApi(item.id).catch(() => []),
      ),
    );
    activeSessions.forEach((item, idx) => {
      const history = histories[idx] ?? [];
      let maxSeq = 0;
      const loadedMsgs: Msg[] = history
        .filter((h) => !isTypingSignal(h.content))
        .map((h) => {
          const seqNum =
            h.seq === null || h.seq === undefined ? Number.NaN : Number(h.seq);
          if (Number.isFinite(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
          return historyItemToMsg(h);
        });
      if (maxSeq > 0) writeLastSeq(item.id, maxSeq);
      sessions.value.push({
        id: item.id,
        name: item.name,
        nameChar: item.name.at(0) ?? '',
        color: '#8b5cf6',
        min: '接待中',
        active: false,
        sessionCode: `#${item.id}`,
        transferReason: item.reason,
        tag: item.tag,
        waitSince: item.waitSince,
        unread: 0,
        msgs:
          loadedMsgs.length > 0
            ? loadedMsgs
            : [
                {
                  id: ++msgId,
                  role: 'ai',
                  text: '您好！请问有什么可以帮您？',
                  ts: Date.now(),
                },
              ],
      });
    });
    if (sessions.value[0]) sessions.value[0].active = true;
    activeSessions.forEach((item) => connectAgentSession(item.id));
  }
});

// ===== 生命周期：unmount 时清理 typingTimers 防止定时器回调写已卸载组件 =====
onUnmounted(() => {
  typingTimers.forEach((timer) => clearTimeout(timer));
  typingTimers.clear();
  // 离开页面时注销，防止多次进入页面导致回调重复执行
  queueChannel.offClosed(handleQueueClosed);
  queueChannel.offTransfer(handleQueueTransfer);
});
</script>

<template>
  <Page
    auto-content-height
    title="座席工作台"
    description="实时接待转接会话，查看 AI 对话上下文"
  >
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <!-- SSE 断线横幅 -->
      <Alert
        v-if="!sseConnected"
        class="mb-2 shrink-0"
        type="warning"
        show-icon
        message="实时连接已断开，正在自动重连…"
      >
        <template #action>
          <Button size="small" @click="reconnectQueue">立即重试</Button>
        </template>
      </Alert>

      <!-- 三栏布局 -->
      <div class="flex min-h-0 flex-1 gap-3 overflow-hidden">
        <!-- 左栏 2/10 -->
        <AgentLeftPanel
          class="flex-[2] min-w-0"
          :agent-online="agentOnline"
          :concurrent="concurrent"
          :max-concurrent="MAX_CONCURRENT"
          :sse-connected="sseConnected"
          :queue-state-tab="queueStateTab"
          :ai-queue="aiQueue"
          :waiting-queue="waitingQueue"
          :queue-page="queuePage"
          :queue-total-pages="queueTotalPages"
          :queue-search="queueSearch"
          :visible-paged-waiting-queue="visiblePagedWaitingQueue"
          :visible-sessions="visibleSessions"
          :sessions="sessions"
          :closed-sessions="closedSessions"
          :closed-view="closedView"
          :visitor-typing-map="visitorTypingMap"
          @toggle-online="agentOnline = $event"
          @update:queue-state-tab="queueStateTab = $event"
          @update:queue-page="queuePage = $event"
          @update:queue-search="queueSearch = $event"
          @accept-queue="acceptQueue"
          @switch-session="switchSession"
          @view-closed="viewClosedSession"
          @view-ai-session="viewAiSession"
          @reconnect-queue="reconnectQueue"
        />

        <!-- 中栏 6/10 -->
        <AgentChatArea
          class="flex-[6] min-w-0"
          :active-session="activeSession"
          :closed-view="closedView"
          :closed-view-loading="closedViewLoading"
          :msg-filter="msgFilter"
          :filtered-msgs="filteredMsgs"
          :msg-input="msgInput"
          :active-ws-status="activeWsStatus"
          :ws-status-meta="wsStatusMeta"
          :tool-expanded="toolExpanded"
          :quick-replies="QUICK_REPLY"
          :queue="waitingQueue"
          :max-concurrent="MAX_CONCURRENT"
          :concurrent="concurrent"
          :visitor-typing="
            activeSession
              ? (visitorTypingMap[activeSession.id] ?? false)
              : false
          "
          @update:msg-input="msgInput = $event"
          @update:msg-filter="msgFilter = $event"
          @send="sendAgent"
          @quick-reply="quickReply"
          @toggle-tool="toggleTool"
          @transfer="transferVisible = true"
          @close-session="requestCloseSession"
          @reconnect-session="reconnectActiveSession"
          @exit-closed="closedView = null"
          @takeover-ai="takeoverAiSession"
          @copy-msg="copyMsgText"
        />

        <!-- 右栏 2/10 -->
        <AgentRightPanel
          v-if="activeSession || closedView"
          class="flex-[2] min-w-0"
          :active-session="activeSession"
          :closed-view="closedView"
          :visitor-history-list="visitorHistoryList"
          :visitor-history-loading="visitorHistoryLoading"
          :reply-suggestions="replySuggestions"
          :suggestions-loading="suggestionsLoading"
          :suggestions-error="suggestionsError"
          :summary-map="summaryMap"
          @open-history-drawer="
            activeSession &&
            openHistoryDrawer(activeSession.name, activeSession.id)
          "
          @apply-suggestion="applySuggestion"
          @insert-suggestion="insertSuggestion"
          @refresh-suggestions="
            activeSession && refreshSuggestionsNow(activeSession.id)
          "
          @refresh-suggestions-with-prompt="
            activeSession && refreshSuggestionsNow(activeSession.id)
          "
        />
      </div>
    </div>

    <!-- 转交坐席 Modal -->
    <Modal
      v-model:open="transferVisible"
      title="转交会话"
      ok-text="确认转交"
      cancel-text="取消"
      @ok="confirmTransfer"
    >
      <p class="mb-4 text-sm text-[#52525b]">
        将 <strong>{{ activeSession?.name }}</strong> 的会话转交给以下坐席：
      </p>
      <RadioGroup v-model:value="transferTarget" class="w-full">
        <div v-if="availableAgents.length" class="space-y-2">
          <div
            v-for="agent in availableAgents"
            :key="agent.id"
            class="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors"
            :class="
              transferTarget === agent.id
                ? 'border-[#1a73e8] bg-[#f5fafe]'
                : 'border-[#e4e7ed]'
            "
            @click="transferTarget = agent.id"
          >
            <Radio :value="agent.id" />
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1a73e8] text-[13px] font-medium text-white"
            >
              {{ agent.name[0] }}
            </div>
            <div class="flex-1">
              <p class="text-[13px] font-medium text-[#0a0a0b]">
                {{ agent.name }}
              </p>
              <p class="text-[12px] text-[#9ca3af]">
                当前 {{ agent.sessions }} 个会话
              </p>
            </div>
            <span
              class="rounded px-2 py-0.5 text-[11px]"
              :class="
                agent.sessions === 0
                  ? 'bg-[#f0fdf4] text-[#10b981]'
                  : 'bg-[#fff7e6] text-[#d46b08]'
              "
            >
              {{ agent.sessions === 0 ? '空闲' : '忙碌' }}
            </span>
          </div>
        </div>
        <div v-else-if="loadingAgents" class="flex justify-center py-8">
          <Spin />
        </div>
        <div
          v-else
          class="flex flex-col items-center justify-center py-8 text-center"
        >
          <Icon icon="lucide:users" class="mb-2 text-2xl text-[#e4e7ed]" />
          <p class="text-[13px] text-[#9ca3af]">当前无可转交的座席</p>
          <p class="mt-1 text-[11px] text-[#d4d8e3]">
            其他座席离线或已达并发上限
          </p>
        </div>
      </RadioGroup>
    </Modal>

    <!-- 结束会话确认 Modal -->
    <Modal
      v-model:open="closeConfirmVisible"
      title="结束会话"
      ok-text="确认结束"
      cancel-text="取消"
      @ok="confirmCloseSession"
    >
      <p class="text-[13px] text-[#52525b]">
        确认结束与 <strong>{{ activeSession?.name }}</strong> 的会话吗？<br />
        结束后访客端会话将关闭且不可恢复。
      </p>
    </Modal>

    <!-- 历史工单抽屉 -->
    <Drawer
      v-model:open="historyDrawerVisible"
      title="历史工单记录"
      placement="right"
      :width="440"
      :body-style="{ padding: '12px 16px' }"
    >
      <Spin :spinning="visitorHistoryLoading">
        <div
          v-if="!visitorHistoryLoading && visitorHistoryList.length === 0"
          class="flex flex-col items-center justify-center py-12 text-center"
        >
          <Icon icon="lucide:inbox" class="mb-3 text-3xl text-[#e4e7ed]" />
          <p class="text-[13px] text-[#9ca3af]">该访客暂无历史工单</p>
        </div>
        <Collapse v-else accordion ghost>
          <CollapsePanel
            v-for="item in visitorHistoryList"
            :key="item.sessionId"
            class="mb-2 overflow-hidden rounded-xl border border-[#e4e7ed] !bg-white"
          >
            <template #header>
              <div class="flex w-full items-center gap-2">
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
                <span class="flex-1 truncate text-[13px] text-[#0a0a0b]">{{
                  item.transferReason
                }}</span>
                <span class="shrink-0 text-[11px] text-[#9ca3af]">{{
                  formatShortDate(item.endedAt)
                }}</span>
              </div>
            </template>
            <div class="space-y-3 px-1">
              <div class="flex gap-4 text-[11px] text-[#9ca3af]">
                <span>开始：{{ formatShortDate(item.startedAt) }}</span>
                <span>消息轮数：{{ item.msgCount }}</span>
              </div>
              <div class="rounded-xl bg-[#f5f0ff] p-3">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-[12px] font-medium text-[#7c3aed]"
                    >✨ AI 总结</span
                  >
                  <Button
                    v-if="!summaryMap[item.sessionId]?.done"
                    size="small"
                    type="text"
                    :loading="summaryMap[item.sessionId]?.streaming"
                    class="!text-[11px] !text-[#7c3aed]"
                    @click="generateSummary(item.sessionId)"
                  >
                    {{
                      summaryMap[item.sessionId]?.streaming
                        ? '生成中…'
                        : '生成总结'
                    }}
                  </Button>
                  <Button
                    v-else
                    size="small"
                    type="text"
                    class="!text-[11px] !text-[#9ca3af]"
                    @click="regenerateSummary(item.sessionId)"
                    >重新生成</Button
                  >
                </div>
                <p
                  v-if="summaryMap[item.sessionId]?.text"
                  class="whitespace-pre-wrap text-[11px] leading-relaxed text-[#52525b]"
                >
                  {{ summaryMap[item.sessionId]?.text }}
                  <span
                    v-if="summaryMap[item.sessionId]?.streaming"
                    class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#7c3aed] align-middle"
                  ></span>
                </p>
                <p
                  v-else-if="!summaryMap[item.sessionId]?.streaming"
                  class="text-[11px] text-[#9ca3af]"
                >
                  点击「生成总结」让 AI 总结本次工单内容
                </p>
              </div>
            </div>
          </CollapsePanel>
        </Collapse>
      </Spin>
    </Drawer>
  </Page>
</template>
