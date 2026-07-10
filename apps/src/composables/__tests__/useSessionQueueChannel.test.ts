import { nextTick } from 'vue';

/**
 * useSessionQueueChannel 契约测试
 *
 * 覆盖範囲：
 *   - init() 建立 SSE 连接（幂等，已连接时不重复建连）
 *   - open 回调设置 sseConnected=true
 *   - ENQUEUE 事件：加入 queue，触发 onEnqueue 回调，去重
 *   - ACCEPTED 事件：从 queue 移除，不触发 onClosed
 *   - CLOSED 事件：从 queue 移除，触发 onClosed 回调
 *   - TRANSFER 事件：从 queue 移除，触发 onTransfer 回调
 *   - SSE error：sseConnected=false，触发指数退避重连
 *   - reconnect()：重置 retryCount，重新建连
 *   - dispose()：关闭连接，清空 queue，清空 sseConnected
 *   - offEnqueue / offClosed / offTransfer 后不再触发回调
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionQueueApi, subscribeSessionEvents } from '#/api/session';

import { useSessionQueueChannel } from '../useSessionQueueChannel';

// vi.mock calls are hoisted by Vitest transform, so placing them after imports is safe.
vi.mock('#/api/session', () => ({
  subscribeSessionEvents: vi.fn(),
  getSessionQueueApi: vi.fn(),
}));

vi.mock('ant-design-vue', () => ({
  message: { info: vi.fn() },
}));

vi.mock('@vben/stores', () => ({
  useAccessStore: () => ({ accessToken: 'test-token' }),
}));

// ---- MockEventSource ----
// lastEventSource is assigned from outside the class (in the mock factory)
// to avoid the no-this-alias lint rule.

class MockEsImpl {
  closed = false;
  listeners: Record<string, ((e: { data?: string }) => void)[]> = {};
  url: string;

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, handler: (e: { data?: string }) => void) {
    (this.listeners[type] ??= []).push(handler);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data?: unknown) {
    const handlers = this.listeners[type] ?? [];
    const event = data === undefined ? {} : { data: JSON.stringify(data) };
    handlers.forEach((h) => h(event));
  }
}

let lastEventSource: MockEsImpl | null = null;

/** Throws if no EventSource has been created — avoids non-null assertions. */
function getEs(): MockEsImpl {
  if (lastEventSource === null)
    throw new Error('No EventSource instance exists');
  return lastEventSource;
}

// ---- Test helpers ----

function makeItem(sessionId: string, userName = 'Test User') {
  return {
    sessionId,
    userName,
    waitSince: 0,
    transferReason: '',
    tag: '',
    status: 'WAITING' as const,
  };
}

// ---- Test Suite ----

