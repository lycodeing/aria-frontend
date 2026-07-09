/**
 * useAgentWebSocket 订阅层测试
 *
 * 覆盖范围：
 *   - connectSession 向 channel 订阅并设置 statusMap
 *   - connectSession 幂等：重复调用不重复订阅
 *   - disconnectSession 注销订阅并设置 status=closed
 *   - sendMessage 委托给 channel.send
 *   - disconnectAll 注销所有订阅但不调用 channel.dispose
 */
import { ref } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock useAgentWsChannel ----

const mockChannel = {
  status: ref<'closed' | 'connecting' | 'error' | 'kicked' | 'open'>('open'),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  send: vi.fn().mockReturnValue(true),
  sendTyping: vi.fn(),
  init: vi.fn(),
  reconnect: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('../useAgentWsChannel', () => ({
  useAgentWsChannel: () => mockChannel,
}));

describe('useAgentWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChannel.status.value = 'open';
  });

  it('connectSession 向 channel 订阅并设置 statusMap=open（channel 已连接）', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const onUserMessage = vi.fn();
    const { connectSession, statusMap } = useAgentWebSocket({ onUserMessage });

    connectSession('sid-A');

    expect(mockChannel.subscribe).toHaveBeenCalledWith(
      'sid-A',
      expect.any(Object),
    );
    expect(statusMap['sid-A']).toBe('open');
  });

  it('connectSession statusMap=connecting 当 channel 未连接时', async () => {
    mockChannel.status.value = 'connecting';
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession, statusMap } = useAgentWebSocket({
      onUserMessage: vi.fn(),
    });

    connectSession('sid-A');

    expect(statusMap['sid-A']).toBe('connecting');
  });

  it('connectSession 幂等：重复调用不重复订阅', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession } = useAgentWebSocket({ onUserMessage: vi.fn() });

    connectSession('sid-A');
    connectSession('sid-A');

    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('disconnectSession 注销订阅并设置 status=closed', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const onStatusChange = vi.fn();
    const { connectSession, disconnectSession, getStatus } = useAgentWebSocket({
      onUserMessage: vi.fn(),
      onStatusChange,
    });

    connectSession('sid-A');
    disconnectSession('sid-A');

    expect(mockChannel.unsubscribe).toHaveBeenCalledWith('sid-A');
    expect(getStatus('sid-A')).toBe('closed');
    expect(onStatusChange).toHaveBeenCalledWith('sid-A', 'closed');
  });

  it('sendMessage 委托给 channel.send 并返回结果', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession, sendMessage } = useAgentWebSocket({
      onUserMessage: vi.fn(),
    });

    connectSession('sid-A');
    const result = sendMessage('sid-A', 'test msg');

    expect(mockChannel.send).toHaveBeenCalledWith('sid-A', 'test msg');
    expect(result).toBe(true);
  });

  it('disconnectAll 注销所有订阅，不调用 channel.dispose', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const { connectSession, disconnectAll } = useAgentWebSocket({
      onUserMessage: vi.fn(),
    });

    connectSession('sid-A');
    connectSession('sid-B');
    disconnectAll();

    expect(mockChannel.unsubscribe).toHaveBeenCalledWith('sid-A');
    expect(mockChannel.unsubscribe).toHaveBeenCalledWith('sid-B');
    expect(mockChannel.dispose).not.toHaveBeenCalled();
  });

  it('channel onMessage 回调：MESSAGE+user 触发 onUserMessage', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const onUserMessage = vi.fn();
    const { connectSession } = useAgentWebSocket({ onUserMessage });

    connectSession('sid-A');

    // 获取注册到 channel.subscribe 的 callbacks 对象
    const callbacks = mockChannel.subscribe.mock.calls[0]?.[1] as {
      onMessage: (msg: unknown) => void;
    };
    callbacks.onMessage({
      type: 'MESSAGE',
      sessionId: 'sid-A',
      role: 'user',
      content: 'hello',
    });

    expect(onUserMessage).toHaveBeenCalledWith(
      'sid-A',
      expect.objectContaining({ content: 'hello', role: 'user' }),
    );
  });

  it('channel onMessage 回调：非 user 消息不触发 onUserMessage', async () => {
    const { useAgentWebSocket } = await import('../useAgentWebSocket');
    const onUserMessage = vi.fn();
    const { connectSession } = useAgentWebSocket({ onUserMessage });

    connectSession('sid-A');

    const callbacks = mockChannel.subscribe.mock.calls[0]?.[1] as {
      onMessage: (msg: unknown) => void;
    };
    // AGENT_JOINED 不应触发 onUserMessage
    callbacks.onMessage({ type: 'AGENT_JOINED', sessionId: 'sid-A' });

    expect(onUserMessage).not.toHaveBeenCalled();
  });
});
