<script lang="ts" setup>
// ===== 主题隔离：强制 light 模式，不受后台暗色主题影响 =====
// Vben Admin 通过给 <html> 加 dark class 切换主题，chat 页独立渲染需主动隔离

import type { Msg } from '#/composables/useVisitorSession';

import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';

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
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { useAuth } from '#/composables/useAuth';
import { useSSEStream } from '#/composables/useSSEStream';
import { useTransfer } from '#/composables/useTransfer';
import { useVisitorSession } from '#/composables/useVisitorSession';
import { useVisitorWs } from '#/composables/useVisitorWs';

// 配置 marked：开启 breaks（单个 \n 转 <br>），gfm 支持表格/删除线
// 放在所有 import 之后避免 import(first) lint 报错
marked.use({ breaks: true, gfm: true });

// ===== 常量 =====
/** 需要身份验证的关键词列表 */
const AUTH_WORDS = ['订单', '退款', '投诉', '账单', '发票', '快递', '损坏'];
/** 快捷问题列表 */
const QUICK = [
  '产品标准版定价？',
  '查询我的订单',
  '申请退款流程',
  'API 接口文档',
];

// ===== 工具方法 =====
function scrollBottom() {
  nextTick(() => msgsEnd.value?.scrollIntoView({ behavior: 'smooth' }));
}

// ===== UI 状态 =====
const msgsEnd = ref<HTMLDivElement>();
const inputText = ref('');
/** 待处理消息（身份验证完成后自动发送） */
let pendingMsg = '';
/** 座席主动结束会话后为 true，此时底部显示「开始新对话」按钮 */
const sessionEnded = ref(false);

// ===== URL 参数：域码（用于后端域路由） =====
// 支持 ?domain=weather 和 ?domainCode=weather 两种写法
const route = useRoute();
const domainCode = computed(
  () =>
    (route.query.domainCode as string) || (route.query.domain as string) || '',
);

// ===== Composables =====

// 1. 会话与历史
const {
  sessionId,
  msgs,
  initSession,
  loadHistory,
  clearSession,
  appendMsg,
  readLastSeq,
  writeLastSeq,
} = useVisitorSession();

// 2. 身份验证
const auth = useAuth((_label) => {
  appendMsg(
    'ai',
    `✅ 身份验证成功！账号已关联，历史订单信息已加载。${
      pendingMsg ? '\n\n正在处理您刚才的问题...' : ''
    }`,
  );
  message.success('验证成功，长期记忆已加载');
  if (pendingMsg) {
    const p = pendingMsg;
    pendingMsg = '';
    setTimeout(() => replyFor(p), 800);
  }
});

// 3. 转接人工
const transfer = useTransfer(
  sessionId,
  () =>
    msgs.value
      .filter((m) => m.role === 'user')
      .map((m) => m.text)
      .join(''),
  () => {
    // 转接成功：建立 WS 连接
    ws.connect(sessionId.value);
  },
);

// 4. WebSocket
// agentJoined：座席真正接入后才为 true（区别于 transferred，后者在排队时就是 true）
const agentJoined = ref(false);
const ws = useVisitorWs(sessionId, readLastSeq, writeLastSeq, {
  onAgentMessage: (content) => {
    appendMsg('agent', content);
    scrollBottom();
  },
  onAgentJoined: () => {
    agentJoined.value = true;
    scrollBottom();
  },
  onSessionClosed: () => {
    // 追加语义化「会话结束」分隔条，并切换到「查看历史 + 新对话」模式
    appendMsg('ai', '本次会话已结束，感谢您的使用。', {
      subType: 'session_end',
    });
    transfer.clearTransferred(sessionId.value);
    agentJoined.value = false;
    sessionEnded.value = true;
  },
  onMaxRetryExceeded: () => {
    // 重试耗尽：仅清除座席已接入标记，保留转接状态让用户可手动重连
    // （wsStatus 变为 'disconnected'，banner 自动切换为红色「立即重连」按钮）
    agentJoined.value = false;
  },
  onReconnecting: (_attempt, _delaySec) => {
    // wsStatus 已变为 'connecting'，banner 会自动显示旋转动画，无需额外处理
  },
});

