/**
 * useAuth — 手机号短信验证码身份验证
 *
 * 职责：
 *   - 管理验证 Modal 的显示状态与表单字段
 *   - 发送短信验证码 + 60 秒倒计时
 *   - 校验验证码并回调通知外部
 *   - 关闭/重置表单状态
 *
 * 不包含：会话、消息、WS 任何逻辑。
 */
import { ref } from 'vue';

import { sendSmsCodeApi, verifySmsCodeApi } from '#/api/session';

const COUNTDOWN_SECONDS = 60;

export function useAuth(
  /** 验证成功回调，参数为脱敏后的手机号标签 */
  onSuccess: (label: string) => void,
) {
  // ---- Modal 状态 ----
  const authVisible = ref(false);
  const authReason = ref('');

  // ---- 表单状态 ----
  const phone = ref('');
  const phoneErr = ref('');
  const codeVal = ref('');
  const codeErr = ref('');
  const codeSent = ref(false);
  const verifying = ref(false);
  const countdown = ref(0);

  const isAuth = ref(false);
  const authLabel = ref('访客模式');

  let cdTimer: null | ReturnType<typeof setInterval> = null;

  // ---- 显示 / 关闭 ----

  function showAuth(reason: string): void {
    authReason.value = reason;
    authVisible.value = true;
  }

  function closeAuth(): void {
    authVisible.value = false;
    // 重置所有表单状态，避免下次打开时残留上次的输入
    codeSent.value = false;
    phone.value = '';
    codeVal.value = '';
    phoneErr.value = '';
    codeErr.value = '';
    if (cdTimer !== null) {
      clearInterval(cdTimer);
      cdTimer = null;
    }
  }

  // ---- 发送验证码 ----

  function sendCode(): void {
    if (!/^1[3-9]\d{9}$/.test(phone.value)) {
      phoneErr.value = '请输入正确的手机号';
      return;
    }
    phoneErr.value = '';

    sendSmsCodeApi(phone.value)
      .then(() => {
        codeSent.value = true;
        codeVal.value = '';
        startCountdown();
      })
      .catch(() => {
        phoneErr.value = '发送验证码失败，请稍后重试';
      });
  }

  function startCountdown(): void {
    countdown.value = COUNTDOWN_SECONDS;
    if (cdTimer !== null) clearInterval(cdTimer);
    cdTimer = setInterval(() => {
      if (--countdown.value <= 0) {
        if (cdTimer !== null) clearInterval(cdTimer);
        cdTimer = null;
      }
    }, 1000);
  }

  // ---- 校验验证码 ----

  function verifyCode(): void {
    if (codeVal.value.length < 6) {
      codeErr.value = '请输入 6 位验证码';
      return;
    }
    codeErr.value = '';
    verifying.value = true;

    verifySmsCodeApi(phone.value, codeVal.value)
      .then(() => {
        verifying.value = false;
        authVisible.value = false;
        isAuth.value = true;
        // 脱敏展示：138****5678
        authLabel.value = `已登录 · ${phone.value.slice(0, 3)}****${phone.value.slice(-4)}`;
        onSuccess(authLabel.value);
      })
      .catch(() => {
        verifying.value = false;
        codeErr.value = '验证码错误，请重试';
        codeVal.value = '';
      });
  }

  // ---- 生命周期清理 ----

  function cleanup(): void {
    if (cdTimer !== null) {
      clearInterval(cdTimer);
      cdTimer = null;
    }
  }

  return {
    isAuth,
    authLabel,
    authVisible,
    authReason,
    phone,
    phoneErr,
    codeVal,
    codeErr,
    codeSent,
    verifying,
    countdown,
    showAuth,
    closeAuth,
    sendCode,
    verifyCode,
    cleanup,
  };
}
