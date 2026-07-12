import { nextTick } from 'vue';

/**
 * useSessionQueueChannel 契约测试
 *
 * 覆盖範囲：
 *   - init() 建立 SSE 连接（幂等，已连接时不重复建连）
 *   - open 回调设置 sseConnected=true
 *   - ENQUEUE 事件：加入 sessions，触发 onEnqueue 回调，去重
 *   - ACCEPTED 事件：status 改为 ACTIVE，不触发 onClosed
 *   - CLOSED 事件：status 改为 CLOSED，触发 onClosed 回调
 *   - TRANSFER 事件：从 sessions 移除，触发 onTransfer 回调
 *   - SSE error：sseConnected=false，触发指数退避重连
 *   - reconnect()：重置 retryCount，重新建连
 *   - dispose()：关闭连接，清空 sessions，清空 sseConnected
 *   - offEnqueue / offClosed / offTransfer 后不再触发回调
 *   - 切片：sessions / aiQueue / waitingQueue / activeQueue / closedQueue
 *   - loadSessions() 使用 getAllSessionsApi 填充 sessions
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAllSessionsApi, subscribeSessionEvents } from '#/api/session';

import { useSessionQueueChannel } from '../useSessionQueueChannel';

// vi.mock calls are hoisted by Vitest transform, so placing them after imports is safe.
vi.mock('#/api/session', () => ({
  subscribeSessionEvents: vi.fn(),
  getAllSessionsApi: vi.fn(),
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

function makeItem(
  sessionId: string,
  userName = 'Test User',
  status: 'ACTIVE' | 'AI_CHAT' | 'CLOSED' | 'WAITING' = 'WAITING',
) {
  return {
    sessionId,
    userName,
    waitSince: 0,
    transferReason: '',
    tag: '',
    status,
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
    vi.mocked(getAllSessionsApi).mockResolvedValue([]);

    channel = useSessionQueueChannel();
    channel.dispose();
    lastEventSource = null;
    await nextTick();
  });

  // ---- init ----

  it('init() 建立 SSE 连接', () => {
    channel.init();
    expect(lastEventSource).not.toBeNull();
  });

  it('init() 幂等：已连接时不重复建连', () => {
    channel.init();
    const first = lastEventSource;
    channel.init();
    expect(lastEventSource).toBe(first);
  });

  it('open 回调设置 sseConnected=true', () => {
    channel.init();
    getEs().emit('open');
    expect(channel.sseConnected.value).toBe(true);
  });

  // ---- ENQUEUE ----

  it('enqueue 事件加入 sessions 并出现在 waitingQueue 切片', async () => {
    channel.init();
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s1', '张三', 'WAITING') });
    await nextTick();
    expect(channel.sessions.value).toHaveLength(1);
    expect(channel.sessions.value[0]?.id).toBe('s1');
    expect(channel.sessions.value[0]?.status).toBe('WAITING');
    expect(channel.waitingQueue.value).toHaveLength(1);
    expect(channel.aiQueue.value).toHaveLength(0);
  });

  it('enqueue 事件触发 onEnqueue 回调', async () => {
    const handler = vi.fn();
    channel.init();
    channel.onEnqueue(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s2', '李四', 'WAITING') });
    await nextTick();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]?.id).toBe('s2');
  });

  it('enqueue 去重：同 sessionId 不重复添加', async () => {
    channel.init();
    getEs().emit('open');
    const payload = { type: 'ENQUEUE', item: makeItem('s3', '王五', 'WAITING') };
    getEs().emit('message', payload);
    getEs().emit('message', payload);
    await nextTick();
    expect(channel.sessions.value).toHaveLength(1);
  });

  // ---- ACCEPTED ----

  it('accepted 事件将 status 改为 ACTIVE，不触发 onClosed', async () => {
    const closedHandler = vi.fn();
    channel.init();
    channel.onClosed(closedHandler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s4', '赵六', 'WAITING') });
    getEs().emit('message', { type: 'ACCEPTED', item: makeItem('s4') });
    await nextTick();
    // 条目仍在 sessions，status 变为 ACTIVE
    expect(channel.sessions.value).toHaveLength(1);
    expect(channel.sessions.value[0]?.status).toBe('ACTIVE');
    expect(channel.waitingQueue.value).toHaveLength(0);
    expect(channel.activeQueue.value).toHaveLength(1);
    expect(closedHandler).not.toHaveBeenCalled();
  });

  // ---- CLOSED ----

  it('closed 事件将 status 改为 CLOSED 并触发 onClosed', async () => {
    const closedHandler = vi.fn();
    channel.init();
    channel.onClosed(closedHandler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s5', '陈七', 'WAITING') });
    getEs().emit('message', { type: 'CLOSED', item: makeItem('s5') });
    await nextTick();
    // 条目保留在 sessions，status 改为 CLOSED
    expect(channel.sessions.value).toHaveLength(1);
    expect(channel.sessions.value[0]?.status).toBe('CLOSED');
    expect(channel.closedQueue.value).toHaveLength(1);
    expect(channel.waitingQueue.value).toHaveLength(0);
    expect(closedHandler).toHaveBeenCalledWith('s5');
  });

  // ---- TRANSFER ----

  it('transfer 事件从 sessions 移除并触发 onTransfer', async () => {
    const transferHandler = vi.fn();
    channel.init();
    channel.onTransfer(transferHandler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s6', '周八', 'WAITING') });
    getEs().emit('message', {
      type: 'TRANSFER',
      item: makeItem('s6'),
      fromAgentId: 'a1',
      toAgentId: 'a2',
    });
    await nextTick();
    expect(channel.sessions.value).toHaveLength(0);
    expect(transferHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TRANSFER' }),
    );
  });

  // ---- 断线重连 ----

  it('sse error 触发重连，sseConnected=false', async () => {
    vi.useFakeTimers();
    channel.init();
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
    channel.init();
    const first = lastEventSource;
    channel.reconnect();
    await nextTick();
    expect(lastEventSource).not.toBe(first);
    expect(lastEventSource).not.toBeNull();
  });

  it('max_retries 耗尽后停止重连，sseStatus=error', async () => {
    vi.useFakeTimers();
    channel.init();
    const MAX = 10;
    for (let i = 0; i < MAX; i++) {
      const es = getEs();
      es.emit('error');
      await nextTick();
      vi.advanceTimersByTime(30_001); // advance past max delay
      await nextTick();
    }
    // 第 MAX+1 次 error 触发耗尽逻辑（sseRetryCount 此时已等于 MAX_RETRIES）
    getEs().emit('error');
    await nextTick();
    expect(channel.sseStatus.value).toBe('error');
    expect(channel.sseConnected.value).toBe(false);
    vi.useRealTimers();
  });

  // ---- dispose ----

  it('dispose() 关闭 SSE 连接、清空 sessions、sseConnected=false', async () => {
    channel.init();
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s7', '吴九', 'WAITING') });
    await nextTick();
    expect(channel.sessions.value).toHaveLength(1);

    const es = getEs();
    channel.dispose();
    expect(channel.sessions.value).toHaveLength(0);
    expect(channel.waitingQueue.value).toHaveLength(0);
    expect(channel.aiQueue.value).toHaveLength(0);
    expect(channel.activeQueue.value).toHaveLength(0);
    expect(channel.closedQueue.value).toHaveLength(0);
    expect(channel.sseConnected.value).toBe(false);
    expect(es.closed).toBe(true);
  });

  // ---- off* ----

  it('offEnqueue 后不再触发回调', async () => {
    const handler = vi.fn();
    channel.init();
    channel.onEnqueue(handler);
    channel.offEnqueue(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s8', '郑十', 'WAITING') });
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });

  it('offClosed 后不再触发回调', async () => {
    const handler = vi.fn();
    channel.init();
    channel.onClosed(handler);
    channel.offClosed(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s9', '刘一', 'WAITING') });
    getEs().emit('message', { type: 'CLOSED', item: makeItem('s9') });
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });

  it('offTransfer 后不再触发回调', async () => {
    const handler = vi.fn();
    channel.init();
    channel.onTransfer(handler);
    channel.offTransfer(handler);
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s10', '陈二', 'WAITING') });
    getEs().emit('message', {
      type: 'TRANSFER',
      item: makeItem('s10'),
      fromAgentId: 'a1',
      toAgentId: 'a2',
    });
    await nextTick();
    expect(handler).not.toHaveBeenCalled();
  });

  // ---- 新增：AI_CHAT 切片 ----

  it('AI_CHAT 状态的 enqueue 进入 aiQueue 切片', async () => {
    channel.init();
    getEs().emit('open');
    getEs().emit('message', {
      type: 'ENQUEUE',
      item: makeItem('s-ai', 'AI用户', 'AI_CHAT'),
    });
    await nextTick();
    expect(channel.aiQueue.value).toHaveLength(1);
    expect(channel.waitingQueue.value).toHaveLength(0);
  });

  // ---- 新增：WAITING → ACTIVE 状态迁移 ----

  it('ACCEPTED 事件完成 WAITING→ACTIVE 迁移，条目不被删除', async () => {
    channel.init();
    getEs().emit('open');
    getEs().emit('message', { type: 'ENQUEUE', item: makeItem('s-w', '等待用户', 'WAITING') });
    await nextTick();
    expect(channel.waitingQueue.value).toHaveLength(1);

    getEs().emit('message', { type: 'ACCEPTED', item: makeItem('s-w') });
    await nextTick();
    expect(channel.waitingQueue.value).toHaveLength(0);
    expect(channel.activeQueue.value).toHaveLength(1);
    expect(channel.sessions.value).toHaveLength(1);
  });

  // ---- 新增：loadSessions 使用 getAllSessionsApi ----

  it('loadSessions() 从 getAllSessionsApi 填充 sessions', async () => {
    vi.mocked(getAllSessionsApi).mockResolvedValue([
      makeItem('ls1', '加载用户', 'WAITING'),
      makeItem('ls2', 'AI用户', 'AI_CHAT'),
    ]);
    channel.init();
    await channel.loadSessions();
    await nextTick();
    expect(channel.sessions.value).toHaveLength(2);
    expect(channel.waitingQueue.value).toHaveLength(1);
    expect(channel.aiQueue.value).toHaveLength(1);
  });
});