// 5. SSE 流式对话（第 3 个参数把 URL 上的 domainCode 透传给后端）
const sse = useSSEStream(
  sessionId,
  {
    onToken: (text) => {
      // 将 token 追加到当前 AI 气泡（由 replyFor 创建并传引用）
      if (currentAiMsgId !== null) {
        const m = getCurrentAiMsg();
        if (m) {
          m.text += text;
          scrollBottom();
        }
      }
    },
    onSources: (sources) => {
      const m = getCurrentAiMsg();
      if (m) m.sources = sources;
    },
    onToolCall: (payload) => {
      const m = getCurrentAiMsg();
      if (!m) return;
      if (!m.tools) m.tools = [];
      const idx = m.tools.findIndex((t) => t.name === payload.tool);
      const status = { name: payload.tool, status: 'running' as const };
      if (idx === -1) m.tools.push(status);
      else m.tools[idx] = status;
      scrollBottom();
    },
    onToolDone: (payload) => {
      const m = getCurrentAiMsg();
      if (!m?.tools) return;
      const idx = m.tools.findIndex((t) => t.name === payload.tool);
      if (idx === -1) return;
      const isErr = payload.status === 'error' || Boolean(payload.errorMsg);
      m.tools[idx] = {
        name: payload.tool,
        status: isErr ? 'error' : 'done',
        durationMs: payload.durationMs,
      };
    },
    onTransfer: () => {
      // 后端工具已完成入队（session → WAITING），前端只需同步 UI 状态
      // 不重复调用 POST /chat/transfer（会二次入队导致 SessionEnqueueException）
      transfer.markTransferred(sessionId.value);
      ws.connect(sessionId.value);
    },
    onError: (msg) => {
      const m = getCurrentAiMsg();
      if (m) {
        m.text = msg;
        m.failed = true;
      }
    },
    onDone: () => {
      /* streaming 状态由 useSSEStream 内部管理 */
    },
  },
  () => domainCode.value,
);

/** 当前正在流式填充的 AI 气泡 ID（通过 ID 查找规避 splice 后 proxy 引用失效） */
let currentAiMsgId: null | number = null;

/** 获取当前流式气泡的响应式引用，找不到返回 null */
function getCurrentAiMsg(): Msg | null {
  if (currentAiMsgId === null) return null;
  return msgs.value.find((m) => m.id === currentAiMsgId) ?? null;
}

/**
 * Markdown 渲染缓存：按 msg.id 缓存 DOMPurify 净化后的 HTML，
 * 避免每次 re-render 都对全部 AI 消息重新执行 marked.parse + sanitize。
 */
const renderedHtmlMap = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {};
  for (const m of msgs.value) {
    if (m.role === 'ai' && m.text) {
      map[m.id] = DOMPurify.sanitize(
        marked.parse(m.text, { async: false }) as string,
      );
    }
  }
  return map;
});

// ===== 生命周期 =====

onMounted(async () => {
  const sid = initSession();
  loadHistory();
  scrollBottom();
  // 两重兜底恢复转接状态（localStorage 快路径 + 后端状态查询兜底）
  // 若后端确认为 ACTIVE（座席已接入），同步设置 agentJoined，确保 TYPING 信号守卫正确
  await transfer.restoreTransferState(sid, () => {
    agentJoined.value = true;
  });
});

onUnmounted(() => {
  sse.abort();
  ws.disconnect();
  auth.cleanup();
  if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
});

// ===== 消息发送 =====

function sendMsg() {
  const text = inputText.value.trim();
  if (!text || sse.streaming.value) return;
  inputText.value = '';

  const userMsg = appendMsg('user', text, { retryText: text });
  scrollBottom();

  if (transfer.transferred.value) {
    sendWsWithLoading(userMsg);
    return;
  }

  const needsAuth = AUTH_WORDS.some((w) => text.includes(w));
  if (needsAuth && !auth.isAuth.value) {
    pendingMsg = text;
    setTimeout(() => {
      appendMsg('ai', '这个问题需要验证手机号才能处理，请先完成身份验证 📱');
      auth.showAuth(`处理"${text.slice(0, 12)}..."需要验证身份`);
    }, 400);
    return;
  }
  replyFor(text);
}

