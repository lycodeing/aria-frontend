<script lang="ts" setup>
import { computed, ref } from 'vue';

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
  Divider,
  message,
  Modal,
  Progress,
  Radio,
  RadioGroup,
  Switch,
  Tag,
  Textarea,
} from 'ant-design-vue';

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
  slots: { done: boolean; key: string; value: null | string; }[];
  chunks: { preview: string; score: number; title: string; }[];
  memory: string;
}

const sessions = ref<SessionData[]>([
  {
    id: 's1',
    name: '陈小玲',
    nameChar: '陈',
    color: '#8b5cf6',
    min: '8 分钟',
    active: true,
    sessionCode: '#sess_cxl001',
    transferReason: 'AI 置信度低（0.52 < 0.7），关键词：投诉、损坏',
    msgs: [
      { id: 1, role: 'ai', text: '您好！请问有什么可以帮您？' },
      {
        id: 2,
        role: 'user',
        text: '我上周买的东西今天到了，包装严重破损，里面的产品也坏了，我要投诉！',
      },
      {
        id: 3,
        role: 'ai',
        text: '非常抱歉给您带来不便，请问您的订单号是多少？',
      },
      { id: 4, role: 'user', text: '订单号 202606250078，我要投诉快递公司！' },
    ],
    userInfo: [
      { label: '姓名', value: '陈小玲' },
      { label: '等级', value: 'VIP 用户', vip: true },
      { label: '注册时长', value: '2 年 3 月' },
      { label: '历史工单', value: '4 次' },
    ],
    slots: [
      { key: '订单号', value: '202606250078', done: true },
      { key: '问题类型', value: '物流损坏', done: true },
      { key: '处理方式', value: null, done: false },
    ],
    chunks: [
      {
        title: '退款政策说明 › 物流破损',
        score: 0.87,
        preview: '物流损坏商品可申请免费补发或全额退款，需提供破损照片...',
      },
      {
        title: 'FAQ › 快递投诉流程',
        score: 0.79,
        preview: '向快递公司提交投诉后，平台会跟进处理结果，通常 3 个工作日...',
      },
    ],
    memory:
      '用户 2026-04 曾咨询退款流程，最终 AI 自助解决。偏好简洁回答，不喜欢冗长说明。',
  },
  {
    id: 's2',
    name: '刘明辉',
    nameChar: '刘',
    color: '#14b8a6',
    min: '12 分钟',
    active: false,
    sessionCode: '#sess_lmh002',
    transferReason: '用户主动请求转人工',
    msgs: [
      { id: 1, role: 'ai', text: '您好！请问有什么可以帮您？' },
      { id: 2, role: 'user', text: '我想查询一下最新的套餐价格' },
      { id: 3, role: 'ai', text: '标准版 ¥299/月，企业版 ¥999/月。' },
    ],
    userInfo: [
      { label: '姓名', value: '刘明辉' },
      { label: '等级', value: '普通用户' },
      { label: '注册时长', value: '6 个月' },
      { label: '历史工单', value: '1 次' },
    ],
    slots: [{ key: '咨询类型', value: '价格查询', done: true }],
    chunks: [
      {
        title: '产品手册 › 定价说明',
        score: 0.92,
        preview: '标准版月费 ¥299，包含 5 用户席位和 10 万次 API 调用...',
      },
    ],
    memory: '新用户，首次咨询，偏好文字回答。',
  },
  {
    id: 's3',
    name: '赵小强',
    nameChar: '赵',
    color: '#ec4899',
    min: '5 分钟',
    active: false,
    sessionCode: '#sess_zxq003',
    transferReason: 'AI 置信度低（0.61）',
    msgs: [
      { id: 1, role: 'ai', text: '您好！请问有什么可以帮您？' },
      { id: 2, role: 'user', text: '我的账号被锁定了，无法登录' },
      { id: 3, role: 'ai', text: '请告知注册手机号，我来帮您核实。' },
    ],
    userInfo: [
      { label: '姓名', value: '赵小强' },
      { label: '等级', value: '普通用户' },
      { label: '注册时长', value: '1 年' },
      { label: '历史工单', value: '2 次' },
    ],
    slots: [
      { key: '问题类型', value: '账号锁定', done: true },
      { key: '手机号', value: null, done: false },
    ],
    chunks: [
      {
        title: 'FAQ › 账号安全',
        score: 0.88,
        preview: '账号被锁定通常因连续输错密码，可通过手机验证码解锁...',
      },
    ],
    memory: '无历史记忆。',
  },
]);

