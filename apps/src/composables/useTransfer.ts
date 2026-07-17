/**
 * useTransfer — 转接人工完整流程管理
 *
 * 职责：
 *   - 调用入队接口（POST /api/v1/chat/transfer）
 *   - 维护 localStorage 转接标志（页面关闭后重开可自动恢复）
 *   - onMounted 时检测 localStorage 标志并恢复 WS 连接
 *   - 用户标签检测（按对话内容推断业务分类）
 *
 * 不包含：WS 连接逻辑（通过回调委托给 useVisitorWs）。
 */
import { ref } from 'vue';

import { getSessionStateApi, transferToAgentApi } from '#/api/session';

// 转接标志 localStorage key（按 sessionId 隔离）
const TRANSFER_KEY = (sid: string) => `chat_transferred_${sid}`;

/** 按对话历史推断业务标签（用于座席侧分类展示） */
function detectTag(userTexts: string): string {
  if (/投诉|损坏|破损|质量|劣质/.test(userTexts)) return '投诉';
  if (/退款|退货|退钱|退费/.test(userTexts)) return '退款';
  if (/订单|快递|物流|发货|配送/.test(userTexts)) return '订单';
  if (/账单|发票|收据|账户/.test(userTexts)) return '账单';
  return '咨询';
}

export function useTransfer(
  sessionId: { value: string },
  /** 获取当前所有用户消息文本（用于 tag 检测） */
  getUserTexts: () => string,
  /** 转接成功后的回调（外部负责建立 WS 连接） */
  onTransferSuccess: () => void,
) {
  const transferred = ref(false);

  // ---- 主动转接 ----

  /**
   * 用户点击「转人工」或 AI 工具触发时调用。
   * 幂等：已处于转接状态时直接返回。
   *
   * @param reason 转接原因（AI 触发时由工具传入）
   * @throws 不抛出，内部处理异常并返回 false
   */
  async function requestTransfer(
    reason = '用户主动请求转人工',
  ): Promise<boolean> {
    if (transferred.value) return true;

    const sid = sessionId.value;
    const tag = detectTag(getUserTexts());

    try {
      await transferToAgentApi({
        sessionId: sid,
        tag,
        transferReason: reason,
        userName: '访客',
      });
      markTransferred(sid);
      onTransferSuccess();
      return true;
    } catch (error) {
      console.warn('[useTransfer] requestTransfer 失败', error);
      return false;
    }
  }

  // ---- 状态标志 ----

  function markTransferred(sid: string): void {
    transferred.value = true;
    localStorage.setItem(TRANSFER_KEY(sid), '1');
  }

  function clearTransferred(sid: string): void {
    transferred.value = false;
    localStorage.removeItem(TRANSFER_KEY(sid));
  }

  /**
   * onMounted 时调用：以后端 session 状态为准恢复转接。
   *
   * 关键设计：**必须先问后端拿到 status 再决定是否 ws.connect()**。
   * 早期实现有"快路径"（localStorage 有转接标志就先拉 WS，再异步查后端），
   * 但若座席已把会话 CLOSED，前端一连上，后端立刻关连接（非 1000 code），
   * 触发 handleWsClose 指数退避重连 → 握手 101 → 再被关 → 死循环，
   * 表现为"101 建了却一直在重连"。
   *
   * 三种后端状态的处理：
   *   - WAITING / ACTIVE：补写 localStorage，回调 onTransferSuccess 拉 WS
   *   - CLOSED：清 localStorage 转接标志，回调 onClosed 让上层置 sessionEnded
   *   - 网络错误：以本地 localStorage 标志兜底（best-effort，可能触发上述死循环，
   *     但无法访问后端时也别无选择；相比之下"能连不上"比"完全不连"损失更小）
   *
   * @param onAgentActive 可选回调：确认后端状态为 ACTIVE（座席已接入）时触发。
   * @param onClosed      可选回调：确认后端状态为 CLOSED（会话已结束）时触发，
   *                      上层应据此写 sessionEnded 并追加语义分隔条。
   * @returns 是否恢复了转接状态
   */
  async function restoreTransferState(
    sid: string,
    onAgentActive?: () => void,
    onClosed?: () => void,
  ): Promise<boolean> {
    const hasLocalFlag = localStorage.getItem(TRANSFER_KEY(sid)) === '1';

    // 主路径：以后端 session 状态为准
    try {
      const { status } = await getSessionStateApi(sid);
      if (status === 'WAITING' || status === 'ACTIVE') {
        markTransferred(sid);
        onTransferSuccess();
        if (status === 'ACTIVE') onAgentActive?.();
        return true;
      }
      if (status === 'CLOSED') {
        // 后端已关闭：清掉可能残留的转接标志，避免下次刷新又走死循环
        if (hasLocalFlag) clearTransferred(sid);
        onClosed?.();
      }
      return false;
    } catch {
      // 网络错误兜底：只有本地标志有效时才尝试连 WS
      if (hasLocalFlag) {
        transferred.value = true;
        onTransferSuccess();
        return true;
      }
      return false;
    }
  }

  return {
    transferred,
    requestTransfer,
    markTransferred,
    clearTransferred,
    restoreTransferState,
  };
}
