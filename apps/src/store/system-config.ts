// apps/src/store/system-config.ts
import { ref } from 'vue';

import { defineStore } from 'pinia';

import { getSystemConfigMapApi } from '#/api/system-config';

export const useSystemConfigStore = defineStore('systemConfig', () => {
  const configMap = ref<Record<string, unknown>>({});

  async function loadAll(): Promise<void> {
    try {
      const [csMap, sysMap] = await Promise.all([
        getSystemConfigMapApi('CUSTOMER_SERVICE'),
        getSystemConfigMapApi('SYSTEM'),
      ]);
      configMap.value = { ...csMap, ...sysMap };
    } catch (error) {
      console.error('[useSystemConfigStore] loadAll 失败:', error);
      // 失败时保留空 map；消费方通过 getConfig fallback 保证行为不变
    }
  }

  function getConfig<T>(key: string, fallback: T): T {
    const val = configMap.value[key];
    return val !== undefined && val !== null ? (val as T) : fallback;
  }

  function $reset() {
    configMap.value = {};
  }

  return { $reset, configMap, getConfig, loadAll };
});
