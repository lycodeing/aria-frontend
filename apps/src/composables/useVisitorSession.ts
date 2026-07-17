/**
 * useVisitorSession — 访客会话核心状态管理
 *
 * 职责：
 *   - sessionId 的创建与 localStorage 恢复
 *   - 消息列表的 localStorage 持久化（最近 100 条）
 *   - lastSeq 的 localStorage 管理（跨标签/关闭浏览器仍保留，
 *     下次进入相同 sessionId 时增量拉取，避免 sessionStorage 关标签即丢导致回退全量）
 *   - 会话结束态 / CSAT 待评价邀请的持久化（刷新后可恢复）
 *   - 会话清除（含关联的转接标志、lastSeq 游标、结束态、CSAT 邀请）
 *
 * 不包含：SSE、WebSocket、转接、身份验证任何逻辑。
 */
import type { CsatRequestPayload } from '#/api/csat/types';

import { ref, watch } from 'vue';

// ---- 消息类型（全局共享，其他 composable 均 import 此处） ----

export interface Msg {
  id: number;
  role: 'agent' | 'ai' | 'user';
  text: string;
  time?: string;
  /** 知识库溯源标签，由 event:sources 填充 */
  sources?: string[];
  feedback?: 'down' | 'up' | null;
  /** 是否发送/请求失败（用于重试按钮） */
  failed?: boolean;
  /** 失败时保存原始文本，重试时重用 */
  retryText?: string;
  /** WS 消息发送中（转人工模式） */
  sending?: boolean;
  /** 工具调用状态列表（内嵌在同一气泡中） */
  tools?: ToolCallStatus[];
  /** 消息语义子类型，用于特殊气泡渲染 */
  subType?: 'session_end' | 'session_start';
  /**
   * 后端 seq（座席/AI 消息才有值）。用于：
   *   - 反馈 API 定位消息
   *   - loadHistory 与 localStorage 合并时去重
   */
  seq?: number;
}

export interface ToolCallStatus {
  name: string;
  status: 'done' | 'error' | 'running';
  durationMs?: number;
}

// ---- 常量 ----

const HISTORY_KEY_PREFIX = 'chat_history_';
const LAST_SEQ_KEY_PREFIX = 'chat_last_seq_';
const SESSION_ENDED_KEY_PREFIX = 'chat_session_ended_';
const CSAT_INVITE_KEY_PREFIX = 'chat_csat_invite_';
const HISTORY_MAX_SIZE = 100;

