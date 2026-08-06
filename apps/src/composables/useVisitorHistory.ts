import type { SseConnectionHandle, VisitorHistorySession } from '#/api/session';

import { onUnmounted, ref } from 'vue';

import { doReAuthenticate } from '#/api/request';
import {
  createAiSummaryEventSource,
  getAiSummaryApi,
  getVisitorSessionHistoryApi,
} from '#/api/session';

export interface SummaryState {
  done: boolean;
  streaming: boolean;
  text: string;
}

/**
 * useVisitorHistory
 *
 * 管理访客历史工单抽屉：
 * - 按访客姓名（排除当前会话）加载已结束工单列表
 * - 每条工单支持流式生成 AI 总结（首次生成后缓存，不重复请求）
 * - 生命周期由 composable 内部通过 onUnmounted 自管理
 */
export function useVisitorHistory() {
  const historyList = ref<VisitorHistorySession[]>([]);
  const loading = ref(false);
  const drawerVisible = ref(false);

  /**
   * summaryMap：key=sessionId，value=该工单的 AI 总结状态
   * 用 ref 包裹保证模板响应式更新
   */
  const summaryMap = ref<Record<string, SummaryState>>({});

  /** 活跃的 SSE 连接句柄（同时最多一条，避免并发流） */
  let activeEs: null | SseConnectionHandle = null;

  async function loadHistory(
    visitorName: string,
    excludeSessionId: string,
  ): Promise<void> {
    loading.value = true;
    try {
      const list = await getVisitorSessionHistoryApi(
        visitorName,
        excludeSessionId,
      );
      historyList.value = list;

      // 把后端已缓存的 AI 总结预填到 summaryMap，避免重复请求
      for (const item of list) {
        if (item.aiSummary) {
          summaryMap.value[item.sessionId] = {
            text: item.aiSummary,
            streaming: false,
            done: true,
          };
        }
      }
    } catch (error) {
      console.error('[useVisitorHistory] loadHistory 失败:', error);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 打开抽屉并加载历史工单
   */
  function openDrawer(visitorName: string, excludeSessionId: string): void {
    drawerVisible.value = true;
    void loadHistory(visitorName, excludeSessionId);
  }

  /**
   * 仅静默预加载列表（不打开抽屉），供切换会话时提前拿到 historyList.length
   */
  function preload(visitorName: string, excludeSessionId: string): void {
    void loadHistory(visitorName, excludeSessionId);
  }

  /**
   * 流式生成某条工单的 AI 总结
   * - 已 done 或 streaming 中均跳过，防止重复触发（I-01）
   * - 先查服务端缓存，有则直接填充
   * - 无缓存则建立 SSE 流（token 由 createAiSummaryEventSource 内部处理，I-05）
   */
  async function generateSummary(sessionId: string): Promise<void> {
    const existing = summaryMap.value[sessionId];
    // I-01 修复：streaming 进行中时同样跳过，防止双击导致流被中断后重启
    if (existing?.done || existing?.streaming) return;

    // 先检查服务端缓存
    try {
      const { summary } = await getAiSummaryApi(sessionId);
      if (summary) {
        summaryMap.value[sessionId] = {
          text: summary,
          streaming: false,
          done: true,
        };
        return;
      }
    } catch {
      // 缓存查询失败时继续走流式
    }

    // 关闭上一条未完成的流
    activeEs?.close();
    activeEs = null;

    summaryMap.value[sessionId] = { text: '', streaming: true, done: false };

    // I-05 修复：token 由 createAiSummaryEventSource 内部读取，composable 不再直接依赖 accessStore
    const es = createAiSummaryEventSource(
      sessionId,
      (data) => {
        if (data === '[DONE]') {
          const state = summaryMap.value[sessionId];
          if (state) {
            state.streaming = false;
            state.done = true;
          }
          es.close();
          activeEs = null;
          return;
        }
        try {
          const chunk = JSON.parse(data) as { delta: string };
          const state = summaryMap.value[sessionId];
          if (state) {
            state.text += chunk.delta;
          }
        } catch {
          // 忽略非 JSON 心跳帧
        }
      },
      () => {
        const state = summaryMap.value[sessionId];
        if (state) {
          state.streaming = false;
        }
        es.close();
        activeEs = null;
      },
      () => {
        // 握手 401：token 过期，停止流式并退出登录
        const state = summaryMap.value[sessionId];
        if (state) {
          state.streaming = false;
        }
        es.close();
        activeEs = null;
        void doReAuthenticate();
      },
    );
    activeEs = es;
  }

  /** 重新生成（强制清除缓存态，重走流式） */
  function regenerateSummary(sessionId: string): void {
    if (summaryMap.value[sessionId]) {
      summaryMap.value[sessionId] = { text: '', streaming: false, done: false };
    }
    void generateSummary(sessionId);
  }

  // I-02 修复：composable 自管理生命周期，无需调用方手动 dispose
  onUnmounted(() => {
    activeEs?.close();
    activeEs = null;
  });

  return {
    historyList,
    loading,
    drawerVisible,
    summaryMap,
    openDrawer,
    preload,
    generateSummary,
    regenerateSummary,
  };
}