// ===== Bug-001 修复：activeSession 计算属性，切换会话时自动更新右侧面板 =====
const activeSession = computed(() => sessions.value.find((s) => s.active));
const concurrent = computed(() => sessions.value.length);

// ===== 等待队列 =====
interface QueueItem {
  id: string;
  name: string;
  color: string;
  waitMin: string;
  reason: string;
  tag: string;
  tagColor: string;
}
const queue = ref<QueueItem[]>([
  {
    id: 'q1',
    name: '李小花',
    color: '#f87171',
    waitMin: '4:23',
    reason: 'AI 置信度低，转接原因：投诉处理',
    tag: '投诉',
    tagColor: 'red',
  },
  {
    id: 'q2',
    name: '张大卫',
    color: '#60a5fa',
    waitMin: '1:08',
    reason: '用户主动请求转人工',
    tag: '退款',
    tagColor: 'orange',
  },
]);

let msgId = 100;
const msgInput = ref('');
const QUICK_REPLY = [
  '已核实订单信息',
  '安排补发处理',
  '提交快递投诉',
  '退款申请处理',
  '感谢您的耐心等待',
];

// ===== Bug-002 修复：转交 Modal =====
const transferVisible = ref(false);
const transferTarget = ref('');
const availableAgents = [
  { id: 'a1', name: '李明', status: '空闲', sessions: 2 },
  { id: 'a2', name: '王芳', status: '空闲', sessions: 1 },
  { id: 'a3', name: '张强', status: '忙碌', sessions: 4 },
];

function confirmTransfer() {
  if (!transferTarget.value) {
    message.warning('请选择转交坐席');
    return;
  }
  const agent = availableAgents.find((a) => a.id === transferTarget.value);
  const name = activeSession.value?.name ?? '';
  message.success(`会话 ${name} 已成功转交给 ${agent?.name}`);
  transferVisible.value = false;
  transferTarget.value = '';
  doCloseSession();
}

// ===== 其他方法 =====
function switchSession(s: SessionData) {
  sessions.value.forEach((x) => (x.active = false));
  s.active = true;
}

function acceptQueue(item: QueueItem) {
  if (concurrent.value >= MAX_CONCURRENT) {
    message.warning('已达最大并发数（5），请先结束其他会话');
    return;
  }
  queue.value = queue.value.filter((q) => q.id !== item.id);
  sessions.value.push({
    id: item.id,
    name: item.name,
    nameChar: item.name[0]!,
    color: item.color,
    min: '刚接入',
    active: false,
    sessionCode: `#sess_${item.id}`,
    transferReason: item.reason,
    msgs: [{ id: ++msgId, role: 'ai', text: '您好！请问有什么可以帮您？' }],
    userInfo: [{ label: '姓名', value: item.name }],
    slots: [],
    chunks: [],
    memory: '无历史记忆。',
  });
  message.success(`已接入会话：${item.name}`);
}

function sendAgent() {
  const text = msgInput.value.trim();
  if (!text || !activeSession.value) return;
  activeSession.value.msgs.push({ id: ++msgId, role: 'agent', text });
  msgInput.value = '';
  setTimeout(() => {
    activeSession.value?.msgs.push({
      id: ++msgId,
      role: 'user',
      text: '好的，谢谢！请尽快处理，我等补发通知。',
    });
  }, 1500);
}

