// src/api/session/index.ts
import { useAccessStore } from '@vben/stores';

import { conversationClient, publicConversationClient } from '#/api/request';

/**
 * agentClient：带 Authorization token，baseURL=/conversation，
 *              经过 nginx /conversation 前缀路由到 conversation-service。
 *
 * publicClient：独立 RequestClient 实例，不注册 token 拦截器。
 *              /chat 页无需登录，与座席 token 共用会导致访客请求
 *              意外携带座席 token，存在权限叠加和 token 泄露风险。
 */
const agentClient = conversationClient;
const publicClient = publicConversationClient;

// -------------------------------------------------------
// 访客身份验证（手机号 + 短信验证码）
// -------------------------------------------------------

/** 发送短信验证码（后端路径 /api/v1/chat/auth/sms/send → conversation-service:8082） */
export async function sendSmsCodeApi(phone: string): Promise<void> {
  return publicClient.post('/chat/auth/sms/send', { phone });
}

/**
 * 校验短信验证码，成功返回访客 token。
 *
 * 传入 sessionId 时后端会写入 `visitor:session:auth:{sessionId} -> phone` 绑定（TTL 2h），
 * 用于刷新页面后通过 {@link getVisitorAuthStateApi} 恢复登录态。
 */
export async function verifySmsCodeApi(
  phone: string,
  code: string,
  sessionId?: string,
): Promise<{ token: string }> {
  return publicClient.post('/chat/auth/sms/verify', {
    phone,
    code,
    ...(sessionId ? { sessionId } : {}),
  });
}

/**
 * 查询访客当前 sessionId 的认证状态（刷新页面时用于服务端权威恢复）。
 *
 * 返回：
 *   - authenticated: 该 sessionId 是否已完成手机号验证
 *   - phoneMask: 已认证时返回脱敏手机号（如 138****5678），用于 UI 标签
 */
export async function getVisitorAuthStateApi(sessionId: string): Promise<{
  authenticated: boolean;
  phoneMask?: null | string;
}> {
  return publicClient.get('/chat/auth/state', { params: { sessionId } });
}

export interface SessionQueueItem {
  sessionId: string;
  userName: string;
  transferReason: string;
  tag: string;
  waitSince: number; // epoch seconds
  acceptedAt?: number; // epoch seconds，座席接入时间（可选，AI_CHAT/WAITING 阶段为空）
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING';
}

export interface WsChatMessage {
  type:
    | 'AGENT_JOINED'
    | 'CONNECTED'
    | 'CSAT_REQUEST'
    | 'csat_request'
    | 'KICKED_OUT'
    | 'MESSAGE'
    | 'PING'
    | 'TYPING';
  /**
   * 会话 ID。MESSAGE / TYPING / AGENT_JOINED 必填；
   * CONNECTED / KICKED_OUT 为连接级信令，后端不带此字段。
   */
  sessionId?: string;
  role?: 'agent' | 'user';
  content?: string;
  /**
   * session 内单调递增序号（仅 MESSAGE 类型有效），用于断线重连后的 sinceSeq 增量同步。
   * 后端 JacksonLongToStringConfig 把 Long 序列化为字符串，前端消费时务必 Number(seq) 归一化。
   */
  seq?: number | string;
  timestamp?: number;
}

/** AI 消息中触发的工具调用条目（LangChain ToolCall 结构，前端只展示） */
export interface ChatToolCall {
  id?: null | string;
  name?: null | string;
  /** 入参对象或已序列化字符串，后端返回结构不定，前端渲染前 typeof 判定即可 */
  arguments?: unknown;
}

/** 历史消息项（含 seq 字段，支持增量同步） */
export interface ChatHistoryItem {
  role: string;
  content: string;
  /** session 内单调递增序号，老数据可能为 null；后端 Long → string，前端消费需 Number() 归一化 */
  seq?: null | number | string;
  /** 消息毫秒时间戳（四元组新增字段，旧三元组数据无此字段） */
  timestamp?: null | number;
  /** 仅 role='tool' 消息含此字段：被调用的工具名，如 get_current_weather */
  toolName?: null | string;
  /** 仅 role='tool' 消息含此字段：与触发它的 AI 消息的 toolCalls[].id 对应 */
  toolRequestId?: null | string;
  /** 仅 role='ai' 消息含此字段：本轮触发的工具调用列表 */
  toolCalls?: ChatToolCall[] | null;
}

