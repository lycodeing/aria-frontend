/**
 * useAuth — 手机号短信验证码身份验证
 *
 * 职责：
 *   - 管理验证 Modal 的显示状态与表单字段
 *   - 发送短信验证码 + 60 秒倒计时
 *   - 校验验证码并回调通知外部（携带 sessionId 让后端写入 session→phone 绑定）
 *   - 关闭/重置表单状态
 *   - 认证 token / 脱敏标签持久化到 localStorage（刷新页面不丢）
 *   - 提供 token 读取入口，供 SSE/WS 建立连接时携带
 *   - 提供 restoreAuthState：以服务端 /chat/auth/state 为权威恢复登录态
 *
 * 不包含：会话、消息、WS 任何逻辑。
 */
import { ref } from 'vue';

import {
  getVisitorAuthStateApi,
  sendSmsCodeApi,
  verifySmsCodeApi,
} from '#/api/session';

const COUNTDOWN_SECONDS = 60;

// ---- localStorage keys ----
const AUTH_TOKEN_KEY = 'chat_auth_token';
const AUTH_LABEL_KEY = 'chat_auth_label';

/** 读取持久化的访客 token（供 SSE/WS 挂载 Authorization 头） */
export function readVisitorToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) ?? '';
}

export function useAuth(
  /** 验证成功回调，参数为脱敏后的手机号标签 */
  onSuccess: (label: string) => void,
  /**
   * 当前会话 ID 的 getter。
   *   - verifyCode 时传给后端，写入 session→phone 绑定（TTL 2h）
   *   - restoreAuthState 时用于 GET /chat/auth/state 查询
   *
   * 传 getter 而非 ref/string：sessionId 可能在 startNewSession 时变更，
   * getter 保证每次调用都拿到最新值。
   */
  getSessionId?: () => string,
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

  // 认证态从 localStorage 恢复，避免刷新后回退到访客模式
  const savedLabel = localStorage.getItem(AUTH_LABEL_KEY);
  const savedToken = localStorage.getItem(AUTH_TOKEN_KEY);
  const isAuth = ref(Boolean(savedToken && savedLabel));
  const authLabel = ref(savedToken && savedLabel ? savedLabel : '访客模式');

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

    // 带上 sessionId 让后端写入 session→phone 绑定（TTL 2h），刷新后可恢复
    const sid = getSessionId?.() ?? '';
    verifySmsCodeApi(phone.value, codeVal.value, sid || undefined)
      .then((resp) => {
        verifying.value = false;
        authVisible.value = false;
        isAuth.value = true;
        // 脱敏展示：138****5678
        const label = `已登录 · ${phone.value.slice(0, 3)}****${phone.value.slice(-4)}`;
        authLabel.value = label;
        // 持久化：token 用于 SSE/WS 鉴权，label 用于 UI 恢复
        if (resp?.token) {
          localStorage.setItem(AUTH_TOKEN_KEY, resp.token);
        }
        localStorage.setItem(AUTH_LABEL_KEY, label);
        onSuccess(label);
      })
      .catch(() => {
        verifying.value = false;
        codeErr.value = '验证码错误，请重试';
        codeVal.value = '';
      });
  }

  /**
   * 服务端权威恢复：GET /chat/auth/state?sessionId=
   *
   * 使用场景：
   *   - 页面刷新 / 换设备打开：localStorage 可能缺 token/label，服务端仍有 2h TTL 绑定
   *   - 返回 authenticated=false：清除本地残留，回到访客模式
   *   - 返回 authenticated=true：用服务端 phoneMask 覆盖本地 label（防止篡改），
   *     若本地缺 token 也不影响识别（后端识别以 session 绑定为主）
   */
  async function restoreAuthState(): Promise<void> {
    const sid = getSessionId?.() ?? '';
    if (!sid) return;
    try {
      const state = await getVisitorAuthStateApi(sid);
      if (state.authenticated) {
        isAuth.value = true;
        if (state.phoneMask) {
          const label = `已登录 · ${state.phoneMask}`;
          authLabel.value = label;
          localStorage.setItem(AUTH_LABEL_KEY, label);
        }
        return;
      }
      // 服务端认为未认证：清除本地残留，UI 回到访客模式
      if (isAuth.value) {
        isAuth.value = false;
        authLabel.value = '访客模式';
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_LABEL_KEY);
      }
    } catch {
      // 网络错误：保持本地缓存态，不强制降级
    }
  }

  /**
   * 退出访客登录。
   * 清除本地 token 与标签，回到访客模式。SSE/WS 后续请求将不再携带 token。
   */
  function logout(): void {
    isAuth.value = false;
    authLabel.value = '访客模式';
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_LABEL_KEY);
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
    restoreAuthState,
    logout,
    cleanup,
  };
}