function doCloseSession() {
  const sid = activeSession.value?.id;
  if (!sid) return;
  sessions.value = sessions.value.filter((s) => s.id !== sid);
  if (sessions.value.length > 0) sessions.value[0]!.active = true;
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
</script>

<template>
  <Page title="座席工作台" description="实时接待转接会话，查看 AI 对话上下文">
    <div class="flex gap-4" style="height: calc(100vh - 160px)">
      <!-- 左栏：状态 + 队列 + 处理中 -->
      <div class="flex w-56 shrink-0 flex-col gap-3">
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
              <span class="text-sm font-semibold">等待队列</span>
              <Badge :count="queue.length" color="red" />
            </div>
          </template>
          <div v-if="queue.length" class="space-y-2">
            <div
              v-for="item in queue"
              :key="item.id"
              class="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
            >
              <div class="flex items-center gap-2">
                <Avatar :size="28" :style="{ backgroundColor: item.color }">
{{
                  item.name[0]
                }}
</Avatar>
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium text-gray-700">
                    {{ item.name }}
                  </p>
                  <p class="text-xs text-amber-600">等待 {{ item.waitMin }}</p>
                </div>
                <Tag :color="item.tagColor" class="shrink-0 text-xs">
{{
                  item.tag
                }}
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
          </div>
          <a-empty v-else description="暂无等待" :image="null" class="py-4" />

          <Divider class="my-3 text-xs text-gray-400">处理中</Divider>

          <!-- Bug-001 修复：点击后 activeSession 联动右侧面板 -->
          <div class="space-y-2">
            <div
              v-for="s in sessions"
              :key="s.id"
              class="cursor-pointer rounded-xl border p-2.5 transition" :class="[
                s.active
                  ? 'border-indigo-300 bg-indigo-50'
                  : 'border-gray-100 bg-white hover:border-gray-200',
              ]"
              @click="switchSession(s)"
            >
              <div class="flex items-center gap-2">
                <Avatar :size="26" :style="{ backgroundColor: s.color }">
{{
                  s.nameChar
                }}
</Avatar>
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium text-gray-700">{{ s.name }}</p>
                  <p
                    class="text-xs" :class="[
                      s.active
                        ? 'font-medium text-indigo-600'
                        : 'text-gray-400',
                    ]"
                  >
                    {{ s.active ? '当前会话' : s.min }}
                  </p>
                </div>
                <span
                  class="h-2 w-2 rounded-full" :class="[
                    s.active ? 'bg-emerald-500' : 'bg-gray-300',
                  ]"
                ></span>
              </div>
            </div>
          </div>
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
          <Avatar
            :size="36"
            :style="{ backgroundColor: activeSession.color }"
            >
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

        <div class="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
          <div class="flex justify-center">
            <Tag color="default" class="text-xs">
以下为 AI 对话历史（共
              {{
                activeSession.msgs.filter((m) => m.role !== 'agent').length
              }}
              轮）
</Tag>
          </div>
          <div
            v-for="m in activeSession.msgs"
            :key="m.id"
            class="flex gap-2" :class="[m.role === 'user' ? 'flex-row-reverse' : '']"
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
              class="max-w-xs rounded-xl px-3 py-2 text-sm leading-relaxed" :class="[
                m.role === 'user'
                  ? 'rounded-tr-none bg-indigo-500 text-white'
                  : m.role === 'agent'
                    ? 'rounded-tl-none border border-gray-200 bg-white'
                    : 'rounded-tl-none bg-gray-100 text-gray-500 opacity-70',
              ]"
            >
              {{ m.text }}
            </div>
          </div>
        </div>

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
        class="flex flex-1 items-center justify-center rounded-xl bg-white shadow-sm"
      >
        <a-empty description="暂无会话，请从等待队列接入" />
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
              class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs" :class="[
                s.done ? 'bg-emerald-50' : 'bg-gray-50',
              ]"
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
        <div class="space-y-2">
          <div
            v-for="agent in availableAgents"
            :key="agent.id"
            class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition" :class="[
              transferTarget === agent.id
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-gray-100',
            ]"
            @click="transferTarget = agent.id"
          >
            <Radio :value="agent.id" />
            <Avatar :size="32" style="background-color: #6366f1">
{{
              agent.name[0]
            }}
</Avatar>
            <div class="flex-1">
              <p class="text-sm font-medium">{{ agent.name }}</p>
              <p class="text-xs text-gray-400">
                当前 {{ agent.sessions }} 个会话
              </p>
            </div>
            <Tag :color="agent.status === '空闲' ? 'success' : 'warning'">
{{
              agent.status
            }}
</Tag>
          </div>
        </div>
      </RadioGroup>
    </Modal>
  </Page>
</template>
