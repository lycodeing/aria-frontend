<script lang="ts" setup>
import { nextTick, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Icon } from '@iconify/vue';
import {
  Alert,
  Avatar,
  Button,
  Form,
  FormItem,
  Input,
  InputGroup,
  message,
  Modal,
  Tag,
  Textarea,
} from 'ant-design-vue';
import { marked } from 'marked';

import { getVisitorHistoryApi } from '#/api/session';

// ===== 状态 =====
const isAuth = ref(false);
const authLabel = ref('访客模式');
const inputText = ref('');
const msgs = ref<Msg[]>([]);
const msgsEnd = ref<HTMLDivElement>();
const streaming = ref(false);

// 会话 ID：持久化到 localStorage，保证多轮对话连贯
const sessionId = ref('');

onMounted(async () => {
  let sid = localStorage.getItem('chat_session_id');
  if (!sid) {
    sid = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('chat_session_id', sid);
  }
  sessionId.value = sid;

  // 恢复历史消息（四元组存储，含 timestamp）
  try {
    const history = await getVisitorHistoryApi(sid);
    if (history.length > 0) {
      msgs.value = history.map((h) => ({
        id: ++msgId,
        role: (h.role === 'user' ? 'user' : 'ai') as 'ai' | 'user',
        text: h.content ?? '',
        time: h.timestamp
          ? new Date(Number(h.timestamp)).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '',
        feedback: null,
      }));
      scrollBottom();
    }
  } catch {
    // 历史加载失败不影响新对话
  }
});

// 验证弹窗
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

interface Msg {
  id: number;
  role: 'ai' | 'user';
  text: string;
  time: string;
  sources?: string[];
  feedback?: 'down' | 'up' | null;
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败');
  }
}
let msgId = 0;

const AUTH_WORDS = ['订单', '退款', '投诉', '账单', '发票', '快递', '损坏'];
const QUICK = [
  '产品标准版定价？',
  '查询我的订单',
  '申请退款流程',
  'API 接口文档',
];

// ===== 方法 =====
function scrollBottom() {
  nextTick(() => msgsEnd.value?.scrollIntoView({ behavior: 'smooth' }));
}

function sendMsg() {
  const text = inputText.value.trim();
  if (!text || streaming.value) return;
  inputText.value = '';
  addMsg('user', text);
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

/**
 * 调用 conversation-service SSE 流式接口获取 AI 回复。
 * 代理规则：/api/v1/chat → http://localhost:8082
 */
async function replyFor(text: string) {
  streaming.value = true;
  const m: Msg = {
    id: ++msgId,
    role: 'ai',
    text: '',
    time: nowTime(),
    sources: [],
    feedback: null,
  };
  msgs.value.push(m);
  scrollBottom();

  try {
    const response = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.value, message: text }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let currentEvent = ''; // 当前 SSE 事件类型，默认为空（普通 data 事件）

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      // 最后一行可能未结束，暂存到 buffer 等下一个 chunk
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        // 空行：SSE 事件分隔符，重置事件类型
        if (trimmed === '') {
          currentEvent = '';
          continue;
        }

        // event 行：记录事件类型
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }

        // comment 行（心跳）：跳过
        if (trimmed.startsWith(':')) continue;

        // data 行
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            streaming.value = false;
            return;
          }
          if (currentEvent === 'sources') {
            // 知识库溯源：解析后存入 m.sources，不拼入文本
            try {
              m.sources = JSON.parse(data);
            } catch {
              /* 解析失败忽略 */
            }
          } else if (currentEvent === 'error') {
            m.text = data;
            streaming.value = false;
            return;
          } else if (data) {
            // 普通 AI token：拼入回复文本
            m.text += data;
            scrollBottom();
          }
        }
      }
    }
  } catch {
    // 后端不可用时降级到友好提示
    m.text = '抱歉，AI 服务暂时不可用，请稍后重试。如需帮助，请联系人工客服。';
  } finally {
    streaming.value = false;
  }
}

function addMsg(role: 'ai' | 'user', text: string) {
  msgs.value.push({ id: ++msgId, role, text, time: nowTime(), feedback: null });
  scrollBottom();
}

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
  codeSent.value = true;
  codeVal.value = '';
  startCountdown();
  message.success('验证码已发送（演示：任意 6 位均可，000000 为错误）');
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
  if (codeVal.value === '000000') {
    codeErr.value = '验证码错误，请重试';
    codeVal.value = '';
    return;
  }
  codeErr.value = '';
  verifying.value = true;
  setTimeout(() => {
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
  }, 1200);
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
</script>