export function useVisitorSession() {
  const sessionId = ref('');
  const msgs = ref<Msg[]>([]);
  /** 会话是否已被座席/服务端关闭（persist 到 localStorage，刷新后可恢复） */
  const sessionEnded = ref(false);
  /** 待评价 CSAT 邀请（persist 到 localStorage，未提交/未跳过前刷新仍展示） */
  const csatInvite = ref<CsatRequestPayload | null>(null);
  let msgId = 0;

  // ---- sessionId ----

  /**
   * 初始化 sessionId：从 localStorage 恢复或重新生成。
   * 使用 crypto.randomUUID() 避免 Math.random() 的碰撞风险。
   */
  function initSession(): string {
    let sid = localStorage.getItem('chat_session_id');
    if (!sid) {
      sid = `guest-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      localStorage.setItem('chat_session_id', sid);
    }
    sessionId.value = sid;
    // 从持久化中恢复会话结束态 & CSAT 邀请
    sessionEnded.value =
      localStorage.getItem(SESSION_ENDED_KEY_PREFIX + sid) === '1';
    csatInvite.value = readCsatInvite(sid);
    return sid;
  }

  // ---- 历史持久化 ----

  function saveHistory(): void {
    if (!sessionId.value) return;
    try {
      const toSave = msgs.value.slice(-HISTORY_MAX_SIZE);
      localStorage.setItem(
        HISTORY_KEY_PREFIX + sessionId.value,
        JSON.stringify(toSave),
      );
    } catch {
      /* localStorage 超限时静默忽略 */
    }
  }

  function loadHistory(): void {
    if (!sessionId.value) return;
    try {
      const raw = localStorage.getItem(HISTORY_KEY_PREFIX + sessionId.value);
      if (!raw) return;
      const parsed: Msg[] = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      // 恢复后同步 msgId，防止新消息 id 与历史冲突
      let maxId = 0;
      for (const m of parsed) {
        if ((m.id ?? 0) > maxId) maxId = m.id ?? 0;
      }
      msgId = maxId;
      msgs.value = parsed;
    } catch {
      /* 解析失败静默忽略 */
    }
  }

  // 消息变化时自动持久化
  watch(msgs, saveHistory, { deep: true });

  // ---- 消息工厂 ----

  /** 追加一条消息并返回其在 msgs 中的响应式引用 */
  function appendMsg(
    role: Msg['role'],
    text: string,
    extra?: Partial<Msg>,
  ): Msg {
    const m: Msg = {
      id: ++msgId,
      role,
      text,
      time: new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      feedback: null,
      ...extra,
    };
    msgs.value.push(m);
    // 必须通过 reactive proxy 引用才能触发 UI 更新
    return msgs.value.at(-1) as Msg;
  }

  /**
   * 按 seq 合并后端历史消息（去重）。
   * 场景：loadHistory 从 localStorage 渲染后，再按 lastSeq 拉后端增量兜底。
   * 只合并本地未出现过的 seq，避免与已有 AI/座席气泡重复。
   */
  function mergeRemoteMsgs(remote: Msg[]): void {
    if (remote.length === 0) return;
    const localSeqs = new Set<number>();
    for (const m of msgs.value) {
      if (typeof m.seq === 'number') localSeqs.add(m.seq);
    }
    const toAppend: Msg[] = [];
    for (const r of remote) {
      if (typeof r.seq !== 'number') continue;
      if (localSeqs.has(r.seq)) continue;
      toAppend.push({ ...r, id: ++msgId });
    }
    if (toAppend.length === 0) return;
    // 按 seq 递增插入到列表末尾（后端返回顺序已保证）
    msgs.value.push(...toAppend);
  }

  // ---- lastSeq（增量同步游标，localStorage 跨标签持久化） ----

  /** 读取当前 lastSeq，脏数据或缺省返回 0 */
  function readLastSeq(): number {
    const raw = localStorage.getItem(LAST_SEQ_KEY_PREFIX + sessionId.value);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** 仅在 newSeq 大于当前值时更新，防止乱序回退 */
  function writeLastSeq(newSeq: number): void {
    if (!Number.isFinite(newSeq) || newSeq <= 0) return;
    if (newSeq > readLastSeq()) {
      localStorage.setItem(
        LAST_SEQ_KEY_PREFIX + sessionId.value,
        String(newSeq),
      );
    }
  }

  // ---- 会话结束态持久化 ----

  function markSessionEnded(): void {
    if (!sessionId.value) return;
    sessionEnded.value = true;
    localStorage.setItem(SESSION_ENDED_KEY_PREFIX + sessionId.value, '1');
  }

  function clearSessionEnded(sid: string): void {
    sessionEnded.value = false;
    localStorage.removeItem(SESSION_ENDED_KEY_PREFIX + sid);
  }

  // ---- CSAT 待评价邀请持久化 ----

  function readCsatInvite(sid: string): CsatRequestPayload | null {
    try {
      const raw = localStorage.getItem(CSAT_INVITE_KEY_PREFIX + sid);
      if (!raw) return null;
      const payload = JSON.parse(raw) as CsatRequestPayload;
      // 过期邀请（expiresAt 已过）不再展示
      if (payload.expiresAt) {
        const t = Date.parse(payload.expiresAt);
        if (Number.isFinite(t) && t < Date.now()) {
          localStorage.removeItem(CSAT_INVITE_KEY_PREFIX + sid);
          return null;
        }
      }
      return payload;
    } catch {
      return null;
    }
  }

  function setCsatInvite(payload: CsatRequestPayload | null): void {
    csatInvite.value = payload;
    if (!sessionId.value) return;
    if (payload) {
      localStorage.setItem(
        CSAT_INVITE_KEY_PREFIX + sessionId.value,
        JSON.stringify(payload),
      );
    } else {
      localStorage.removeItem(CSAT_INVITE_KEY_PREFIX + sessionId.value);
    }
  }

  // ---- 会话清除 ----

  function clearSession(): void {
    msgs.value = [];
    msgId = 0;
    const sid = sessionId.value;
    localStorage.removeItem(HISTORY_KEY_PREFIX + sid);
    localStorage.removeItem('chat_session_id');
    // 同步清除转接标志、lastSeq 游标、结束态、CSAT 邀请，避免残留干扰下一会话
    localStorage.removeItem(`chat_transferred_${sid}`);
    localStorage.removeItem(LAST_SEQ_KEY_PREFIX + sid);
    localStorage.removeItem(SESSION_ENDED_KEY_PREFIX + sid);
    localStorage.removeItem(CSAT_INVITE_KEY_PREFIX + sid);
    sessionEnded.value = false;
    csatInvite.value = null;
    sessionId.value = '';
  }

  return {
    sessionId,
    msgs,
    sessionEnded,
    csatInvite,
    initSession,
    loadHistory,
    mergeRemoteMsgs,
    clearSession,
    appendMsg,
    readLastSeq,
    writeLastSeq,
    markSessionEnded,
    clearSessionEnded,
    setCsatInvite,
  };
}
