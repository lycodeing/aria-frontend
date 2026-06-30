<script lang="ts" setup>
// ===== 主题隔离：强制 light 模式，不受后台暗色主题影响 =====
// Vben Admin 通过给 <html> 加 dark class 切换主题，chat 页独立渲染需主动隔离
import type { WsChatMessage } from '#/api/session';

import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { Icon } from '@iconify/vue';
import {
  Alert,
  Button,
  Form,
  FormItem,
  Input,
  InputGroup,
  message,
  Modal,
  Textarea,
} from 'ant-design-vue';

import {
  connectVisitorWs,
  getVisitorHistoryApi,
  sendSmsCodeApi,
  sendWsMessage,
  transferToAgentApi,
  verifySmsCodeApi,
} from '#/api/session';

// ===== 类型 =====
interface Msg {
  id: number;
  role: 'agent' | 'ai' | 'user';
  text: string;
  sources?: string[];
  feedback?: 'down' | 'up' | null;
  /** 消息是否发送失败（用于重试按钮） */
  failed?: boolean;
  /** 失败时保存原始文本，重试时重用 */
  retryText?: string;
  /** WS 消息是否正在发送中（转人工模式下）*/
  sending?: boolean;
}

// ===== 状态 =====
const isAuth = ref(false);
const authLabel = ref('访客模式');
const inputText = ref('');
const msgs = ref<Msg[]>([]);
const msgsEnd = ref<HTMLDivElement>();
const streaming = ref(false);
const transferred = ref(false);
const wsStatus = ref<'connected' | 'connecting' | 'disconnected'>(
  'disconnected',
);
let visitorWs: null | WebSocket = null;
let msgId = 0;
const sessionId = ref('');

// WS 自动重连控制
let wsRetryCount = 0;
let wsRetryTimer: null | ReturnType<typeof setTimeout> = null;
const WS_MAX_RETRY = 3;
const WS_RETRY_DELAY_MS = [1000, 3000, 8000]; // 指数退避

// ===== 本地历史持久化 =====
const HISTORY_KEY_PREFIX = 'chat_history_';
/** sessionStorage 中跟踪 lastSeq 的 key 前缀（按 sessionId 隔离） */
const LAST_SEQ_KEY_PREFIX = 'chat_last_seq_';

/** 读取 sessionId 对应的 lastSeq，缺省返回 0 */
function readLastSeq(sid: string): number {
  const raw = sessionStorage.getItem(LAST_SEQ_KEY_PREFIX + sid);
  return raw ? Number(raw) : 0;
}

/** 写入 lastSeq（仅在 newSeq 大于当前值时更新，防止乱序写入回退） */
function writeLastSeq(sid: string, newSeq: number) {
  const current = readLastSeq(sid);
  if (newSeq > current) {
    sessionStorage.setItem(LAST_SEQ_KEY_PREFIX + sid, String(newSeq));
  }
}

function saveHistory() {
  if (!sessionId.value) return;
  try {
    // 最多保留最近 100 条，避免 localStorage 超限
    const toSave = msgs.value.slice(-100);
    localStorage.setItem(
      HISTORY_KEY_PREFIX + sessionId.value,
      JSON.stringify(toSave),
    );
  } catch {
    /* localStorage 满时忽略 */
  }
}

function loadHistory() {
  if (!sessionId.value) return;
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + sessionId.value);
    if (raw) {
      const parsed: Msg[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 恢复后重置 msgId，确保新消息 id 不冲突
        let maxId = 0;
        for (const m of parsed) {
          if ((m.id ?? 0) > maxId) maxId = m.id ?? 0;
        }
        msgId = maxId;
        msgs.value = parsed;
        scrollBottom();
      }
    }
  } catch {
    /* 解析失败忽略 */
  }
}

// 监听消息变化，实时写 localStorage
watch(msgs, saveHistory, { deep: true });

// ===== 滚动到底部 =====
function scrollBottom() {
  nextTick(() => msgsEnd.value?.scrollIntoView({ behavior: 'smooth' }));
}