<template>
  <Page auto-content-height>
    <div
      class="flex h-full items-center justify-center bg-gradient-to-br from-slate-50 to-indigo-50 p-4"
    >
      <div
        class="flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
        style="height: 80vh"
      >
        <!-- 顶栏 -->
        <div
          class="flex shrink-0 items-center gap-3 border-b border-gray-100 px-5 py-4"
        >
          <Avatar
            :size="36"
            class="shrink-0"
            style="
              flex-shrink: 0;
              font-size: 12px;
              font-weight: 700;
              color: #fff;
              background-color: #4f46e5;
            "
          >
            AI
          </Avatar>
          <div>
            <p class="text-sm font-semibold text-gray-800">智能客服助手</p>
            <p class="flex items-center gap-1 text-xs text-emerald-500">
              <span
                class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
              ></span>
              在线服务中
            </p>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <!-- 身份状态标签：用内联 span 避免暗色主题 CSS 变量覆盖文字颜色 -->
            <span
              class="cursor-pointer select-none rounded-full border px-3 py-1 text-xs font-medium transition"
              :style="
                isAuth
                  ? 'background:#f0fdf4; color:#16a34a; border-color:#bbf7d0'
                  : 'background:#f8fafc; color:#475569; border-color:#e2e8f0'
              "
              @click="
                () => {
                  if (!isAuth) showAuth('立即登录享受完整服务');
                }
              "
            >
              {{ isAuth ? `✅ ${authLabel}` : `🔓 ${authLabel}` }}
            </span>
          </div>
        </div>

        <!-- 访客提示条 -->
        <div v-if="!isAuth" class="mx-4 mt-3 shrink-0">
          <Alert type="info" show-icon>
            <template #message>
              <span class="text-xs">
                当前为访客模式，可咨询通用问题。
                <a class="font-medium" @click="showAuth('登录后享受完整服务')"
                  >立即登录</a
                >
                后可查询订单、申请退款等。
              </span>
            </template>
          </Alert>
        </div>

        <!-- 消息区 -->
        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <!-- 欢迎语 -->
          <div v-if="msgs.length === 0" class="flex gap-3">
            <Avatar
              :size="32"
              class="shrink-0"
              style="
                flex-shrink: 0;
                font-size: 11px;
                font-weight: 700;
                color: #4f46e5;
                background-color: #e0e7ff;
              "
            >
              AI
            </Avatar>
            <div
              class="max-w-md rounded-2xl rounded-tl-sm bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-700"
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
            <Avatar
              :size="32"
              class="shrink-0"
              :style="
                m.role === 'user'
                  ? {
                      backgroundColor: isAuth ? '#8b5cf6' : '#9ca3af',
                      color: '#fff',
                      fontSize: '11px',
                      fontWeight: '700',
                      flexShrink: '0',
                    }
                  : {
                      backgroundColor: '#e0e7ff',
                      color: '#4f46e5',
                      fontSize: '11px',
                      fontWeight: '700',
                      flexShrink: '0',
                    }
              "
            >
              {{ m.role === 'user' ? '我' : 'AI' }}
            </Avatar>
            <div
              class="max-w-sm"
              :class="[m.role === 'user' ? 'items-end' : '']"
            >
              <!-- 气泡 -->
              <div
                :class="
                  m.role === 'user'
                    ? 'rounded-2xl rounded-tr-sm bg-indigo-600 text-white'
                    : 'rounded-2xl rounded-tl-sm bg-gray-50 text-gray-700'
                "
                class="relative px-4 py-3 text-sm leading-relaxed"
              >
                <!-- AI 正在思考动画 -->
                <span
                  v-if="streaming && m === msgs[msgs.length - 1] && !m.text"
                  class="flex gap-1 py-1"
                >
                  <span
                    class="h-2 w-2 animate-bounce rounded-full bg-indigo-400"
                    style="animation-delay: 0ms"
                  ></span>
                  <span
                    class="h-2 w-2 animate-bounce rounded-full bg-indigo-400"
                    style="animation-delay: 150ms"
                  ></span>
                  <span
                    class="h-2 w-2 animate-bounce rounded-full bg-indigo-400"
                    style="animation-delay: 300ms"
                  ></span>
                </span>
                <!-- Markdown 渲染 -->
                <div
                  v-else
                  :class="m.role === 'user' ? 'chat-user-md' : 'chat-ai-md'"
                  v-html="m.role === 'ai' ? marked.parse(m.text) : m.text"
                ></div>
                <span
                  v-if="streaming && m === msgs[msgs.length - 1] && m.text"
                  class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-indigo-500 align-middle"
                ></span>
              </div>
              <!-- 时间戳 + 复制 -->
              <div
                class="mt-0.5 flex items-center gap-2"
                :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
              >
                <span class="text-xs text-gray-300">{{ m.time }}</span>
                <button
                  v-if="m.role === 'ai' && m.text"
                  class="text-xs text-gray-300 transition hover:text-gray-500"
                  title="复制"
                  @click.stop="copyText(m.text)"
                >
                  <Icon icon="lucide:copy" class="h-3 w-3" />
                </button>
              </div>
              <!-- 溯源 -->
              <div v-if="m.sources?.length" class="mt-1.5 flex flex-wrap gap-1">
                <Tag
                  v-for="s in m.sources"
                  :key="s"
                  color="processing"
                  class="cursor-pointer text-xs"
                >
                  📄 {{ s }}
                </Tag>
              </div>
              <!-- 反馈 -->
              <div
                v-if="m.role === 'ai' && !streaming"
                class="ml-1 mt-1.5 flex items-center gap-2"
              >
                <span class="text-xs text-gray-400">有帮助吗？</span>
                <Button type="text" size="small" @click="setFeedback(m, 'up')">
                  <Icon
                    v-if="m.feedback === 'up'"
                    icon="lucide:thumbs-up"
                    class="text-emerald-500"
                  />
                  <Icon v-else icon="lucide:thumbs-up" class="text-gray-400" />
                </Button>
                <Button
                  type="text"
                  size="small"
                  @click="setFeedback(m, 'down')"
                >
                  <Icon
                    v-if="m.feedback === 'down'"
                    icon="lucide:thumbs-down"
                    class="text-red-400"
                  />
                  <Icon
                    v-else
                    icon="lucide:thumbs-down"
                    class="text-gray-400"
                  />
                </Button>
              </div>
            </div>
          </div>
          <div ref="msgsEnd"></div>
        </div>

        <!-- 转人工入口 -->
        <div class="shrink-0 px-4 pt-2">
          <button
            class="w-full rounded-lg border border-dashed border-gray-200 py-1.5 text-xs text-gray-400 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-500"
            @click="addMsg('ai', '正在为您转接人工客服，请稍候...')"
          >
            <Icon icon="lucide:headphones" class="mr-1 inline-block h-3 w-3" />
            转接人工客服
          </button>
        </div>

        <!-- 快捷问题 -->
        <div class="shrink-0 border-t border-gray-50 px-4 pt-2 pb-1">
          <p class="mb-1.5 flex items-center gap-1 text-xs text-gray-400">
            <Icon icon="lucide:zap" class="text-amber-400" />
            试试这些问题
          </p>
          <div class="flex gap-2 overflow-x-auto pb-1">
            <span
              v-for="q in QUICK"
              :key="q"
              class="shrink-0 cursor-pointer rounded-full border px-3 py-1 text-xs transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
              style="color: #475569; background: #f8fafc; border-color: #e2e8f0"
              @click="quickAsk(q)"
              >{{ q }}</span
            >
          </div>
        </div>

        <!-- 输入框 -->
        <div class="shrink-0 border-t border-gray-100 px-4 py-3">
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
              class="flex h-10 w-10 shrink-0 items-center justify-center"
              @click="sendMsg"
            >
              <template #icon><Icon icon="lucide:send" /></template>
            </Button>
          </div>
          <p class="mt-2 text-center text-xs text-gray-400">
            AI 回答仅供参考，重要事项请联系人工确认
          </p>
        </div>
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
            :help="codeErr || '提示：任意 6 位均可，000000 为错误示例'"
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
        <p class="text-center text-xs text-gray-400">
          验证后即视为同意 <a>服务协议</a> 与 <a>隐私政策</a>
        </p>
      </div>
    </Modal>
  </Page>
