import type { ReplySuggestion } from '#/api/session';

import { onUnmounted, ref } from 'vue';

import { getReplySuggestionsApi } from '#/api/session';

/**
 * useReplySuggestions
 *
 * 管理 AI 回复建议面板：
 * - 访客发新消息后防抖 800ms 自动刷新
 * - 切换会话时立即刷新（delay=0）并通过 AbortController 取消上一次未完成的请求，防止过期响应覆盖（I-03）
 * - 手动点击「刷新」按钮立即重新请求
 * - 生命周期由 composable 内部通过 onUnmounted 自管理（I-02）
 */
export function useReplySuggestions() {
  const suggestions = ref<ReplySuggestion[]>([]);
  const loading = ref(false);
  const hasError = ref(false);

  let debounceTimer: null | ReturnType<typeof setTimeout> = null;
  // I-03：AbortController 用于取消上一次未完成的 HTTP 请求，防止过期响应覆盖当前会话建议
  let abortController: AbortController | null = null;

  async function fetchSuggestions(sessionId: string): Promise<void> {
    // 取消上一次未完成的请求
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    loading.value = true;
    hasError.value = false;
    try {
      const result = await getReplySuggestionsApi(sessionId, signal);
      // 请求已被取消时不更新状态，避免覆盖新会话的结果
      if (signal.aborted) return;
      suggestions.value = result;
    } catch (error: unknown) {
      if (signal.aborted) return; // 主动取消，不视为错误
      console.error('[useReplySuggestions] 获取建议失败:', error);
      hasError.value = true;
      suggestions.value = [];
    } finally {
      if (!signal.aborted) {
        loading.value = false;
      }
    }
  }

  /**
   * 防抖刷新：访客发消息后调用，避免每条消息都触发 LLM 请求
   * @param sessionId 当前会话 ID
   * @param delay     防抖延迟（ms），默认 800ms；切换会话时传 0
   */
  function refresh(sessionId: string, delay = 800): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (delay <= 0) {
      void fetchSuggestions(sessionId);
    } else {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void fetchSuggestions(sessionId);
      }, delay);
    }
  }

  /** 立即刷新（手动点击重新生成按钮） */
  function refreshNow(sessionId: string): void {
    refresh(sessionId, 0);
  }

  /** 清空建议并取消待执行的防抖定时器和未完成的请求（切换会话时调用） */
  function clear(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    abortController?.abort();
    abortController = null;
    suggestions.value = [];
    hasError.value = false;
    loading.value = false;
  }

  // I-02 修复：composable 自管理生命周期，无需调用方手动 dispose
  onUnmounted(() => {
    clear();
  });

  return {
    suggestions,
    loading,
    hasError,
    refresh,
    refreshNow,
    clear,
  };
}