/** 获取所有状态的会话列表（座席端，需 token）。
 * 返回 AI_CHAT / WAITING / ACTIVE / CLOSED 四种状态，CLOSED 最多 50 条按结束时间倒序。
 */
export async function getAllSessionsApi(): Promise<SessionQueueItem[]> {
  return agentClient.get('/sessions');
}

/** 座席接入会话（需 token） */
export async function acceptSessionApi(
  sessionId: string,
): Promise<SessionQueueItem> {
  return agentClient.post(`/sessions/${sessionId}/accept`);
}

/** 获取结束会话（需 token） */
export async function closeSessionApi(sessionId: string): Promise<void> {
  return agentClient.post(`/sessions/${sessionId}/close`);
}

/**
 * 访客端提交消息反馈（点赞 / 点踩）。
 *
 * 前后端契约（对齐后端 M-04）：
 *   POST /conversation/api/v1/chat/messages/feedback
 *   body: { sessionId, seq, feedback: 'up' | 'down' | null }
 *
 * 使用点：
 *   - AI 气泡下方的 thumbs-up / thumbs-down 按钮
 *   - feedback=null 表示取消评价
 *   - seq 缺失（如流式当轮尚未回填 seq）时后端按 sessionId 定位最近一条 AI 消息
 */
export async function submitVisitorFeedbackApi(params: {
  feedback: 'down' | 'up' | null;
  seq?: number;
  sessionId: string;
}): Promise<void> {
  return publicClient.post('/chat/messages/feedback', params);
}

/**
 * 获取会话历史消息（座席端，需 token）。
 *
 * @param sessionId 会话唯一标识
 * @param sinceSeq  起始 seq（不含），> 0 时走增量模式，缺省=0 拉全量历史
 */
export async function getSessionHistoryApi(
  sessionId: string,
  sinceSeq = 0,
): Promise<ChatHistoryItem[]> {
  return agentClient.get('/chat/history', {
    params: { sessionId, sinceSeq },
  });
}

/**
 * 获取会话历史消息（访客端，无需 token，公开接口）。
 *
 * 同 {@link getSessionHistoryApi}，但走 publicClient，适用于 chat-widget 嵌入第三方页面。
 */
export async function getVisitorHistoryApi(
  sessionId: string,
  sinceSeq = 0,
): Promise<ChatHistoryItem[]> {
  return publicClient.get('/chat/history', {
    params: { sessionId, sinceSeq },
  });
}

/** 用户请求转人工（访客公开接口，无需 token） */
export async function transferToAgentApi(params: {
  sessionId: string;
  tag?: string;
  transferReason?: string;
  userName: string;
}): Promise<SessionQueueItem> {
  return publicClient.post('/chat/transfer', params);
}

/**
 * 查询会话当前状态（onMounted 兜底：检测 AI 工具触发转接后页面关闭的场景）。
 * 若返回 WAITING 或 ACTIVE，前端应自动恢复转接状态并重连 WebSocket。
 */
export async function getSessionStateApi(sessionId: string): Promise<{
  sessionId: string;
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING';
}> {
  return publicClient.get('/chat/state', { params: { sessionId } });
}

/**
 * 访客会话初始化（getOrCreate 语义）。
 *
 * 后端以 X-Anonymous-Id（持久访客身份，存 localStorage）为唯一键：
 *   - 存在活跃会话（AI_CHAT / WAITING / ACTIVE）时直接返回，isNew=false
 *   - 否则新建并返回，isNew=true
 * 分布式锁保障同一 anonymousId 并发 init 的幂等性。
 *
 * @param anonymousId 持久访客 UUID（`aria_visitor_id`，不随会话清除）
 */
export async function initSessionApi(anonymousId: string): Promise<{
  isNew: boolean;
  sessionId: string;
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING';
}> {
  return publicClient.post(
    '/chat/session/init',
    {},
    { headers: { 'X-Anonymous-Id': anonymousId } },
  );
}

