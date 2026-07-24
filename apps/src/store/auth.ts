import type { Recordable, UserInfo } from '@vben/types';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { notification } from 'ant-design-vue';
import { defineStore } from 'pinia';

import { getAccessCodesApi, getUserInfoApi, loginApi, logoutApi } from '#/api';
import { $t } from '#/locales';

/**
 * 根据角色列表推断首页路径。
 * kf_staff（普通客服）应进入座席工作台，其他角色进入管理后台首页。
 */
function resolveHomePath(roles: string[]): string {
  if (
    roles.includes('kf_staff') &&
    !roles.includes('super_admin') &&
    !roles.includes('kf_manager')
  ) {
    return '/customerservice/chat';
  }
  return preferences.app.defaultHomePath;
}

export const useAuthStore = defineStore('auth', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);

  /**
   * 异步处理登录操作
   * Asynchronously handle the login process
   * @param params 登录表单数据
   */
  async function authLogin(
    params: Recordable<any>,
    onSuccess?: () => Promise<void> | void,
    customLoginFn?: (
      p: Recordable<any>,
    ) => Promise<Record<string, any> & { accessToken: string }>,
  ) {
    let userInfo: null | UserInfo = null;
    try {
      loginLoading.value = true;

      // 获取完整登录结果（含 roles、mustChangePassword 等字段）
      // customLoginFn 允许短信验证码等登录方式复用同一套登录后处理逻辑
      const loginResult = await (customLoginFn ?? loginApi)(params);
      const { accessToken } = loginResult;

      if (accessToken) {
        accessStore.setAccessToken(accessToken);

        // 并行获取用户信息和权限码
        const [fetchUserInfoResult, accessCodes] = await Promise.all([
          fetchUserInfo(),
          getAccessCodesApi(),
        ]);

        userInfo = fetchUserInfoResult;

        // UserVO 不含 roles，从登录结果合并；若 /user/info 已返回 roles 则优先使用
        const rolesFromLogin: string[] = (loginResult as any).roles ?? [];
        if (!userInfo.roles || userInfo.roles.length === 0) {
          userInfo = { ...userInfo, roles: rolesFromLogin };
        }

        // 根据角色推断首页，覆盖 userInfo.homePath（后端暂未返回 homePath）
        if (!userInfo.homePath) {
          userInfo = {
            ...userInfo,
            homePath: resolveHomePath(userInfo.roles ?? []),
          };
        }

        userStore.setUserInfo(userInfo);
        // 非阻塞预加载系统配置，失败不影响登录流程
        // Dynamic import avoids a circular dependency: auth store → system-config store → api
        const { useSystemConfigStore } = await import('#/store/system-config');
        useSystemConfigStore()
          .loadAll()
          .catch(() => {});
        accessStore.setAccessCodes(accessCodes);

        // BUG-009: 首次登录强制改密检测
        const mustChangePassword = (loginResult as any).mustChangePassword;
        if (mustChangePassword) {
          await router.push('/profile/change-password');
          return { userInfo };
        }

        if (accessStore.loginExpired) {
          accessStore.setLoginExpired(false);
        } else {
          onSuccess
            ? await onSuccess?.()
            : await router.push(
                userInfo.homePath || preferences.app.defaultHomePath,
              );
        }

        if (userInfo?.realName) {
          notification.success({
            description: `${$t('authentication.loginSuccessDesc')}:${userInfo?.realName}`,
            duration: 3,
            message: $t('authentication.loginSuccess'),
          });
        }
      }
    } catch {
      // 登录失败错误已由请求拦截器统一处理并展示 toast，此处仅防止未捕获异常传播
    } finally {
      loginLoading.value = false;
    }

    return {
      userInfo,
    };
  }

  async function logout(redirect: boolean = true) {
    try {
      await logoutApi();
    } catch {
      // 不做任何处理
    }
    resetAllStores();
    accessStore.setLoginExpired(false);

    // 回登录页带上当前路由地址
    await router.replace({
      path: LOGIN_PATH,
      query: redirect
        ? {
            redirect: encodeURIComponent(router.currentRoute.value.fullPath),
          }
        : {},
    });
  }

  async function fetchUserInfo() {
    const userInfo = await getUserInfoApi();
    userStore.setUserInfo(userInfo);
    return userInfo;
  }

  function $reset() {
    loginLoading.value = false;
  }

  return {
    $reset,
    authLogin,
    fetchUserInfo,
    loginLoading,
    logout,
  };
});