function handleEnter(e: KeyboardEvent) {
  if (!e.shiftKey) {
    e.preventDefault();
    sendMsg();
  }
}

// 访客输入中信号：仅在座席已接入（agentJoined）时发送。
// transferred=true 时会话可能仍在排队（WAITING），座席未接入，发送无意义。
let typingDebounceTimer: null | ReturnType<typeof setTimeout> = null;
function handleTypingInput() {
  if (!agentJoined.value) return;
  if (typingDebounceTimer) return; // 防抖：500ms 内只发一次
  ws.sendTyping();
  typingDebounceTimer = setTimeout(() => {
    typingDebounceTimer = null;
  }, 500);
}

function quickAsk(q: string) {
  inputText.value = q;
  sendMsg();
}

// ===== AI 流式回复 =====

async function replyFor(text: string) {
  currentAiMsgId = appendMsg('ai', '', { sources: [], retryText: text }).id;
  scrollBottom();
  await sse.send(text);
}

// ===== 转人工模式：WS 发送 =====

/** 转人工模式下发 WS 消息，带 sending 状态和失败重试 */
function sendWsWithLoading(targetMsg: Msg) {
  targetMsg.sending = true;
  targetMsg.failed = false;

  const ok = ws.sendText(targetMsg.retryText ?? '');
  if (!ok) {
    targetMsg.sending = false;
    targetMsg.failed = true;
    return;
  }
  // WS 发送是同步入队，250ms 后取消 loading（无法拿到服务端确认）
  setTimeout(() => {
    targetMsg.sending = false;
  }, 250);
}

/** 重试失败消息（WS 模式或 AI 模式通用） */
function retryMsg(m: Msg) {
  if (!m.retryText) return;
  m.failed = false;
  m.sending = false;

  if (transfer.transferred.value) {
    sendWsWithLoading(m);
  } else {
    // 移除失败的 AI 气泡，重新调 replyFor
    const lastAi = [...msgs.value]
      .toReversed()
      .find((x) => x.role === 'ai' && x.failed);
    if (lastAi) msgs.value.splice(msgs.value.indexOf(lastAi), 1);
    replyFor(m.retryText);
  }
}

// ===== 工具方法 =====

function setFeedback(m: Msg, type: 'down' | 'up') {
  m.feedback = type;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败');
  }
}

function clearHistory() {
  clearSession();
  currentAiMsgId = null;
  sessionEnded.value = false;
  // 清除后立即初始化新 sessionId，避免用户下一条消息发送时无 sessionId
  initSession();
}

/**
 * 会话结束后开始新对话。
 * 保留当前 msgs（含历史 + 分隔条），追加新对话开始标记，
 * 生成新 sessionId，重置会话相关状态。
 * 新消息将发送到新 session，历史记录仍在同一窗口可见。
 */
