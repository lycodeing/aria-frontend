import type { CsatRequestPayload } from '#/api/csat/types';

/**
 * useSSEStream — AI 流式对话 SSE 解析与事件分发
 *
 * 职责：
 *   - 建立 fetch 流式连接，按 WHATWG SSE 规范解析事件流
 *   - 按 `event:` 字段分发到对应回调，禁止未知事件 fallthrough 到文字拼接
 *   - 管理 streaming 状态和 AbortController 生命周期
 *
 * Wire format 契约（与后端 ChatEvent 保持一致）：
 *   除终止帧外，所有事件的 `data` 字段都是紧凑 JSON 信封，
 *   与 OpenAI / Azure OpenAI Chat Completion streaming 官方格式一致。
 *
 *   | event         | data                                    | 回调         |
 *   |---------------|-----------------------------------------|--------------|
 *   | (缺省)        | {"content":"..."}                       | onToken      |
 *   | sources       | [{"docId":"...","label":"..."}]         | onSources    |
 *   | tool_call     | {"tool":"...","status":"RUNNING"}       | onToolCall   |
 *   | tool_done     | {"tool":"...","status":"SUCCESS",...}   | onToolDone   |
 *   | transfer      | {"intentCode":"...","message":"..."}    | onTransfer   |
 *   | error         | {"message":"..."}                       | onError      |
 *   | domain_switch | {"code":"..."}                          | onDomainSwitch |
 *   | done          | [DONE]（字面量，非 JSON）              | onDone       |
 */
import { ref } from 'vue';

import { doReAuthenticate } from '#/api/request';

// ---- payload 类型（与后端 payload/*.java record 一一对应）----

export interface TokenPayload {
  content: string;
}

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

export interface ErrorPayload {
  message: string;
}

export interface DomainSwitchPayload {
  code: string;
}

// ---- composable ----

