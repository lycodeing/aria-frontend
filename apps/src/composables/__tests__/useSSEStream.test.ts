/**
 * useSSEStream 解析器契约测试。
 *
 * 覆盖范围：
 *   - WHATWG SSE 规范的行/字段/事件解析：空行边界、前导空格剥离、CRLF、多条 data: 拼接
 *   - Wire format 契约：token 事件为 {"content":"..."} JSON 信封，
 *     content 字段精确保留前导/尾部空白与换行
 *   - 结构化事件的 JSON 解析：sources / tool_call / tool_done / transfer / error / domain_switch
 *   - 边界情况：分片跨 chunk、CRLF、非法 JSON 触发 onError、[DONE] 提前终止
 */
import { ref } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SSEStreamHandlers } from '../useSSEStream';

import { useSSEStream } from '../useSSEStream';

// ---- 测试工具 ----

/** 把字符串数组按 chunk 顺序写入 ReadableStream，模拟 fetch 的 body 流。 */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[i];
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
      i++;
    },
  });
}

/** 构造完整的 Handlers（未指定的用 vi.fn 兜底），返回 spy 集合供断言。 */
function makeHandlers(overrides: Partial<SSEStreamHandlers> = {}) {
  const handlers: SSEStreamHandlers = {
    onToken: vi.fn(),
    onSources: vi.fn(),
    onToolCall: vi.fn(),
    onToolDone: vi.fn(),
    onTransfer: vi.fn(),
    onDomainSwitch: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
    ...overrides,
  };
  return handlers;
}

/**
 * 用给定 SSE 报文驱动 useSSEStream.send()，mock fetch，返回等 send 完成后的 handlers。
 * chunks 之间保持顺序，模拟服务端逐帧下发。
 */
async function runStream(
  chunks: string[],
  overrides: Partial<SSEStreamHandlers> = {},
) {
  const handlers = makeHandlers(overrides);
  const sessionId = ref('sid-test');
  const { send } = useSSEStream(sessionId, handlers);

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      body: streamFrom(chunks),
    })),
  );

  await send('hi');
  return handlers;
}

// ---- 测试 ----

