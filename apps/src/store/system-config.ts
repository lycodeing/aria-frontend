// apps/src/store/system-config.ts
import { ref } from 'vue';

import { defineStore } from 'pinia';

import { getSystemConfigMapApi } from '#/api/system-config';

export const useSystemConfigStore = defineStore('systemConfig', () => {
  const configMap = ref<Record<string, unknown>>({});

  async function loadAll(): Promise<void> {
    const [csResult, sysResult] = await Promise.allSettled([
      getSystemConfigMapApi('CUSTOMER_SERVICE'),
      getSystemConfigMapApi('SYSTEM'),
    ]);
    configMap.value = {
      ...(csResult.status === 'fulfilled' ? csResult.value : {}),
      ...(sysResult.status === 'fulfilled' ? sysResult.value : {}),
    };
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