// -------------------------------------------------------
// 座席间转交功能
// -------------------------------------------------------

/** 在线座席信息 */
export interface OnlineAgentItem {
  /** 座席 ID */
  id: string;
  /** 座席显示名称 */
  name: string;
  /** 当前 ACTIVE 会话数 */
  sessions: number;
}

/** 获取在线座席列表（用于转交 Modal） */
export async function getOnlineAgentsApi(): Promise<OnlineAgentItem[]> {
  return agentClient.get('/sessions/agents/online');
}

/**
 * 转交会话给指定座席（需 token）。
 * 后端会广播 TRANSFER SSE 事件，目标座席前端收到后自动接入。
 */
export async function transferSessionApi(
  sessionId: string,
  targetAgentId: string,
): Promise<void> {
  return agentClient.post(`/sessions/${sessionId}/transfer`, {
    targetAgentId,
  });
}

/**
 * 座席订阅 SSE 事件流（队列变化通知）。
 *
 * 浏览器原生 EventSource 不支持自定义请求头，鉴权 token 通过 query param 传递。
 * 后端 AgentHandshakeInterceptor 同样从 ?token= 参数中取值校验。
 * 返回 EventSource 实例，调用方负责在 onUnmounted 中调用 close()。
 */
/**
 * SSE 事件 payload。
 * TRANSFER 事件含 fromAgentId / toAgentId，其他事件为 null。
 */
export interface SessionSseEvent {
  type: 'ACCEPTED' | 'CLOSED' | 'ENQUEUE' | 'TRANSFER';
  item: SessionQueueItem;
  fromAgentId?: null | string;
  toAgentId?: null | string;
}

/**
 * fetch + ReadableStream 建立的 SSE 连接句柄，替代原生 EventSource。
 * 原生 EventSource 无法读取 HTTP 状态码，握手 401 时只抛 error 事件，
 * 无法区分"token 过期"与"网络抖动"，导致盲重连。改用 fetch 后可在握手
 * 阶段精确识别 401 并走 onUnauthorized，其余错误走 onError 由调用方重试。
 */
export interface SseConnectionHandle {
  close(): void;
}

export function subscribeSessionEvents(
  onEvent: (event: SessionSseEvent) => void,
  onError?: () => void,
  onOpen?: () => void,
  onUnauthorized?: () => void,
): SseConnectionHandle {
  // 从 Pinia store 取座席 token，附加到 URL query param 实现鉴权
  const accessStore = useAccessStore();
  const token = accessStore.accessToken ?? '';
  const url = token
    ? `/conversation/api/v1/sessions/events?token=${encodeURIComponent(token)}`
    : '/conversation/api/v1/sessions/events';

  const abortCtrl = new AbortController();
  const { signal } = abortCtrl;
  let reader: null | ReadableStreamDefaultReader<Uint8Array> = null;
  let closed = false;

  // 异步建立连接并解析事件流；不 await，立即返回句柄
  void (async () => {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal,
      });

      if (response.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (!response.ok) {
        onError?.();
        return;
      }
      if (!response.body) {
        onError?.();
        return;
      }

      onOpen?.();
      reader = response.body.getReader();
      await parseSseStream(reader, signal, (data) => {
        try {
          onEvent(JSON.parse(data) as SessionSseEvent);
        } catch {
          // 忽略心跳等非 JSON 数据
        }
      });
      // 流正常结束（服务端关闭）→ 视为断连，交由调用方重试
      if (!closed) onError?.();
    } catch (error: unknown) {
      // 主动 close() 触发的 abort 不视为错误
      if (error instanceof Error && error.name === 'AbortError') return;
      if (!closed) onError?.();
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* 已关闭则忽略 */
        }
      }
    }
  })();

  return {
    close() {
      closed = true;
      abortCtrl.abort();
    },
  };
}

/**
 * 最小 WHATWG SSE 解析：仅处理默认 message 事件的 data 行拼接。
 * 规范要点：空行分隔事件、多条 data 行用 \n 拼接、字段值前导单空格需剥离、
 * `:` 注释行（心跳）跳过、`event:`/`id:`/`retry:` 忽略。
 */
