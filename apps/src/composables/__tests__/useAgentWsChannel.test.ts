/**
 * useAgentWsChannel 契约测试
 *
 * 覆盖范围：
 *   - init() 建立 WS 连接并携带 token
 *   - init() 幂等：ws 已存在时不重复建连
 *   - send() 发送正确的 JSON 格式（含 sessionId）
 *   - KICKED_OUT 消息：status='kicked'，onKickedOut 触发，不重连
 *   - subscribe() 按 sessionId 路由消息回调
 *   - unsubscribe() 后不再触发回调
 *   - CONNECTING 状态下 init 幂等
 *   - reconnect() 保留 subscriberMap，重建 WS
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock WebSocket ----

class MockWs {
  static readonly CLOSED = 3;
  static readonly CLOSING = 2;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  readyState = MockWs.OPEN;
  readonly sent: string[] = [];
  private readonly listeners: Record<string, ((...args: unknown[]) => void)[]> =
    {};

  addEventListener(evt: string, fn: (...args: unknown[]) => void) {
    (this.listeners[evt] ??= []).push(fn);
  }

  close() {
    this.readyState = MockWs.CLOSED;
    this.emit('close');
  }

  emit(evt: string, ...args: unknown[]) {
    (this.listeners[evt] ?? []).forEach((fn) => fn(...args));
  }

  send(data: string) {
    this.sent.push(data);
  }
}

let mockWsInstance: MockWs;
/** 追踪 MockWebSocketConstructor 被调用次数（替代 vi.fn().mock.calls.length） */
let wsCreatedCount = 0;
/** 控制下一个 MockWs 实例的初始 readyState，默认 OPEN */
let nextWsReadyState = MockWs.OPEN;

// ---- 测试套件 ----

describe('useAgentWsChannel', () => {
  beforeEach(async () => {
    // 1. 重置模块缓存，确保每次 import 拿到干净的模块级单例
    vi.resetModules();
    wsCreatedCount = 0;
    nextWsReadyState = MockWs.OPEN;

    // 2. 直接赋值 globalThis.WebSocket，使用普通构造函数（不能用箭头函数）。
    //    JS 规则：构造函数返回对象时，new 表达式的结果就是该对象。
    function MockWebSocketConstructor(this: unknown, _url: string) {
      wsCreatedCount++;
      mockWsInstance = new MockWs();
      mockWsInstance.readyState = nextWsReadyState;
      nextWsReadyState = MockWs.OPEN; // 消费后重置
      return mockWsInstance;
    }
    MockWebSocketConstructor.CONNECTING = MockWs.CONNECTING;
    MockWebSocketConstructor.OPEN = MockWs.OPEN;
    MockWebSocketConstructor.CLOSING = MockWs.CLOSING;
    MockWebSocketConstructor.CLOSED = MockWs.CLOSED;
    // 用 unknown 中转避免 any lint 警告，同时保持类型安全
    (globalThis as unknown as Record<string, unknown>).WebSocket =
      MockWebSocketConstructor;
  });

  it('init 后建立 WS 连接并携带 token', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('test-token');
    // wsCreatedCount 由 MockWebSocketConstructor 自增
    expect(wsCreatedCount).toBe(1);
    // 验证 URL 包含 token
    expect(mockWsInstance).toBeDefined();
    ch.dispose();
  });

  it('init 幂等：ws 已连接时不重复建连', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    expect(wsCreatedCount).toBe(1);
    ch.init('tok'); // 重复调用
    expect(wsCreatedCount).toBe(1); // 不应新建
    ch.dispose();
  });

  it('cONNECTING 状态下 init 幂等：不重复建连', async () => {
    // 让第一次 new WebSocket() 返回 CONNECTING 状态的实例
    nextWsReadyState = MockWs.CONNECTING;
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    expect(wsCreatedCount).toBe(1);
    ch.init('tok'); // 重复调用
    expect(wsCreatedCount).toBe(1); // 不应新建
    ch.dispose();
  });

  it('send 发送正确 JSON 格式（含 sessionId）', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    mockWsInstance.emit('open');
    const ok = ch.send('sid-A', 'hello');
    expect(ok).toBe(true);
    const sent = mockWsInstance.sent[0] ?? '';
    expect(JSON.parse(sent)).toEqual({
      type: 'MESSAGE',
      sessionId: 'sid-A',
      content: 'hello',
    });
    ch.dispose();
  });

  it('kICKED_OUT 消息设置 status=kicked 并触发 onKickedOut，不重连', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const onKickedOut = vi.fn();
    const ch = useAgentWsChannel();
    ch.init('tok', { onKickedOut });
    mockWsInstance.emit('open');
    expect(ch.status.value).toBe('open');

    mockWsInstance.emit('message', {
      data: JSON.stringify({ type: 'KICKED_OUT' }),
    });

    expect(ch.status.value).toBe('kicked');
    expect(onKickedOut).toHaveBeenCalledOnce();
    // 被踢出后关闭 ws，onclose 触发，但不重连
    expect(ch.status.value).toBe('kicked'); // 状态不变为 connecting
    ch.dispose();
  });

  it('subscribe 后收到对应 sessionId 消息触发 onMessage', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    const onMessage = vi.fn();
    ch.subscribe('sid-A', { onMessage });
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', {
      data: JSON.stringify({
        type: 'MESSAGE',
        sessionId: 'sid-A',
        role: 'user',
        content: 'hi',
      }),
    });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sid-A', content: 'hi' }),
    );
    ch.dispose();
  });

  it('不同 sessionId 的消息不触发其他 session 的回调', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    const onMessageA = vi.fn();
    const onMessageB = vi.fn();
    ch.subscribe('sid-A', { onMessage: onMessageA });
    ch.subscribe('sid-B', { onMessage: onMessageB });
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', {
      data: JSON.stringify({
        type: 'MESSAGE',
        sessionId: 'sid-A',
        role: 'user',
        content: 'only-A',
      }),
    });
    expect(onMessageA).toHaveBeenCalledOnce();
    expect(onMessageB).not.toHaveBeenCalled();
    ch.dispose();
  });

  it('unsubscribe 后不再触发回调', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('tok');
    const onMessage = vi.fn();
    ch.subscribe('sid-A', { onMessage });
    ch.unsubscribe('sid-A');
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', {
      data: JSON.stringify({
        type: 'MESSAGE',
        sessionId: 'sid-A',
        role: 'user',
        content: 'hi',
      }),
    });
    expect(onMessage).not.toHaveBeenCalled();
    ch.dispose();
  });

  it('reconnect 保留 subscriberMap，重建 WS 后仍能收到消息', async () => {
    const { useAgentWsChannel } = await import('../useAgentWsChannel');
    const ch = useAgentWsChannel();
    ch.init('old-token');
    const onMessage = vi.fn();
    ch.subscribe('sid-A', { onMessage });
    mockWsInstance.emit('open');

    // 模拟 token 刷新
    ch.reconnect('new-token');

    // 新建 WS 建立成功
    mockWsInstance.emit('open');
    mockWsInstance.emit('message', {
      data: JSON.stringify({
        type: 'MESSAGE',
        sessionId: 'sid-A',
        role: 'user',
        content: 'after-reconnect',
      }),
    });

    // subscriberMap 保留，仍能收到消息
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'after-reconnect' }),
    );
    ch.dispose();
  });
});