// ===== 添加消息 =====
function addMsg(role: 'agent' | 'ai' | 'user', text: string) {
  msgs.value.push({ id: ++msgId, role, text, feedback: null });
  scrollBottom();
}

// ===== 访客 WS 连接（含重试） =====
function connectVisitorWsWithRetry(sid: string) {
  wsStatus.value = 'connecting';
  visitorWs = connectVisitorWs(
    sid,
    handleVisitorWsMessage,
    () => {
      // 连接成功（含首次连接和重连后），凭 lastSeq 拉增量补齐空窗消息
      wsStatus.value = 'connected';
      wsRetryCount = 0;
      if (wsRetryTimer) {
        clearTimeout(wsRetryTimer);
        wsRetryTimer = null;
      }
      void fetchMissingMessages(sid);
    },
    (event: CloseEvent) => {
      visitorWs = null;
      wsStatus.value = 'disconnected';

      // code 1000 = 服务端正常关闭（座席结束会话）
      if (event.code === 1000) {
        addMsg('agent', '✅ 会话已结束，感谢您的使用。');
        localStorage.removeItem(`chat_transferred_${sid}`);
        transferred.value = false;
        wsRetryCount = 0;
        return;
      }

      // 非正常断线：尝试自动重连
      if (wsRetryCount < WS_MAX_RETRY) {
        const delay = WS_RETRY_DELAY_MS[wsRetryCount] ?? 8000;
        wsRetryCount++;
        addMsg(
          'ai',
          `⚠️ 连接中断，${delay / 1000}s 后自动重连（${wsRetryCount}/${WS_MAX_RETRY}）...`,
        );
        wsRetryTimer = setTimeout(() => connectVisitorWsWithRetry(sid), delay);
      } else {
        // 重试耗尽，清除人工模式状态
        addMsg('ai', '⚠️ 与客服的连接已断开，请重新点击「转人工」或刷新页面。');
        localStorage.removeItem(`chat_transferred_${sid}`);
        transferred.value = false;
        wsRetryCount = 0;
      }
    },
  );
}

// ===== 访客 WS 消息处理 =====
function handleVisitorWsMessage(msg: WsChatMessage) {
  // 跟踪 seq：每条 MESSAGE 类型消息都更新 lastSeq，重连时凭此拉增量
  if (msg.type === 'MESSAGE' && typeof msg.seq === 'number') {
    writeLastSeq(sessionId.value, msg.seq);
  }
  if (msg.type === 'MESSAGE' && msg.role === 'agent') {
    addMsg('agent', msg.content ?? '');
  } else if (msg.type === 'AGENT_JOINED') {
    addMsg('agent', '👤 人工客服已接入，请直接输入您的问题。');
  }
}

/**
 * WS 重连成功后，按 lastSeq 拉增量历史消息，补齐离线期间漏收的座席回复。
 * 仅 agent 角色消息会渲染到聊天窗口（user 消息由本地 echo 显示）。
 */
async function fetchMissingMessages(sid: string) {
  const sinceSeq = readLastSeq(sid);
  if (sinceSeq <= 0) {
    return;
  }
  try {
    const missing = await getVisitorHistoryApi(sid, sinceSeq);
    for (const item of missing) {
      if (item.seq != null && item.seq > readLastSeq(sid)) {
        if (item.role === 'agent' || item.role === 'assistant') {
          addMsg('agent', item.content);
        }
        writeLastSeq(sid, item.seq);
      }
    }
  } catch {
    // 拉增量失败不阻断主流程，下次重连仍可补齐
  }
}

// ===== 转人工 =====
async function requestTransfer() {
  if (transferred.value) return;
  const tag = detectTag();
  try {
    await transferToAgentApi({
      sessionId: sessionId.value,
      userName: isAuth.value ? authLabel.value : '访客',
      transferReason: '用户主动请求转人工',
      tag,
    });
    transferred.value = true;
    wsRetryCount = 0;
    localStorage.setItem(`chat_transferred_${sessionId.value}`, '1');
    addMsg('ai', '✅ 已为您转接人工客服，请稍候，座席将在 1-3 分钟内接入。');
    connectVisitorWsWithRetry(sessionId.value);
  } catch {
    addMsg('ai', '转接失败，请稍后重试或直接拨打客服热线。');
  }
}