async function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  onMessage: (data: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let lineBuffer = '';
  let dataLines: string[] = [];

  const flush = (): void => {
    if (dataLines.length > 0) {
      onMessage(dataLines.join('\n'));
      dataLines = [];
    }
  };

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;

    lineBuffer += decoder.decode(value, { stream: true });
    const rawLines = lineBuffer.split('\n');
    // 最后一段可能不完整，留到下次循环拼接
    lineBuffer = rawLines.pop() ?? '';

    for (const rawLine of rawLines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

      if (line === '') {
        flush();
        continue;
      }
      if (line.startsWith(':')) continue; // 注释/心跳
      if (line.startsWith('data:')) {
        const rest = line.slice('data:'.length);
        dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest);
        continue;
      }
      // event: / id: / retry: 等字段按规范忽略
    }
  }

  // 流末尾兜底 flush，避免最后一条事件未带空行边界而丢失
  flush();
}

// -------------------------------------------------------
// WebSocket 双向对话（访客 ↔ 座席）
// -------------------------------------------------------

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host; // 含端口，如 localhost:5667
  return `${proto}//${host}${path}`;
}

/**
 * 访客端 WebSocket 连接。
 * 路径：/ws/chat/{sessionId}（经 Vite proxy 转发到 localhost:8082）
 * onClose 传入 CloseEvent，调用方可根据 code 区分主动关闭（1000）和异常断线。
 *
 * 浏览器原生 WebSocket 不支持自定义 Header，token 通过 query param 传递，
 * 后端 VisitorHandshakeInterceptor 也从 ?token= 读取校验。
 */
export function connectVisitorWs(
  sessionId: string,
  onMessage: (msg: WsChatMessage) => void,
  onOpen?: () => void,
  onClose?: (event: CloseEvent) => void,
  token?: string,
): WebSocket {
  const path = token
    ? `/ws/chat/${sessionId}?token=${encodeURIComponent(token)}`
    : `/ws/chat/${sessionId}`;
  const ws = new WebSocket(buildWsUrl(path));
  ws.addEventListener('open', () => onOpen?.());
  ws.addEventListener('message', (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('close', (event) => onClose?.(event as CloseEvent));
  return ws;
}

/**
 * 座席端 WebSocket 连接。
 * 路径：/ws/agent/{sessionId}?token=xxx（经 Vite proxy 转发到 localhost:8082）
 *
 * @deprecated 改造为单连接多路复用后，座席端不再直接使用此函数。
 * 请通过 useAgentWsChannel.init() 建立连接，旧路径 /ws/agent/{sessionId} 已废弃。
 * 访客端 connectVisitorWs 不受影响。
 */
export function connectAgentWs(
  sessionId: string,
  onMessage: (msg: WsChatMessage) => void,
  onOpen?: () => void,
  onClose?: (event: CloseEvent) => void,
): WebSocket {
  const accessStore = useAccessStore();
  const token = accessStore.accessToken ?? '';
  const path = token
    ? `/ws/agent/${sessionId}?token=${encodeURIComponent(token)}`
    : `/ws/agent/${sessionId}`;
  const ws = new WebSocket(buildWsUrl(path));
  ws.addEventListener('open', () => onOpen?.());
  ws.addEventListener('message', (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  });
  ws.addEventListener('close', (event) => onClose?.(event as CloseEvent));
  return ws;
}

/** 通过 WebSocket 发送文本消息 */
export function sendWsMessage(ws: null | WebSocket, content: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'MESSAGE', content }));
}

/** 通过 WebSocket 发送访客输入中信号（不存入历史，仅通知座席） */
export function sendTypingSignal(ws: null | WebSocket): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'TYPING' }));
}

/** 通过 WebSocket 发送心跳 PING，防止代理/负载均衡因空闲超时断开连接 */
export function sendPingSignal(ws: null | WebSocket): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'PING' }));
}

// -------------------------------------------------------
// 历史工单 + AI 总结
// -------------------------------------------------------