export interface SSEStreamHandlers {
  /** AI 回复 token（无 event 行，data 为 TokenPayload JSON） */
  onToken: (text: string) => void;
  /** 知识库溯源标签 */
  onSources: (sources: string[]) => void;
  /** 工具执行中 */
  onToolCall?: (payload: ToolCallPayload) => void;
  /** 工具执行完成 */
  onToolDone?: (payload: ToolDonePayload) => void;
  /** AI 工具触发转接人工 */
  onTransfer: (payload: TransferPayload) => void;
  /** 域切换信号（访客端可静默忽略） */
  onDomainSwitch?: (code: string) => void;
  /** CSAT 评价邀请（AI 流末尾追加，data 为 CsatRequestPayload JSON） */
  onCsatRequest?: (payload: CsatRequestPayload) => void;
  /** 业务错误 */
  onError: (msg: string) => void;
  /** 流正常结束（收到 event:done + data:[DONE]） */
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
  /**
   * 可选：访客 token 取值器。返回非空时以 `Authorization: Bearer <token>` 挂载，
   * 后端据此关联手机号身份，识别到订单/账单等敏感问题。
   */
  visitorToken?: () => string,
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
      const token = visitorToken?.() ?? '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch('/conversation/api/v1/chat/stream', {
        body: JSON.stringify({
          message,
          sessionId: sessionId.value,
          ...(code ? { domainCode: code } : {}),
        }),
        headers,
        method: 'POST',
        signal,
      });

      if (response.status === 401) {
        // token 过期：走统一的重新认证流程（清 token + logout/modal）
        void doReAuthenticate();
        return;
      }
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

  // ---- 内部：SSE 逐行解析（严格遵守 WHATWG SSE 规范） ----
  //
  // https://html.spec.whatwg.org/multipage/server-sent-events.html
  //   - 事件由空行（\n\n 或 \r\n\r\n）分隔，同一事件内多条 `data:` 行用 \n 拼接
  //   - `data:` / `event:` 之后若紧跟单个空格，该空格被视为分隔符，需剥离
  //   - 行尾 \r 需剥离（兼容 CRLF）
  //   - 空 `data:` 行也贡献一条空字符串（同事件多条 data 拼接时形成 \n）
  //
  // 之所以能安全遵循规范：本项目 wire format 已升级为 JSON 信封，
  // token 内的前导空格/换行由 JSON.stringify 编码为 "\u0020"/"\\n"，
  // 不再依赖 SSE 层保留原始空白。
  async function parseSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const decoder = new TextDecoder();
    let lineBuffer = '';
    let currentEvent = '';
    let dataLines: string[] = [];

    const flush = async (): Promise<void> => {
      if (dataLines.length > 0) {
        const data = dataLines.join('\n');
        dataLines = [];
        await dispatchEvent(currentEvent, data, reader);
      }
      currentEvent = '';
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
          await flush();
          continue;
        }
        if (line.startsWith(':')) {
          // 注释行（心跳），跳过
          continue;
        }
        if (line.startsWith('event:')) {
          currentEvent = stripFieldPrefix(line, 'event:'.length);
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(stripFieldPrefix(line, 'data:'.length));
          continue;
        }
        // 其他字段（id: / retry:）按规范忽略
      }
    }

    // 流末尾兜底 flush，避免最后一条事件未带空行边界而丢失
    await flush();
  }

  /**
   * SSE 字段值提取：截掉字段前缀后，若首字符是空格则再剥离一个空格（WHATWG 要求）。
   */
  function stripFieldPrefix(line: string, prefixLen: number): string {
    const rest = line.slice(prefixLen);
    return rest.startsWith(' ') ? rest.slice(1) : rest;
  }

  /**
   * 安全 JSON 解析：失败返回 undefined 而不抛，调用点可用可选链降级。
   */
  function tryParse<T>(data: string): T | undefined {
    try {
      return JSON.parse(data) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * 根据 currentEvent 分发到对应处理器。
   * 所有已知 event 类型必须有明确分支，未知事件静默忽略（防止 JSON 污染文字）。
   */
  async function dispatchEvent(
    event: string,
    data: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    // done 事件是唯一保留字面量的帧（与 OpenAI 规范一致，非 JSON 信封）
    if (event === 'done' || data === '[DONE]') {
      streaming.value = false;
      handlers.onDone();
      await reader.cancel();
      return;
    }

    switch (event) {
      case '': {
        // token 事件：data 为 TokenPayload JSON 信封，解出 content 追加到当前气泡
        const payload = tryParse<TokenPayload>(data);
        if (payload && typeof payload.content === 'string') {
          if (payload.content) handlers.onToken(payload.content);
          return;
        }
        // 解析失败视为协议错误（不再兼容裸字符串），交给 onError 并终止流
        streaming.value = false;
        handlers.onError('接收到非法的 SSE 数据格式');
        await reader.cancel();
        break;
      }
      case 'csat_request': {
        // AI 对话流末尾追加的评价邀请，JSON 解析失败则静默忽略（不阻塞主流程）
        const payload = tryParse<CsatRequestPayload>(data);
        if (payload?.csatId) handlers.onCsatRequest?.(payload);
        break;
      }
      case 'domain_switch': {
        const payload = tryParse<DomainSwitchPayload>(data);
        if (payload?.code) handlers.onDomainSwitch?.(payload.code);
        break;
      }
      case 'error': {
        const payload = tryParse<ErrorPayload>(data);
        const message = payload?.message ?? '服务错误';
        streaming.value = false;
        handlers.onError(message);
        await reader.cancel();
        break;
      }
      case 'sources': {
        // sources 是 JSON 数组（不是对象信封），保留原有解析逻辑
        const list = tryParse<unknown[]>(data);
        if (Array.isArray(list)) handlers.onSources(list as string[]);
        break;
      }
      case 'tool_call': {
        if (!handlers.onToolCall) return;
        const payload = tryParse<ToolCallPayload>(data);
        if (payload) handlers.onToolCall(payload);
        break;
      }
      case 'tool_done': {
        if (!handlers.onToolDone) return;
        const payload = tryParse<ToolDonePayload>(data);
        if (payload) handlers.onToolDone(payload);
        break;
      }
      case 'transfer': {
        const payload = tryParse<TransferPayload>(data);
        // transfer 是关键 UI 状态切换，JSON 解析失败也走默认 payload 保证前端切态
        handlers.onTransfer(
          payload ?? {
            intentCode: 'agent_transfer',
            message: '已为您转接人工客服',
          },
        );
        break;
      }
      default: {
        // 未知事件：静默忽略（防止 JSON 污染文字气泡）
        break;
      }
    }
  }

  return { streaming, send, abort };
}
