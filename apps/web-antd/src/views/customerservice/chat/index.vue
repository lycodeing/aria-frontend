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

// ===== 状态 =====
const isAuth = ref(false);
const authLabel = ref('访客模式');
const inputText = ref('');
const msgs = ref<Msg[]>([]);
const msgsEnd = ref<HTMLDivElement>();
const streaming = ref(false);

// 会话 ID：持久化到 localStorage，保证多轮对话连贯
const sessionId = ref('');

onMounted(() => {
  let sid = localStorage.getItem('chat_session_id');
  if (!sid) {
    sid = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('chat_session_id', sid);
  }
  sessionId.value = sid;
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
  sources?: string[];
  feedback?: 'down' | 'up' | null;
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
 * 代理规则：/chat-api → http://localhost:8082/api/v1
 */
async function replyFor(text: string) {
  streaming.value = true;
  const m: Msg = {
    id: ++msgId,
    role: 'ai',
    text: '',
    sources: [],
    feedback: null,
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
      // SSE 格式：每行以 "data:" 开头
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
    // 后端不可用时降级到友好提示
    m.text = '抱歉，AI 服务暂时不可用，请稍后重试。如需帮助，请联系人工客服。';
  } finally {
    streaming.value = false;
  }
}

function addMsg(role: 'ai' | 'user', text: string) {
  msgs.value.push({ id: ++msgId, role, text, feedback: null });
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
                <a class="font-medium" @click="showAuth('登录后享受完整服务')">立即登录</a>
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
              <div
                :class="
                  m.role === 'user'
                    ? 'rounded-2xl rounded-tr-sm bg-indigo-600 text-white'
                    : 'rounded-2xl rounded-tl-sm bg-gray-50 text-gray-700'
                "
                class="whitespace-pre-line px-4 py-3 text-sm leading-relaxed"
              >
                {{ m.text }}
                <span
                  v-if="streaming && m === msgs[msgs.length - 1]"
                  class="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-indigo-500 align-middle"
                ></span>
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
              >{{ q }}</span>
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
