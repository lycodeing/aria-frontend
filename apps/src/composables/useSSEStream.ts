/**
 * useSSEStream — AI 流式对话 SSE 解析与事件分发
 *
 * 职责：
 *   - 建立 fetch 流式连接，逐行解析 SSE 协议
 *   - 按 `event:` 字段分发到对应回调，禁止未知事件 fallthrough 到文字拼接
 *   - 管理 streaming 状态和 AbortController 生命周期
 *
 * SSE 事件与回调映射：
 *   无 event（data token）→ onToken         AI 回复 token
 *   sources              → onSources        知识库溯源标签
 *   error                → onError          业务错误，自动停流
 *   done（data=[DONE]）  → onDone           流结束信号
 *   tool_call            → onToolCall       工具执行中（静默，不拼入文字）
 *   tool_done            → onToolDone       工具执行完成（静默）
 *   transfer             → onTransfer       AI 触发转接
 *   domain_switch        → onDomainSwitch   域切换（静默）
 *   slot_ask / candidates → 静默忽略（预留）
 */
import { ref } from 'vue';

// ---- payload 类型 ----

export interface ToolCallPayload {
  tool: string;
  status: string;
}

export interface ToolDonePayload {
  tool: string;
  status: string;
  durationMs: number;
  errorMsg?: string;
}

export interface TransferPayload {
  intentCode: string;
  message: string;
}

// ---- composable ----

export interface CandidateItem {
  id: string;
  label: string;
}

export interface SlotAskPayload {
  question: string;
  slot?: string;
}

export interface SSEStreamHandlers {
  /** AI 回复 token（无 event 行的 data） */
  onToken: (text: string) => void;
  /** 知识库溯源标签 */
  onSources: (sources: string[]) => void;
  /** 工具执行中（进行中的状态更新，例如内嵌到 AI 气泡显示） */
  onToolCall?: (payload: ToolCallPayload) => void;
  /** 工具执行完成 */
  onToolDone?: (payload: ToolDonePayload) => void;
  /** AI 工具触发转接人工 */
  onTransfer: (payload: TransferPayload) => void;
  /** 域切换信号（访客端静默忽略） */
  onDomainSwitch?: (code: string) => void;
  /** 槽位追问：AI 需要用户补充信息 */
  onSlotAsk?: (payload: SlotAskPayload) => void;
  /** 候选选项：AI 提供若干候选让用户点选 */
  onCandidates?: (list: CandidateItem[]) => void;
  /** 业务错误 */
  onError: (msg: string) => void;
  /** 流正常结束（[DONE]） */
  onDone: () => void;
}

export function useSSEStream(
  sessionId: { value: string },
  handlers: SSEStreamHandlers,
  /**
   * 可选：域码取值器。返回非空字符串时会以 `domainCode` 字段随请求体一起发送，
   * 供后端做域路由（例如 ?domainCode=weather 走天气域小模型）。
   */
  domainCode?: () => string,
) {
  const streaming = ref(false);
  let abortCtrl: AbortController | null = null;

  /**
   * 发起流式 AI 请求。
   * 调用前请先在外部创建 AI 消息气泡，通过 handlers 实时填充内容。
   */
  async function send(message: string): Promise<void> {
    // 取消上一次未完成的请求（防止并发写同一气泡）
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    const signal = abortCtrl.signal;
    streaming.value = true;

    let reader: null | ReadableStreamDefaultReader<Uint8Array> = null;
    try {
      const code = domainCode?.() ?? '';
      const response = await fetch('/api/v1/chat/stream', {
        body: JSON.stringify({
          message,
          sessionId: sessionId.value,
          ...(code ? { domainCode: code } : {}),
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      reader = response.body.getReader();
      await parseSseStream(reader, signal);
    } catch (error: unknown) {
      // AbortError 是主动取消（组件卸载/重试），不视为业务失败
      if (error instanceof Error && error.name === 'AbortError') return;
      handlers.onError('抱歉，AI 服务暂时不可用，请点击重试。');
    } finally {
      streaming.value = false;
      // 确保 reader 在所有退出路径上都被释放
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          /* 已关闭则忽略 */
        }
      }
    }
  }

  /** 主动取消当前流（组件卸载时调用） */
  function abort(): void {
    abortCtrl?.abort();
  }

  // ---- 内部：SSE 逐行解析 ----

  async function parseSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let lineBuffer = '';
    // currentEvent 记录最近一条 `event:` 行的值，空行后重置
    let currentEvent = '';

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      // 最后一段可能不完整，留到下次循环拼接
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') {
          // 空行：SSE 消息边界，重置当前事件类型
          currentEvent = '';
          continue;
        }
        if (trimmed.startsWith(':')) {
          // 注释行（心跳），跳过
          continue;
        }
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          await dispatchEvent(currentEvent, data, reader);
        }
      }
    }
  }

  /**
   * 根据 currentEvent 分发到对应处理器。
   * 所有已知 event 类型必须有明确分支，禁止 fallthrough 到文字拼接。
   */
  async function dispatchEvent(
    event: string,
    data: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    if (data === '[DONE]') {
      // 流结束信号，无论 event 是什么都终止
      streaming.value = false;
      handlers.onDone();
      await reader.cancel();
      return;
    }

    switch (event) {
      case '': {
        // 无 event 行：普通 AI 回复 token
        if (data) handlers.onToken(data);
        break;
      }
      case 'candidates': {
        // 候选选项：data 为 JSON 数组 [{id, label}, ...]
        if (handlers.onCandidates) {
          try {
            const list = JSON.parse(data);
            handlers.onCandidates(Array.isArray(list) ? list : []);
          } catch {
            /* 忽略解析失败 */
          }
        }
        break;
      }
      case 'slot_ask': {
        // 槽位追问：data 可能是 JSON {question, slot} 或直接文本
        if (handlers.onSlotAsk) {
          let payload: SlotAskPayload;
          try {
            payload = JSON.parse(data);
          } catch {
            payload = { question: data };
          }
          handlers.onSlotAsk(payload);
        }
        break;
      }
      case 'domain_switch': {
        // 域切换信号，访客端静默忽略（不拼入文字）
        handlers.onDomainSwitch?.(data);
        break;
      }
      case 'error': {
        // 业务错误，显示错误文字并终止流
        streaming.value = false;
        handlers.onError(data);
        await reader.cancel();
        break;
      }
      case 'sources': {
        // 知识库溯源标签，data 为 JSON 字符串数组
        try {
          handlers.onSources(JSON.parse(data));
        } catch {
          /* 解析失败静默忽略，不影响正文 */
        }
        break;
      }
      case 'tool_call': {
        // 工具执行中：解析 payload，回调可选（不展示则静默忽略）
        if (handlers.onToolCall) {
          try {
            handlers.onToolCall(JSON.parse(data));
          } catch {
            /* 忽略 */
          }
        }
        break;
      }
      case 'tool_done': {
        // 工具执行完成：解析 payload，回调可选
        if (handlers.onToolDone) {
          try {
            handlers.onToolDone(JSON.parse(data));
          } catch {
            /* 忽略 */
          }
        }
        break;
      }
      case 'transfer': {
        // AI 工具触发转接人工
        try {
          handlers.onTransfer(JSON.parse(data));
        } catch {
          // JSON 解析失败时用默认 payload 兜底
          handlers.onTransfer({
            intentCode: 'agent_transfer',
            message: '已为您转接人工客服',
          });
        }
        break;
      }
      default: {
        // 未知事件类型：静默忽略，防止 JSON 污染文字
        break;
      }
    }
  }

  return { streaming, send, abort };
}