/** 访客历史工单摘要（对齐后端 VisitorHistoryVO） */
export interface VisitorHistorySession {
  sessionId: string;
  /** 问题标签（无则为 null） */
  tag: null | string;
  /** 转人工原因（无则为空串或 null） */
  transferReason?: null | string;
  /** 会话状态：AI_CHAT / WAITING / ACTIVE / CLOSED */
  status?: string;
  startedAt: string; // ISO 8601
  /** 结束时间，进行中/AI 对话为 null */
  endedAt: null | string;
  msgCount: number;
  aiSummary?: null | string; // 已缓存则有值，否则 null
}

/**
 * 查询同一访客的历史已结束工单（排除当前会话）
 */
export async function getVisitorSessionHistoryApi(
  visitorName: string,
  excludeSessionId: string,
): Promise<VisitorHistorySession[]> {
  return agentClient.get('/sessions/visitor-history', {
    params: { visitorName, excludeSessionId },
  });
}

/**
 * 查询已缓存的 AI 总结。
 * summary 为 null 表示后端尚未生成，空字符串同样视为无内容。
 */
export async function getAiSummaryApi(
  sessionId: string,
): Promise<{ summary: null | string }> {
  return agentClient.get(`/sessions/${sessionId}/ai-summary`);
}

/**
 * 创建 AI 总结流式 SSE 连接（与 subscribeSessionEvents 保持相同的 token 鉴权模式）。
 * token 在函数内部从 Pinia store 读取，调用方无需感知鉴权细节。
 * 返回 SseConnectionHandle，调用方负责在适当时机调用 close()。
 *
 * 与 subscribeSessionEvents 一致：用 fetch + ReadableStream 替代原生 EventSource，
 * 握手 401 时走 onUnauthorized（token 过期 → 退出登录），其余错误走 onError。
 * onMessage 收到的是 SSE data 字段的原始字符串（可能是 `[DONE]` 或 JSON 信封），
 * 由调用方自行判断。
 */
export function createAiSummaryEventSource(
  sessionId: string,
  onMessage: (data: string) => void,
  onError?: () => void,
  onUnauthorized?: () => void,
): SseConnectionHandle {
  const accessStore = useAccessStore();
  const token = accessStore.accessToken ?? '';
  const url = token
    ? `/conversation/api/v1/sessions/${sessionId}/ai-summary/stream?token=${encodeURIComponent(token)}`
    : `/conversation/api/v1/sessions/${sessionId}/ai-summary/stream`;

  const abortCtrl = new AbortController();
  const { signal } = abortCtrl;
  let reader: null | ReadableStreamDefaultReader<Uint8Array> = null;
  let closed = false;

  void (async () => {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal,
      });

      if (response.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (!response.ok) {
        onError?.();
        return;
      }
      if (!response.body) {
        onError?.();
        return;
      }

      reader = response.body.getReader();
      await parseSseStream(reader, signal, onMessage);
      if (!closed) onError?.();
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (!closed) onError?.();
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* 已关闭则忽略 */
        }
      }
    }
  })();

  return {
    close() {
      closed = true;
      abortCtrl.abort();
    },
  };
}

// -------------------------------------------------------
// AI 回复建议
// -------------------------------------------------------

/** AI 回复建议条目 */
export interface ReplySuggestion {
  /** 前端 v-for key */
  id: string;
  /** 建议回复内容 */
  content: string;
  /** 置信度 0-1 */
  confidence: number;
  /** KB=知识库命中, CONTEXT=上下文推理 */
  source: 'CONTEXT' | 'KB';
}

/**
 * 根据当前会话上下文 + 知识库生成回复建议（KB + 上下文双路并行）
 * @param signal 可选的 AbortSignal，用于取消进行中的请求（切换会话时防止过期响应覆盖）
 */
