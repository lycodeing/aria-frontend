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
   * onMounted 时调用：两重兜底检测转接状态。
   *
   * 第一重：localStorage 有转接标志 → 直接恢复（快路径，无网络请求）
   * 第二重：localStorage 无标志 → 查询后端 session 状态（兜底 AI 工具触发转接后页面关闭的场景）
   *         若后端返回 WAITING/ACTIVE，补写 localStorage 并恢复 WS 连接
   *
   * @returns 是否恢复了转接状态
   */
  async function restoreTransferState(sid: string): Promise<boolean> {
    // 快路径：localStorage 已有标志，无需请求后端
    if (localStorage.getItem(TRANSFER_KEY(sid)) === '1') {
      transferred.value = true;
      onTransferSuccess();
      return true;
    }

    // 兜底路径：查询后端 session 状态
    try {
      const { status } = await getSessionStateApi(sid);
      if (status === 'WAITING' || status === 'ACTIVE') {
        // 补写 localStorage，下次刷新走快路径
        markTransferred(sid);
        onTransferSuccess();
        return true;
      }
    } catch {
      // 网络错误静默忽略，不影响正常 AI 对话
    }

    return false;
  }

  return {
    transferred,
    requestTransfer,
    markTransferred,
    clearTransferred,
    restoreTransferState,
  };
}