function detectTag(): string {
  const userTexts = msgs.value
    .filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join('');
  if (/投诉|损坏|破损|质量|劣质/.test(userTexts)) return '投诉';
  if (/退款|退货|退钱|退费/.test(userTexts)) return '退款';
  if (/订单|快递|物流|发货|配送/.test(userTexts)) return '订单';
  if (/账单|发票|收据|账户/.test(userTexts)) return '账单';
  return '咨询';
}

// ===== 生命周期 =====
const authVisible = ref(false);
const authReason = ref('');
const phone = ref('');
const phoneErr = ref('');
const codeSent = ref(false);
const codeVal = ref('');
const codeErr = ref('');
const countdown = ref(0);
const verifying = ref(false);
let pendingMsg = '';
let cdTimer: ReturnType<typeof setInterval>;

const AUTH_WORDS = ['订单', '退款', '投诉', '账单', '发票', '快递', '损坏'];
const QUICK = [
  '产品标准版定价？',
  '查询我的订单',
  '申请退款流程',
  'API 接口文档',
];

onMounted(() => {
  let sid = localStorage.getItem('chat_session_id');
  if (!sid) {
    sid = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('chat_session_id', sid);
  }
  sessionId.value = sid;

  // 恢复历史消息
  loadHistory();

  // 恢复转人工 WebSocket 连接（含自动重试）
  const wasTransferred =
    localStorage.getItem(`chat_transferred_${sid}`) === '1';
  if (wasTransferred) {
    transferred.value = true;
    wsRetryCount = 0;
    connectVisitorWsWithRetry(sid);
  }
});

onUnmounted(() => {
  clearInterval(cdTimer);
  if (wsRetryTimer) {
    clearTimeout(wsRetryTimer);
    wsRetryTimer = null;
  }
  visitorWs?.close();
});

// ===== 发送消息 =====
function sendMsg() {
  const text = inputText.value.trim();
  if (!text || streaming.value) return;
  inputText.value = '';

  // 先把消息推入列表，拿到引用再传给 sendWsWithLoading
  const userMsg: Msg = {
    id: ++msgId,
    role: 'user',
    text,
    retryText: text,
    feedback: null,
  };
  msgs.value.push(userMsg);
  scrollBottom();

  if (transferred.value) {
    sendWsWithLoading(userMsg);
    return;
  }

  const needsAuth = AUTH_WORDS.some((w) => text.includes(w));
  if (needsAuth && !isAuth.value) {
    pendingMsg = text;
    setTimeout(() => {
      addMsg('ai', '这个问题需要验证手机号才能处理，请先完成身份验证 📱');
      showAuth(`处理"${text.slice(0, 12)}..."需要验证身份`);
    }, 400);
    return;
  }
  replyFor(text);
}

/** 转人工模式：发 WS 消息并显示 sending 状态，失败时标记可重试 */
function sendWsWithLoading(targetMsg: Msg) {
  targetMsg.sending = true;
  targetMsg.failed = false;

  if (!visitorWs || visitorWs.readyState !== WebSocket.OPEN) {
    targetMsg.sending = false;
    targetMsg.failed = true;
    return;
  }

  try {
    sendWsMessage(visitorWs, targetMsg.retryText ?? '');
    // WS 发送是同步入队，250ms 后取消 loading（无法拿到服务端确认）
    setTimeout(() => {
      targetMsg.sending = false;
    }, 250);
  } catch {
    targetMsg.sending = false;
    targetMsg.failed = true;
  }
}

