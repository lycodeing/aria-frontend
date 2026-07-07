/**
 * useVisitorSession — 访客会话核心状态管理
 *
 * 职责：
 *   - sessionId 的创建与 localStorage 恢复
 *   - 消息列表的 localStorage 持久化（最近 100 条）
 *   - lastSeq 的 sessionStorage 管理（供断线重连增量同步使用）
 *   - 会话清除（含关联的转接标志）
 *
 * 不包含：SSE、WebSocket、转接、身份验证任何逻辑。
 */
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
}

// ---- 常量 ----

const HISTORY_KEY_PREFIX = 'chat_history_';
const LAST_SEQ_KEY_PREFIX = 'chat_last_seq_';
const HISTORY_MAX_SIZE = 100;

export function useVisitorSession() {
  const sessionId = ref('');
  const msgs = ref<Msg[]>([]);
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

  // ---- lastSeq（增量同步游标） ----

  /** 读取当前 lastSeq，脏数据或缺省返回 0 */
  function readLastSeq(): number {
    const raw = sessionStorage.getItem(LAST_SEQ_KEY_PREFIX + sessionId.value);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** 仅在 newSeq 大于当前值时更新，防止乱序回退 */
  function writeLastSeq(newSeq: number): void {
    if (!Number.isFinite(newSeq) || newSeq <= 0) return;
    if (newSeq > readLastSeq()) {
      sessionStorage.setItem(
        LAST_SEQ_KEY_PREFIX + sessionId.value,
        String(newSeq),
      );
    }
  }

  // ---- 会话清除 ----

  function clearSession(): void {
    msgs.value = [];
    msgId = 0;
    const sid = sessionId.value;
    localStorage.removeItem(HISTORY_KEY_PREFIX + sid);
    localStorage.removeItem('chat_session_id');
    // 同步清除转接标志，避免下次进入时误入 WS 重连
    localStorage.removeItem(`chat_transferred_${sid}`);
    sessionId.value = '';
  }

  return {
    sessionId,
    msgs,
    initSession,
    loadHistory,
    clearSession,
    appendMsg,
    readLastSeq,
    writeLastSeq,
  };
}