describe('useSessionQueueChannel', () => {
  let channel: ReturnType<typeof useSessionQueueChannel>;

  beforeEach(async () => {
    vi.mocked(subscribeSessionEvents).mockImplementation(
      (onEvent, onError, onOpen) => {
        const es = new MockEsImpl('/api/v1/sessions/events');
        lastEventSource = es;
        es.addEventListener('open', () => onOpen?.());
        es.addEventListener('message', (e) => {
          if (e.data) {
            try {
              onEvent(JSON.parse(e.data));
            } catch {
              /* ignore non-JSON heartbeats */
            }
          }
        });
        if (onError) es.addEventListener('error', () => onError());
        return es as unknown as EventSource;
      },
    );
    vi.mocked(getSessionQueueApi).mockResolvedValue([]);

    channel = useSessionQueueChannel();
    channel.dispose();
    lastEventSource = null;
    await nextTick();
  });

  // ---- init ----

  it('init() 建立 SSE 连接', () => {
    channel.init('token');
    expect(lastEventSource).not.toBeNull();
  });

  it('init() 幂等：已连接时不重复建连', () => {
    channel.init('token');
    const first = lastEventSource;
    channel.init('token');
    expect(lastEventSource).toBe(first);
  });

  it('open 回调设置 sseConnected=true', () => {
    channel.init('token');
    getEs().emit('open');
    expect(channel.sseConnected.value).toBe(true);
  });

  // ---- ENQUEUE ----

  it('eNQUEUE 事件加入 queue', async () => {
    channel.init('token');
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s1', '张三') });
    await nextTick();
    expect(channel.queue.value).toHaveLength(1);
    expect(channel.queue.value[0]?.id).toBe('s1');
  });

  it('eNQUEUE 事件触发 onEnqueue 回调', async () => {
    const handler = vi.fn();
    channel.init('token');
    channel.onEnqueue(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s2', '李四') });
    await nextTick();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]?.id).toBe('s2');
  });

  it('eNQUEUE 去重：同 sessionId 不重复添加', async () => {
    channel.init('token');
    getEs().emit('open');
    const payload = { type: 'ENQUEUE', item: makeItem('s3', '王五') };
    getEs().emit('message', payload);
    getEs().emit('message', payload);
    await nextTick();
    expect(channel.queue.value).toHaveLength(1);
  });

  // ---- ACCEPTED ----

  it('aCCEPTED 事件从 queue 移除，不触发 onClosed', async () => {
    const closedHandler = vi.fn();
    channel.init('token');
    channel.onClosed(closedHandler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s4', '赵六') });
    getEs().emit('message', { type: 'ACCEPTED', item: makeItem('s4') });
    await nextTick();
    expect(channel.queue.value).toHaveLength(0);
    expect(closedHandler).not.toHaveBeenCalled();
  });

  // ---- CLOSED ----

  it('cLOSED 事件从 queue 移除并触发 onClosed', async () => {
    const closedHandler = vi.fn();
    channel.init('token');
    channel.onClosed(closedHandler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s5', '陈七') });
    getEs().emit('message', { type: 'CLOSED', item: makeItem('s5') });
    await nextTick();
    expect(channel.queue.value).toHaveLength(0);
    expect(closedHandler).toHaveBeenCalledWith('s5');
  });

  // ---- TRANSFER ----

  it('tRANSFER 事件从 queue 移除并触发 onTransfer', async () => {
    const transferHandler = vi.fn();
    channel.init('token');
    channel.onTransfer(transferHandler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s6', '周八') });
    getEs().emit('message', {
      type: 'TRANSFER',
      item: makeItem('s6'),
      fromAgentId: 'a1',
      toAgentId: 'a2',
    });
    await nextTick();
    expect(channel.queue.value).toHaveLength(0);
    expect(transferHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TRANSFER' }),
    );
  });

  // ---- 断线重连 ----

  it('sSE error 触发重连，sseConnected=false', async () => {
    vi.useFakeTimers();
    channel.init('token');
    getEs().emit('open');
    expect(channel.sseConnected.value).toBe(true);

    const erroredEs = getEs();
    erroredEs.emit('error');
    await nextTick();
    expect(channel.sseConnected.value).toBe(false);

    vi.advanceTimersByTime(1100);
    await nextTick();
    expect(lastEventSource).not.toBe(erroredEs);
    expect(lastEventSource).not.toBeNull();

    vi.useRealTimers();
  });

  it('reconnect() 立即重置并重建连接', async () => {
    channel.init('token');
    const first = lastEventSource;
    channel.reconnect();
    await nextTick();
    expect(lastEventSource).not.toBe(first);
    expect(lastEventSource).not.toBeNull();
  });

  // ---- dispose ----

  it('dispose() 关闭 SSE 连接、清空 queue、sseConnected=false', async () => {
    channel.init('token');
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s7', '吴九') });
    await nextTick();
    expect(channel.queue.value).toHaveLength(1);

    const es = getEs();
    channel.dispose();
    expect(channel.queue.value).toHaveLength(0);
    expect(channel.sseConnected.value).toBe(false);
    expect(es.closed).toBe(true);
  });

  // ---- off* ----

  it('offEnqueue 后不再触发回调', async () => {
    const handler = vi.fn();
    channel.init('token');
    channel.onEnqueue(handler);
    channel.offEnqueue(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s8', '郑十') });
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });

  it('offClosed 后不再触发回调', async () => {
    const handler = vi.fn();
    channel.init('token');
    channel.onClosed(handler);
    channel.offClosed(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s9', '刘一') });
    getEs().emit('message', { type: 'CLOSED', item: makeItem('s9') });
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });

  it('offTransfer 后不再触发回调', async () => {
    const handler = vi.fn();
    channel.init('token');
    channel.onTransfer(handler);
    channel.offTransfer(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s10', '陈二') });
    getEs().emit('message', {
      type: 'TRANSFER',
      item: makeItem('s10'),
      fromAgentId: 'a1',
      toAgentId: 'a2',
    });
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });
});