/** 重试失败消息（WS 模式或 AI 模式通用） */
function retryMsg(m: Msg) {
  if (!m.retryText) return;
  m.failed = false;
  m.sending = false;

  if (transferred.value) {
    // WS 重试：直接传入消息引用，不依赖 msgs 末尾索引
    sendWsWithLoading(m);
  } else {
    // AI 重试：移除失败的 ai 气泡，重新调 replyFor
    const lastAi = [...msgs.value]
      .toReversed()
      .find((x) => x.role === 'ai' && x.failed);
    if (lastAi) msgs.value.splice(msgs.value.indexOf(lastAi), 1);
    if (m.retryText) replyFor(m.retryText);
  }
}

async function replyFor(text: string) {
  streaming.value = true;
  const m: Msg = {
    id: ++msgId,
    role: 'ai',
    text: '',
    sources: [],
    feedback: null,
    retryText: text,
  };
  msgs.value.push(m);
  scrollBottom();

  try {
    const response = await fetch('/chat-api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.value, message: text }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const raw = decoder.decode(value, { stream: true });
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          streaming.value = false;
          return;
        }
        if (data) {
          m.text += data;
          scrollBottom();
        }
      }
    }
  } catch {
    m.text = '抱歉，AI 服务暂时不可用，请点击重试。';
    m.failed = true;
  } finally {
    streaming.value = false;
  }
}

// ===== 工具方法 =====
function setFeedback(m: Msg, type: 'down' | 'up') {
  m.feedback = type;
}
function quickAsk(q: string) {
  inputText.value = q;
  sendMsg();
}
function showAuth(reason: string) {
  authReason.value = reason;
  authVisible.value = true;
}

function sendCode() {
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    phoneErr.value = '请输入正确的手机号';
    return;
  }
  phoneErr.value = '';
  // 调用真实短信发送接口
  sendSmsCodeApi(phone.value)
    .then(() => {
      codeSent.value = true;
      codeVal.value = '';
      startCountdown();
      message.success('验证码已发送，请注意查收');
    })
    .catch(() => {
      phoneErr.value = '发送验证码失败，请稍后重试';
    });
}

function startCountdown() {
  countdown.value = 60;
  clearInterval(cdTimer);
  cdTimer = setInterval(() => {
    if (--countdown.value <= 0) clearInterval(cdTimer);
  }, 1000);
}

function verifyCode() {
  if (codeVal.value.length < 6) {
    codeErr.value = '请输入 6 位验证码';
    return;
  }
  codeErr.value = '';
  verifying.value = true;
  // 调用真实后端验证接口，由服务端判断验证码是否正确
  verifySmsCodeApi(phone.value, codeVal.value)
    .then(() => {
      verifying.value = false;
      authVisible.value = false;
      isAuth.value = true;
      authLabel.value = `已登录 · ${phone.value.slice(0, 3)}****${phone.value.slice(-4)}`;
      addMsg(
        'ai',
        `✅ 身份验证成功！账号已关联，历史订单信息已加载。${pendingMsg ? '\n\n正在处理您刚才的问题...' : ''}`,
      );
      if (pendingMsg) {
        const p = pendingMsg;
        pendingMsg = '';
        setTimeout(() => replyFor(p), 800);
      }
      message.success('验证成功，长期记忆已加载');
    })
    .catch(() => {
      verifying.value = false;
      codeErr.value = '验证码错误，请重试';
      codeVal.value = '';
    });
}

function closeAuth() {
  authVisible.value = false;
  codeSent.value = false;
  phone.value = '';
  codeVal.value = '';
  phoneErr.value = '';
  codeErr.value = '';
}

function handleEnter(e: KeyboardEvent) {
  if (!e.shiftKey) {
    e.preventDefault();
    sendMsg();
  }
}

// ===== 清除本会话历史 =====
function clearHistory() {
  msgs.value = [];
  msgId = 0;
  localStorage.removeItem(HISTORY_KEY_PREFIX + sessionId.value);
}
</script>