describe('useSSEStream', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('token 事件通过 JSON 信封解出 content，精确保留前导空格与换行', async () => {
    // 复现 chat-widget 里天气工具的原始报文：token 天然带前导空格、包含换行
    const h = await runStream([
      'data: {"content":"### "}\n\n',
      'data: {"content":" 🔴 "}\n\n',
      'data: {"content":"实时天气"}\n\n',
      'data: {"content":"\\n\\n"}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ]);

    expect(h.onToken).toHaveBeenCalledTimes(4);
    expect(h.onToken).toHaveBeenNthCalledWith(1, '### ');
    expect(h.onToken).toHaveBeenNthCalledWith(2, ' 🔴 ');
    expect(h.onToken).toHaveBeenNthCalledWith(3, '实时天气');
    expect(h.onToken).toHaveBeenNthCalledWith(4, '\n\n');
    expect(h.onDone).toHaveBeenCalledTimes(1);
  });

  it(String.raw`同一事件内的多条 data: 行以 \n 拼接（WHATWG 规范）`, async () => {
    // JSON 信封下 payload 内的换行会被 JSON.stringify 转义为 "\\n"，
    // 因此后端不会把单个事件的 payload 拆成多条 data: 行。
    // 但如果服务端出于任何原因确实拆分了 data:（例如 sources 数组分片），
    // 前端解析器必须按 WHATWG 规范把多条 data: 用 \n 拼成完整字符串再交给 dispatcher。
    // 这里用 sources 事件验证多 data: 行的拼接行为，避免 JSON 内含真实换行导致的解析歧义。
    const h = await runStream([
      'event: sources\n',
      'data: [{"docId":"d1",\n',
      'data:  "label":"文档 A"}]\n',
      '\n',
      'event: done\ndata: [DONE]\n\n',
    ]);

    // 两条 data: 用 \n 拼接后 = [{"docId":"d1",\n "label":"文档 A"}]（合法 JSON）
    expect(h.onSources).toHaveBeenCalledTimes(1);
    expect(h.onSources).toHaveBeenCalledWith([
      { docId: 'd1', label: '文档 A' },
    ]);
  });

  it('crlf 行尾正确剥离', async () => {
    const h = await runStream([
      'data: {"content":"hello"}\r\n\r\n',
      'event: done\r\ndata: [DONE]\r\n\r\n',
    ]);
    expect(h.onToken).toHaveBeenCalledWith('hello');
    expect(h.onDone).toHaveBeenCalledTimes(1);
  });

  it('单个 SSE 帧被拆到多个 chunk 时能正确拼接', async () => {
    // 模拟 TCP 分片：一个事件被拆到不同 read() 调用
    const h = await runStream([
      'data: {"cont',
      'ent":"分片',
      '拼接"}\n',
      '\n',
      'event: done\ndata: [DONE]\n\n',
    ]);
    expect(h.onToken).toHaveBeenCalledTimes(1);
    expect(h.onToken).toHaveBeenCalledWith('分片拼接');
  });

  it('event: done 直接终止流并触发 onDone，data 可为 [DONE] 字面量', async () => {
    const h = await runStream([
      'data: {"content":"prefix"}\n\n',
      'event: done\ndata: [DONE]\n\n',
      // 后续数据不应被处理（reader.cancel 已发起）
      'data: {"content":"IGNORED"}\n\n',
    ]);

    expect(h.onDone).toHaveBeenCalledTimes(1);
    // 只应收到 [DONE] 前的 token
    const tokenCalls = (h.onToken as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(tokenCalls.map((c) => c[0])).toEqual(['prefix']);
  });

  it('error 事件为 {"message":"..."} JSON 信封', async () => {
    const h = await runStream([
      'event: error\ndata: {"message":"上游超时"}\n\n',
    ]);
    expect(h.onError).toHaveBeenCalledWith('上游超时');
    // error 事件同样终止流
  });

  it('transfer 事件透传 payload；JSON 解析失败时用默认 payload 兜底', async () => {
    const h1 = await runStream([
      'event: transfer\ndata: {"intentCode":"agent_transfer","message":"稍候"}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ]);
    expect(h1.onTransfer).toHaveBeenCalledWith({
      intentCode: 'agent_transfer',
      message: '稍候',
    });

    // 非法 JSON：兜底默认 payload，保证前端仍能切换 UI 状态
    const h2 = await runStream([
      'event: transfer\ndata: not-a-json\n\n',
      'event: done\ndata: [DONE]\n\n',
    ]);
    expect(h2.onTransfer).toHaveBeenCalledWith({
      intentCode: 'agent_transfer',
      message: '已为您转接人工客服',
    });
  });

  it('tool_call / tool_done payload 透传', async () => {
    const h = await runStream([
      'event: tool_call\ndata: {"tool":"get_weather","status":"RUNNING"}\n\n',
      'event: tool_done\ndata: {"tool":"get_weather","status":"SUCCESS","durationMs":1499}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ]);
    expect(h.onToolCall).toHaveBeenCalledWith({
      tool: 'get_weather',
      status: 'RUNNING',
    });
    expect(h.onToolDone).toHaveBeenCalledWith({
      tool: 'get_weather',
      status: 'SUCCESS',
      durationMs: 1499,
    });
  });

  it('sources 事件解析 JSON 数组', async () => {
    const h = await runStream([
      'event: sources\ndata: [{"docId":"d1","label":"文档 1"}]\n\n',
      'event: done\ndata: [DONE]\n\n',
    ]);
    expect(h.onSources).toHaveBeenCalledWith([
      { docId: 'd1', label: '文档 1' },
    ]);
  });

  it('domain_switch 事件解出 code 字段', async () => {
    const h = await runStream([
      'event: domain_switch\ndata: {"code":"weather"}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ]);
    expect(h.onDomainSwitch).toHaveBeenCalledWith('weather');
  });

  it('token 事件的非法 JSON 触发 onError 并终止流（不再兼容裸字符串）', async () => {
    const h = await runStream([
      'data: this-is-not-json\n\n',
      // 后续数据不应被处理
      'data: {"content":"IGNORED"}\n\n',
    ]);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith('接收到非法的 SSE 数据格式');
    expect(h.onToken).not.toHaveBeenCalled();
  });

  it('注释行（心跳）与未知 event 类型被静默忽略', async () => {
    const h = await runStream([
      ': heartbeat\n\n',
      'event: unknown_kind\ndata: {"foo":"bar"}\n\n',
      'data: {"content":"ok"}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ]);
    expect(h.onToken).toHaveBeenCalledTimes(1);
    expect(h.onToken).toHaveBeenCalledWith('ok');
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('流末未带空行边界的最后事件仍能通过兜底 flush 送达', async () => {
    // 最后一个事件后没有空行 —— 依赖 parseSseStream 的末尾 flush
    const h = await runStream([
      'data: {"content":"末尾无空行"}\n',
      // 注意最后没有 \n\n
    ]);
    expect(h.onToken).toHaveBeenCalledWith('末尾无空行');
  });
});