export async function getReplySuggestionsApi(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ReplySuggestion[]> {
  return agentClient.post(
    `/sessions/${sessionId}/reply-suggestions`,
    undefined,
    { signal },
  );
}

// -------------------------------------------------------
// 会话查询（管理端，/session/history 页面）
// -------------------------------------------------------

/** 会话查询列表项 */
export interface SessionRecord {
  sessionId: string;
  visitorName: string;
  agentId: null | string;
  agentName: null | string;
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING';
  tag: null | string;
  transferReason: null | string;
  startedAt: null | string;
  acceptedAt: null | string;
  endedAt: null | string;
  closedBy: 'AGENT' | 'SYSTEM' | 'VISITOR' | null;
  msgCount: number;
  csatScore: null | number;
  csatComment: null | string;
  durationSec: null | number;
}

/** 会话查询分页结果 */
export interface SessionQueryResult {
  total: number;
  page: number; // 0-based
  size: number;
  items: SessionRecord[];
}

/** 会话查询参数 */
export interface SessionQueryParams {
  page?: number; // 0-based
  size?: number;
  startDate?: string;
  endDate?: string;
  status?: string; // 逗号分隔多选
  agentId?: string;
  agentIds?: string; // 逗号分隔多选客服 ID
  keyword?: string;
  tag?: string;
  closedBy?: string;
}

/** 分页查询会话记录（管理端） */
export async function querySessionsApi(
  params: SessionQueryParams,
): Promise<SessionQueryResult> {
  return agentClient.get('/admin/sessions/query', { params });
}

/** 会话消息记录（从 DB 读取，不依赖 Redis） */
export interface SessionMessage {
  role: string;
  content: string;
  seq: null | number;
  timestamp: null | number;
  toolName: null | string;
  toolRequestId: null | string;
}

/** 获取会话消息记录（管理端，从 DB 读取） */
export async function getSessionMessagesApi(
  sessionId: string,
): Promise<SessionMessage[]> {
  return agentClient.get(`/admin/sessions/${sessionId}/messages`);
}

/** 客服列表项（下拉选项） */
export interface AgentOption {
  id: number;
  username: string;
  name: string; // 显示名称（后端 displayName，缺省回退 username）
}

/** 客服分页搜索结果（后端 auth PageResult 形态） */
interface AgentSearchResult {
  total: number;
  page: number;
  size: number;
  items: { displayName?: null | string; id: number; username: string }[];
}

/**
 * 搜索客服列表（供会话查询页面筛选下拉使用）。
 *
 * 默认返回前 10 条，keyword 为空时给出默认列表，输入时按关键词过滤。
 * 后端返回 auth PageResult 形态，此处解包为下拉选项数组，
 * 并将 displayName 归一化为 name（缺省回退 username）。
 */
export async function listAgentOptionsApi(
  keyword?: string,
  size = 10,
): Promise<AgentOption[]> {
  const res = await agentClient.get<AgentSearchResult>(
    '/admin/sessions/agents',
    { params: { keyword, page: 0, size } },
  );
  return (res.items ?? []).map((u) => ({
    id: u.id,
    username: u.username,
    name: u.displayName || u.username,
  }));
}

// -------------------------------------------------------
// 座席纠错反馈（座席工作台 AI 回复「反馈」按钮）
// -------------------------------------------------------

/** 反馈类型：意图错误 / 回答错误 / 好评 */
export type FeedbackType = 'GOOD' | 'WRONG_ANSWER' | 'WRONG_INTENT';

/**
 * 座席纠错反馈请求体。
 * agentId 由后端 Sa-Token 会话解析，前端不传。
 * messageId 座席端无后端 seq 可用，传 null。
 */
export interface AgentFeedbackPayload {
  sessionId: string;
  /** 座席端无后端消息 seq，恒为 null */
  messageId?: null | string;
  feedbackType: FeedbackType;
  /** 触发该 AI 回复的访客原始问题 */
  originalQuery: string;
  /** feedbackType=WRONG_INTENT 时必填 */
  correctIntent?: string;
  /** feedbackType=WRONG_ANSWER 时必填 */
  correctAnswer?: string;
}

/**
 * 提交座席纠错反馈（需 token）。
 * 对接 conversation-service：POST /sessions/feedback（@SaCheckLogin）。
 */
export async function submitAgentFeedbackApi(
  payload: AgentFeedbackPayload,
): Promise<void> {
  return agentClient.post('/sessions/feedback', payload);
}