<template>
  <!-- 主题隔离：data-theme="light" + 强制白底，不受后台暗色模式影响 -->
  <div
    data-theme="light"
    class="flex h-screen w-screen items-center justify-center p-4"
    style="
      color-scheme: light;
      background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
    "
  >
    <div
      class="flex w-full max-w-2xl flex-col rounded-2xl shadow-xl"
      style="
        height: 90vh;
        max-height: 800px;
        background: #fff;
        border: 1px solid #f1f5f9;
      "
    >
      <!-- 顶栏 -->
      <div
        class="flex shrink-0 items-center gap-3 px-5 py-4"
        style="border-bottom: 1px solid #f1f5f9"
      >
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style="flex-shrink: 0; background: #4f46e5"
        >
          AI
        </div>
        <div>
          <p class="text-sm font-semibold" style="color: #1e293b">
            智能客服助手
          </p>
          <p class="flex items-center gap-1 text-xs" style="color: #10b981">
            <span
              class="inline-block h-1.5 w-1.5 rounded-full"
              style="background: #10b981"
            ></span>
            在线服务中
          </p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <!-- 清除历史 -->
          <button
            class="flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-gray-100"
            title="清除对话记录"
            @click="clearHistory"
          >
            <Icon
              icon="lucide:trash-2"
              class="text-sm"
              style="color: #94a3b8"
            />
          </button>
          <!-- 转人工 -->
          <button
            v-if="!transferred"
            class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition"
            style="
              color: #475569;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
            "
            @click="requestTransfer"
          >
            <Icon icon="lucide:headphones" class="text-xs" />
            转人工
          </button>
          <span
            v-else
            class="rounded-full px-2.5 py-1 text-xs font-medium"
            style="
              color: #16a34a;
              background: #f0fdf4;
              border: 1px solid #bbf7d0;
            "
            >👤 人工服务中</span>
          <!-- 身份状态 -->
          <span
            class="cursor-pointer select-none rounded-full px-3 py-1 text-xs font-medium transition"
            :style="
              isAuth
                ? 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0'
                : 'background:#f8fafc;color:#475569;border:1px solid #e2e8f0'
            "
            @click="
              () => {
                if (!isAuth) showAuth('立即登录享受完整服务');
              }
            "
            >{{ isAuth ? `✅ ${authLabel}` : `🔓 ${authLabel}` }}</span>
        </div>
      </div>

      <!-- 访客提示条 -->
      <div v-if="!isAuth" class="mx-4 mt-3 shrink-0">
        <div
          class="rounded-lg px-3 py-2 text-xs"
          style="color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe"
        >
          ℹ️ 当前为访客模式，可咨询通用问题。
          <a
            class="cursor-pointer font-semibold underline"
            @click="showAuth('登录后享受完整服务')"
            >立即登录</a>
          后可查询订单、申请退款等。
        </div>
      </div>

      <!-- 消息区 -->
      <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <!-- 欢迎语 -->
        <div v-if="msgs.length === 0" class="flex gap-3">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style="flex-shrink: 0; color: #4f46e5; background: #e0e7ff"
          >
            AI
          </div>
          <div
            class="max-w-md rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
            style="color: #374151; background: #f8fafc"
          >
            您好！我是智能客服助手。<br />
            📌 <strong>无需登录</strong>可直接咨询产品问题。<br />
            📦 查询订单、退款等操作需要<strong>验证手机号</strong>。
          </div>
        </div>

        <!-- 消息列表 -->
        <div
          v-for="m in msgs"
          :key="m.id"
          class="flex gap-3"
          :class="[m.role === 'user' ? 'flex-row-reverse' : '']"
        >
          <!-- 头像 -->
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            :style="
              m.role === 'user'
                ? `background:${isAuth ? '#8b5cf6' : '#9ca3af'};color:#fff;flex-shrink:0`
                : m.role === 'agent'
                  ? 'background:#0ea5e9;color:#fff;flex-shrink:0'
                  : 'background:#e0e7ff;color:#4f46e5;flex-shrink:0'
            "
          >
            {{ m.role === 'user' ? '我' : m.role === 'agent' ? '客服' : 'AI' }}
          </div>

          <div
            class="max-w-sm"
            :class="[m.role === 'user' ? 'flex flex-col items-end' : '']"
          >
            <!-- 发送方标签 -->
            <p
              v-if="m.role !== 'user'"
              class="mb-1 text-xs"
              :style="
                m.role === 'agent'
                  ? 'color:#0ea5e9;font-weight:500'
                  : 'color:#9ca3af'
              "
            >
              {{ m.role === 'agent' ? '👤 人工客服' : '🤖 AI 助手' }}
            </p>

            <!-- 气泡 -->
            <div
              class="whitespace-pre-line px-4 py-3 text-sm leading-relaxed"
              :class="
                m.role === 'user'
                  ? 'rounded-2xl rounded-tr-sm'
                  : 'rounded-2xl rounded-tl-sm'
              "
              :style="
                m.role === 'user'
                  ? `background:${m.failed ? '#fee2e2' : '#4f46e5'};color:${m.failed ? '#dc2626' : '#fff'}`
                  : m.role === 'agent'
                    ? 'background:#f0f9ff;border:1px solid #bae6fd;color:#1e293b'
                    : `background:${m.failed ? '#fff7ed' : '#f8fafc'};color:${m.failed ? '#c2410c' : '#374151'};${m.failed ? 'border:1px solid #fed7aa' : ''}`
              "
            >
              <!-- AI 流式光标 -->
              <template v-if="!m.failed">
                {{ m.text }}
                <span
                  v-if="
                    streaming &&
                    m === msgs[msgs.length - 1] &&
                    m.role === 'ai' &&
                    !m.failed
                  "
                  class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse align-middle"
                  style="background: #6366f1"
                ></span>
              </template>
              <!-- 失败提示 -->
              <template v-else>
                <span>{{ m.text }}</span>
              </template>
            </div>

            <!-- user 消息：sending 转圈 / failed 重试 -->
            <div
              v-if="m.role === 'user'"
              class="mt-1 flex items-center gap-1.5"
            >
              <span
                v-if="m.sending"
                class="flex items-center gap-1 text-xs"
                style="color: #94a3b8"
              >
                <Icon icon="lucide:loader-2" class="animate-spin text-xs" />
                发送中...
              </span>
              <button
                v-else-if="m.failed"
                class="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition"
                style="
                  color: #dc2626;
                  background: #fef2f2;
                  border: 1px solid #fecaca;
                "
                @click="retryMsg(m)"
              >
                <Icon icon="lucide:rotate-ccw" class="text-xs" />
                重试
              </button>
            </div>

            <!-- AI 消息：失败重试 -->
            <div v-if="m.role === 'ai' && m.failed" class="mt-1.5">
              <button
                class="flex items-center gap-1 rounded px-2 py-0.5 text-xs transition"
                style="
                  color: #c2410c;
                  background: #fff7ed;
                  border: 1px solid #fed7aa;
                "
                @click="retryMsg(m)"
              >
                <Icon icon="lucide:rotate-ccw" class="text-xs" />
                重新生成
              </button>
            </div>

            <!-- 溯源标签 -->
            <div v-if="m.sources?.length" class="mt-1.5 flex flex-wrap gap-1">
              <span
                v-for="s in m.sources"
                :key="s"
                class="cursor-pointer rounded-full px-2 py-0.5 text-xs"
                style="
                  color: #3b82f6;
                  background: #eff6ff;
                  border: 1px solid #bfdbfe;
                "
                >📄 {{ s }}</span>
            </div>

            <!-- 反馈（AI 非失败消息） -->
            <div
              v-if="m.role === 'ai' && !streaming && !m.failed"
              class="ml-1 mt-1.5 flex items-center gap-2"
            >
              <span class="text-xs" style="color: #9ca3af">有帮助吗？</span>
              <button
                class="rounded p-0.5 transition hover:bg-gray-100"
                @click="setFeedback(m, 'up')"
              >
                <Icon
                  icon="lucide:thumbs-up"
                  class="text-sm"
                  :style="
                    m.feedback === 'up' ? 'color:#10b981' : 'color:#d1d5db'
                  "
                />
              </button>
              <button
                class="rounded p-0.5 transition hover:bg-gray-100"
                @click="setFeedback(m, 'down')"
              >
                <Icon
                  icon="lucide:thumbs-down"
                  class="text-sm"
                  :style="
                    m.feedback === 'down' ? 'color:#ef4444' : 'color:#d1d5db'
                  "
                />
              </button>
            </div>
          </div>
        </div>
        <div ref="msgsEnd"></div>
      </div>

      <!-- 快捷问题 -->
      <div
        class="shrink-0 px-4 pt-2 pb-1"
        style="border-top: 1px solid #f8fafc"
      >
        <p
          class="mb-1.5 flex items-center gap-1 text-xs"
          style="color: #9ca3af"
        >
          <Icon icon="lucide:zap" style="color: #f59e0b" />
          试试这些问题
        </p>
        <div class="flex gap-2 overflow-x-auto pb-1">
          <span
            v-for="q in QUICK"
            :key="q"
            class="shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs transition"
            style="
              color: #475569;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
            "
            @click="quickAsk(q)"
            >{{ q }}</span>
        </div>
      </div>

      <!-- 输入框 -->
      <div class="shrink-0 px-4 py-3" style="border-top: 1px solid #f1f5f9">
        <div class="flex items-end gap-2">
          <Textarea
            v-model:value="inputText"
            placeholder="输入您的问题..."
            :auto-size="{ minRows: 1, maxRows: 4 }"
            class="flex-1"
            @keydown.enter="handleEnter"
          />
          <Button
            type="primary"
            :loading="streaming"
            :disabled="!inputText.trim()"
            class="flex h-10 w-10 shrink-0 items-center justify-center"
            @click="sendMsg"
          >
            <template #icon><Icon icon="lucide:send" /></template>
          </Button>
        </div>
        <p class="mt-2 text-center text-xs" style="color: #94a3b8">
          AI 回答仅供参考，重要事项请联系人工确认
        </p>
      </div>
    </div>

    <!-- 身份验证 Modal -->
    <Modal
      v-model:open="authVisible"
      title="身份验证"
      :footer="null"
      :width="380"
      centered
      @cancel="closeAuth"
    >
      <div class="space-y-4 py-2">
        <Alert :message="authReason" type="info" show-icon class="text-xs" />
        <Form layout="vertical">
          <FormItem
            label="手机号"
            :validate-status="phoneErr ? 'error' : ''"
            :help="phoneErr"
          >
            <InputGroup compact>
              <Input
                v-model:value="phone"
                placeholder="请输入手机号"
                :maxlength="11"
                :disabled="codeSent"
                style="width: calc(100% - 112px)"
              />
              <Button
                type="primary"
                :disabled="codeSent && countdown > 0"
                style="width: 112px"
                @click="sendCode"
              >
                {{
                  codeSent && countdown > 0
                    ? `${countdown}s 后重发`
                    : '发送验证码'
                }}
              </Button>
            </InputGroup>
          </FormItem>
          <FormItem
            v-if="codeSent"
            label="验证码"
            :validate-status="codeErr ? 'error' : ''"
            :help="codeErr"
          >
            <Input
              v-model:value="codeVal"
              placeholder="请输入 6 位验证码"
              :maxlength="6"
              allow-clear
              @press-enter="verifyCode"
            />
          </FormItem>
          <Button
            v-if="codeSent"
            type="primary"
            block
            :loading="verifying"
            @click="verifyCode"
          >
            {{ verifying ? '验证中...' : '立即验证' }}
          </Button>
        </Form>
        <p class="text-center text-xs" style="color: #94a3b8">
          验证后即视为同意 <a>服务协议</a> 与 <a>隐私政策</a>
        </p>
      </div>
    </Modal>
  </div>
</template>