function startNewSession() {
  const newSid = `guest-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  // 追加新对话开始分隔条（保留历史消息在同一窗口内）
  appendMsg('ai', '新对话开始', { subType: 'session_start' });
  scrollBottom();

  // 切换到新 session，重置会话状态（不清空 msgs，让用户能看到上下文）
  localStorage.setItem('chat_session_id', newSid);
  sessionId.value = newSid;
  sessionEnded.value = false;
  transfer.clearTransferred(newSid);
  agentJoined.value = false;
  currentAiMsgId = null;
  inputText.value = '';
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
      <!-- ===== 顶栏 ===== -->
      <div
        class="flex shrink-0 items-center gap-3 px-5 py-4"
        style="border-bottom: 1px solid #f1f5f9"
      >
        <!-- Logo -->
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style="background: #4f46e5"
        >
          AI
        </div>
        <!-- 标题 -->
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
        <!-- 操作按钮区 -->
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
          <!-- 转人工 / 人工服务中 -->
          <button
            v-if="!transfer.transferred.value"
            class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition"
            style="
              color: #475569;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
            "
            @click="transfer.requestTransfer()"
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
          >
            👤 人工服务中
          </span>
          <!-- 身份状态 -->
          <span
            class="cursor-pointer select-none rounded-full px-3 py-1 text-xs font-medium transition"
            :style="
              auth.isAuth.value
                ? 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0'
                : 'background:#f8fafc;color:#475569;border:1px solid #e2e8f0'
            "
            @click="
              () => {
                if (!auth.isAuth.value) auth.showAuth('立即登录享受完整服务');
              }
            "
          >
            {{
              auth.isAuth.value
                ? `✅ ${auth.authLabel.value}`
                : `🔓 ${auth.authLabel.value}`
            }}
          </span>
        </div>
      </div>

      <!-- ===== 访客提示条 ===== -->
      <div v-if="!auth.isAuth.value" class="mx-4 mt-3 shrink-0">
        <div
          class="rounded-lg px-3 py-2 text-xs"
          style="color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe"
        >
          ℹ️ 当前为访客模式，可咨询通用问题。
          <a
            class="cursor-pointer font-semibold underline"
            @click="auth.showAuth('登录后享受完整服务')"
            >立即登录</a
          >
          后可查询订单、申请退款等。
        </div>
      </div>

      <!-- ===== WS 重连提示条（转人工模式下断线时显示） ===== -->
      <div
        v-if="transfer.transferred.value && ws.wsStatus.value !== 'connected'"
        class="mx-4 mt-2 shrink-0 flex items-center gap-2.5 rounded-lg px-3.5 py-2.5"
        :style="
          ws.wsStatus.value === 'connecting'
            ? 'background:#fff7e6;border:1px solid #ffd591'
            : 'background:#fff1f0;border:1px solid #ffa39e'
        "
      >
        <Icon
          :icon="
            ws.wsStatus.value === 'connecting'
              ? 'lucide:loader-2'
              : 'lucide:wifi-off'
          "
          class="shrink-0 text-sm"
          :class="[ws.wsStatus.value === 'connecting' ? 'animate-spin' : '']"
          :style="
            ws.wsStatus.value === 'connecting'
              ? 'color:#d46b08'
              : 'color:#cf1322'
          "
        />
        <span
          class="flex-1 text-xs"
          :style="
            ws.wsStatus.value === 'connecting'
              ? 'color:#d46b08'
              : 'color:#cf1322'
          "
        >
          {{
            ws.wsStatus.value === 'connecting'
              ? '正在自动重连，消息可能短暂延迟…'
              : '会话连接已断开，自动重连已停止'
          }}
        </span>
        <!-- 重连中：脉冲点 -->
        <div
          v-if="ws.wsStatus.value === 'connecting'"
          class="flex items-center"
        >
          <span class="relative flex h-2 w-2">
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style="background: #d46b08"
            ></span>
            <span
              class="relative inline-flex h-2 w-2 rounded-full"
              style="background: #d46b08"
            ></span>
          </span>
        </div>
        <!-- 断线停止：手动重连按钮 -->
        <button
          v-else
          class="shrink-0 rounded px-2.5 py-1 text-xs font-medium transition"
          style="color: #cf1322; background: #fff1f0; border: 1px solid #ffa39e"
          @click="ws.connect(sessionId)"
        >
          立即重连
        </button>
      </div>

      <!-- ===== 消息区 ===== -->
      <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <!-- 欢迎语（无消息时显示） -->
        <div v-if="msgs.length === 0" class="flex gap-3">
          <div
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style="color: #4f46e5; background: #e0e7ff"
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
                ? `background:${auth.isAuth.value ? '#8b5cf6' : '#9ca3af'};color:#fff;flex-shrink:0`
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
              class="px-4 py-3 text-sm leading-relaxed"
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
              <!-- AI 思考中动画 -->
              <span
                v-if="
                  sse.streaming.value &&
                  m === msgs[msgs.length - 1] &&
                  m.role === 'ai' &&
                  !m.text &&
                  !m.failed
                "
                class="flex gap-1 py-1"
              >
                <span
                  class="h-2 w-2 animate-bounce rounded-full"
                  style="background: #818cf8; animation-delay: 0ms"
                ></span>
                <span
                  class="h-2 w-2 animate-bounce rounded-full"
                  style="background: #818cf8; animation-delay: 150ms"
                ></span>
                <span
                  class="h-2 w-2 animate-bounce rounded-full"
                  style="background: #818cf8; animation-delay: 300ms"
                ></span>
              </span>
              <!-- 正常内容：Markdown 渲染 -->
              <template v-else-if="!m.failed">
                <!-- 会话结束分隔条 -->
                <template v-if="m.subType === 'session_end'">
                  <div class="session-divider session-end">
                    <Icon icon="lucide:check-circle" class="text-sm" />
                    <span>{{ m.text }}</span>
                  </div>
                </template>
                <!-- 新对话开始分隔条 -->
                <template v-else-if="m.subType === 'session_start'">
                  <div class="session-divider session-start">
                    <Icon icon="lucide:message-circle-plus" class="text-sm" />
                    <span>{{ m.text }}</span>
                  </div>
                </template>
                <!-- 常规 AI Markdown 消息（DOMPurify 净化）+ 工具状态条 -->
                <template v-else-if="m.role === 'ai'">
                  <!-- 工具调用状态（内嵌到同一气泡顶部） -->
                  <div v-if="m.tools && m.tools.length" class="tool-status-row">
                    <div
                      v-for="tool in m.tools"
                      :key="tool.name"
                      class="tool-status-item"
                    >
                      <span v-if="tool.status === 'running'" class="tool-run">
                        🔄
                      </span>
                      <span v-else-if="tool.status === 'done'" class="tool-ok">
                        ✅
                      </span>
                      <span v-else class="tool-err">❌</span>
                      <span class="tool-name">{{ tool.name }}</span>
                      <span v-if="tool.status === 'running'" class="tool-hint">
                        查询中...
                      </span>
                      <span v-else-if="tool.durationMs" class="tool-hint">
                        {{ tool.durationMs }}ms
                      </span>
                    </div>
                  </div>
                  <div
                    v-if="m.text"
                    class="widget-ai-md"
                    v-html="renderedHtmlMap[m.id] ?? ''"
                  ></div>
                </template>
                <span
                  v-else
                  style="
                    word-break: normal;
                    overflow-wrap: break-word;
                    white-space: pre-wrap;
                  "
                  >{{ m.text }}</span
                >
                <!-- 打字光标（流式进行中） -->
                <span
                  v-if="
                    sse.streaming.value &&
                    m === msgs[msgs.length - 1] &&
                    m.role === 'ai' &&
                    m.text
                  "
                  class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse align-middle"
                  style="background: #6366f1"
                ></span>
              </template>
              <!-- 失败内容 -->
              <template v-else>
                <span>{{ m.text }}</span>
              </template>
            </div>

            <!-- 时间戳 + 复制 -->
            <div
              v-if="m.time"
              class="mt-0.5 flex items-center gap-1.5"
              :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <span class="text-xs" style="color: #cbd5e1">{{ m.time }}</span>
              <button
                v-if="m.role === 'ai' && m.text && !m.failed"
                class="text-xs transition"
                style="color: #cbd5e1"
                title="复制"
                @click.stop="copyText(m.text)"
              >
                <Icon icon="lucide:copy" class="h-3 w-3" />
              </button>
            </div>

            <!-- 用户消息：sending 转圈 / failed 重试 -->
            <div
              v-if="m.role === 'user'"
              class="mt-1 flex items-center gap-1.5"
            >
              <span
                v-if="m.sending"
                class="flex items-center gap-1 text-xs"
                style="color: #94a3b8"
              >
                <Icon
                  icon="lucide:loader-2"
                  class="animate-spin text-xs"
                />发送中...
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
                <Icon icon="lucide:rotate-ccw" class="text-xs" />重试
              </button>
            </div>

            <!-- AI 消息：失败重新生成 -->
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
                <Icon icon="lucide:rotate-ccw" class="text-xs" />重新生成
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
                >📄 {{ s }}</span
              >
            </div>

            <!-- 反馈（AI 非失败、非语义子类型消息，流结束后显示） -->
            <div
              v-if="
                m.role === 'ai' &&
                !sse.streaming.value &&
                !m.failed &&
                !m.subType
              "
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

      <!-- ===== 快捷问题 ===== -->
      <div
        class="shrink-0 px-4 pt-2 pb-1"
        style="border-top: 1px solid #f8fafc"
      >
        <p
          class="mb-1.5 flex items-center gap-1 text-xs"
          style="color: #9ca3af"
        >
          <Icon icon="lucide:zap" style="color: #f59e0b" />试试这些问题
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
            >{{ q }}</span
          >
        </div>
      </div>

      <!-- ===== 输入框 / 会话结束操作区 ===== -->
      <div class="shrink-0 px-4 py-3" style="border-top: 1px solid #f1f5f9">
        <!-- 会话已结束：显示「开始新对话」按钮，替代输入框 -->
        <template v-if="sessionEnded">
          <div class="flex flex-col items-center gap-3 py-2">
            <p class="text-xs" style="color: #94a3b8">
              本次会话已结束，您可以查看上方历史记录
            </p>
            <Button type="primary" class="w-full" @click="startNewSession">
              <template #icon>
                <Icon icon="lucide:message-circle-plus" />
              </template>
              开始新对话
            </Button>
          </div>
        </template>
        <template v-else>
          <div class="flex items-end gap-2">
            <Textarea
              v-model:value="inputText"
              placeholder="输入您的问题..."
              :auto-size="{ minRows: 1, maxRows: 4 }"
              class="flex-1"
              @input="handleTypingInput"
              @keydown.enter="handleEnter"
            />
            <Button
              type="primary"
              :loading="sse.streaming.value"
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
        </template>
      </div>
    </div>

    <!-- ===== 身份验证 Modal ===== -->
    <Modal
      v-model:open="auth.authVisible.value"
      title="身份验证"
      :footer="null"
      :width="380"
      centered
      @cancel="auth.closeAuth()"
    >
      <div class="space-y-4 py-2">
        <Alert
          :message="auth.authReason.value"
          type="info"
          show-icon
          class="text-xs"
        />
        <Form layout="vertical">
          <FormItem
            label="手机号"
            :validate-status="auth.phoneErr.value ? 'error' : ''"
            :help="auth.phoneErr.value"
          >
            <InputGroup compact>
              <Input
                v-model:value="auth.phone.value"
                placeholder="请输入手机号"
                :maxlength="11"
                :disabled="auth.codeSent.value"
                style="width: calc(100% - 112px)"
              />
              <Button
                type="primary"
                :disabled="auth.codeSent.value && auth.countdown.value > 0"
                style="width: 112px"
                @click="auth.sendCode()"
              >
                {{
                  auth.codeSent.value && auth.countdown.value > 0
                    ? `${auth.countdown.value}s 后重发`
                    : '发送验证码'
                }}
              </Button>
            </InputGroup>
          </FormItem>
          <FormItem
            v-if="auth.codeSent.value"
            label="验证码"
            :validate-status="auth.codeErr.value ? 'error' : ''"
            :help="auth.codeErr.value"
          >
            <Input
              v-model:value="auth.codeVal.value"
              placeholder="请输入 6 位验证码"
              :maxlength="6"
              allow-clear
              @press-enter="auth.verifyCode()"
            />
          </FormItem>
          <Button
            v-if="auth.codeSent.value"
            type="primary"
            block
            :loading="auth.verifying.value"
            @click="auth.verifyCode()"
          >
            {{ auth.verifying.value ? '验证中...' : '立即验证' }}
          </Button>
        </Form>
        <p class="text-center text-xs" style="color: #94a3b8">
          验证后即视为同意 <a>服务协议</a> 与 <a>隐私政策</a>
        </p>
      </div>
    </Modal>
  </div>
</template>

<style>
/* ===== Markdown 渲染样式 =====
 * Tailwind v4 Preflight 会把 h1~h6 / ul / ol / strong / table 等
 * 原生标签样式清零（list-style: none、margin: 0、font-size: inherit 等），
 * 导致 marked 输出的 HTML 看起来像纯文本。
 * 这里必须显式恢复所有 Markdown 常用标签样式。
 */
.widget-ai-md {
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: break-word;
}

.widget-ai-md > :first-child {
  margin-top: 0;
}

.widget-ai-md > :last-child {
  margin-bottom: 0;
}

.widget-ai-md p {
  margin: 0.4em 0;
}

/* 标题 h1~h4 */
.widget-ai-md h1,
.widget-ai-md h2,
.widget-ai-md h3,
.widget-ai-md h4 {
  margin: 0.8em 0 0.4em;
  font-weight: 600;
  line-height: 1.35;
  color: #1e293b;
}

.widget-ai-md h1 {
  font-size: 1.25em;
}

.widget-ai-md h2 {
  font-size: 1.15em;
}

.widget-ai-md h3 {
  font-size: 1.05em;
}

.widget-ai-md h4 {
  font-size: 1em;
}

/* 加粗 / 斜体 / 删除线 */
.widget-ai-md strong {
  font-weight: 600;
  color: #1e293b;
}

.widget-ai-md em {
  font-style: italic;
}

.widget-ai-md del {
  color: #94a3b8;
  text-decoration: line-through;
}

/* 链接 */
.widget-ai-md a {
  color: #4f46e5;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.widget-ai-md a:hover {
  color: #4338ca;
}

/* 列表：Preflight 清零后必须显式恢复 list-style */
.widget-ai-md ul,
.widget-ai-md ol {
  padding-left: 1.5em;
  margin: 0.4em 0;
}

.widget-ai-md ul {
  list-style: disc;
}

.widget-ai-md ol {
  list-style: decimal;
}

.widget-ai-md li {
  margin: 0.2em 0;
}

.widget-ai-md li > ul,
.widget-ai-md li > ol {
  margin: 0.2em 0;
}

/* 引用块 */
.widget-ai-md blockquote {
  padding: 2px 10px;
  margin: 0.5em 0;
  color: #64748b;
  background: #f8fafc;
  border-left: 3px solid #6366f1;
}

/* 行内代码 */
.widget-ai-md code {
  padding: 1px 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85em;
  color: #be123c;
  background: #f1f5f9;
  border-radius: 3px;
}

/* 代码块 */
.widget-ai-md pre {
  padding: 0.75em 1em;
  margin: 0.5em 0;
  overflow-x: auto;
  background: #f1f5f9;
  border-radius: 6px;
}

.widget-ai-md pre code {
  padding: 0;
  color: #334155;
  background: none;
}

/* 表格 */
.widget-ai-md table {
  display: block;
  width: 100%;
  margin: 0.5em 0;
  overflow-x: auto;
  font-size: 0.9em;
  border-collapse: collapse;
}

.widget-ai-md th,
.widget-ai-md td {
  padding: 5px 10px;
  text-align: left;
  border: 1px solid #e2e8f0;
}

.widget-ai-md th {
  font-weight: 600;
  color: #1e293b;
  background: #f8fafc;
}

/* 分隔线 */
.widget-ai-md hr {
  height: 1px;
  margin: 0.8em 0;
  background: #e2e8f0;
  border: 0;
}

/* 图片 */
.widget-ai-md img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

/* ===== 会话分隔条（session_end / session_start） ===== */
.session-divider {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 999px;
}

.session-divider.session-end {
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.session-divider.session-start {
  color: #4f46e5;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
}

/* ===== 工具状态条（内嵌在 AI 气泡顶部） ===== */
.tool-status-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px dashed #e2e8f0;
}

.tool-status-item {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: #64748b;
}

.tool-status-item .tool-name {
  font-family: monospace;
  color: #334155;
}

.tool-status-item .tool-hint {
  color: #94a3b8;
}

.tool-status-item .tool-run {
  animation: tool-spin 1.2s linear infinite;
}

@keyframes tool-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