</template>

<style>
/* AI 气泡 Markdown 样式 */
.chat-ai-md p {
  margin: 0.4em 0;
}

.chat-ai-md p:first-child {
  margin-top: 0;
}

.chat-ai-md p:last-child {
  margin-bottom: 0;
}

.chat-ai-md h1,
.chat-ai-md h2,
.chat-ai-md h3 {
  margin: 0.6em 0 0.3em;
  font-weight: 600;
  color: #374151;
}

.chat-ai-md ul,
.chat-ai-md ol {
  padding-left: 1.4em;
  margin: 0.4em 0;
}

.chat-ai-md li {
  margin: 0.2em 0;
}

.chat-ai-md code {
  padding: 1px 5px;
  font-family: monospace;
  font-size: 12px;
  color: #374151;
  background: #e8edf3;
  border-radius: 3px;
}

.chat-ai-md pre {
  padding: 10px;
  margin: 0.4em 0;
  overflow-x: auto;
  background: #e8edf3;
  border-radius: 6px;
}

.chat-ai-md pre code {
  padding: 0;
  background: none;
}

.chat-ai-md blockquote {
  padding-left: 10px;
  margin: 0.4em 0;
  color: #6b7280;
  border-left: 3px solid #6366f1;
}

.chat-ai-md strong {
  font-weight: 600;
}

.chat-ai-md a {
  color: #4f46e5;
  text-decoration: underline;
}

.chat-ai-md table {
  width: 100%;
  margin: 0.4em 0;
  font-size: 12px;
  border-collapse: collapse;
}

.chat-ai-md th,
.chat-ai-md td {
  padding: 4px 8px;
  border: 1px solid #d1d5db;
}

.chat-ai-md th {
  background: #f3f4f6;
}

/* 用户气泡纯文本 */
.chat-user-md {
  overflow-wrap: break-word;
  white-space: pre-wrap;
}
</style>
