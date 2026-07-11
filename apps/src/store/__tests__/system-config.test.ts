// apps/src/store/__tests__/system-config.test.ts
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSystemConfigMapApi } from '#/api/system-config';

import { useSystemConfigStore } from '../system-config';

vi.mock('#/api/system-config', () => ({
  getSystemConfigMapApi: vi.fn(),
}));

describe('useSystemConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loadAll merges CUSTOMER_SERVICE and SYSTEM maps', async () => {
    vi.mocked(getSystemConfigMapApi)
      .mockResolvedValueOnce({
        'agent.maxConcurrent': 5,
        'agent.welcomeMessage': '您好',
      })
      .mockResolvedValueOnce({ 'dashboard.recentLimit': 10 });

    const store = useSystemConfigStore();
    await store.loadAll();

    expect(store.configMap['agent.maxConcurrent']).toBe(5);
    expect(store.configMap['agent.welcomeMessage']).toBe('您好');
    expect(store.configMap['dashboard.recentLimit']).toBe(10);
  });

  it('getConfig returns value when key exists', async () => {
    vi.mocked(getSystemConfigMapApi)
      .mockResolvedValueOnce({ 'knowledge.searchTopK': 5 })
      .mockResolvedValueOnce({});

    const store = useSystemConfigStore();
    await store.loadAll();

    expect(store.getConfig('knowledge.searchTopK', 3)).toBe(5);
  });

  it('getConfig returns fallback when key missing', () => {
    const store = useSystemConfigStore();
    expect(store.getConfig('nonexistent.key', 42)).toBe(42);
  });

  it('getConfig returns fallback when value is undefined', async () => {
    vi.mocked(getSystemConfigMapApi)
      .mockResolvedValueOnce({ 'some.key': undefined })
      .mockResolvedValueOnce({});

    const store = useSystemConfigStore();
    await store.loadAll();

    expect(store.getConfig('some.key', 99)).toBe(99);
  });

  it('loadAll silently handles API failure', async () => {
    vi.mocked(getSystemConfigMapApi).mockRejectedValue(
      new Error('network error'),
    );

    const store = useSystemConfigStore();
    await expect(store.loadAll()).resolves.not.toThrow();
    expect(store.configMap).toEqual({});
  });
});
