/**
 * 该文件可自行根据业务逻辑进行调整
 */
import type { RequestClientOptions } from '@vben/request';

import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  authenticateResponseInterceptor,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
} from '@vben/request';
import { useAccessStore } from '@vben/stores';

import { message } from 'ant-design-vue';

import { useAuthStore } from '#/store';

import { refreshTokenApi } from './core';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

function createRequestClient(baseURL: string, options?: RequestClientOptions) {
  const client = new RequestClient({
    ...options,
    baseURL,
  });

  /**
   * 重新认证逻辑
   */
  async function doReAuthenticate() {
    console.warn('Access token or refresh token is invalid or expired. ');
    const accessStore = useAccessStore();
    const authStore = useAuthStore();
    accessStore.setAccessToken(null);
    if (
      preferences.app.loginExpiredMode === 'modal' &&
      accessStore.isAccessChecked
    ) {
      accessStore.setLoginExpired(true);
    } else {
      await authStore.logout();
    }
  }

  /**
   * 刷新token逻辑
   */
  async function doRefreshToken() {
    const accessStore = useAccessStore();
    const resp = await refreshTokenApi();
    const newToken = resp.data;
    accessStore.setAccessToken(newToken);
    return newToken;
  }

  function formatToken(token: null | string) {
    return token ? `Bearer ${token}` : null;
  }

  // 请求头处理
  client.addRequestInterceptor({
    fulfilled: async (config) => {
      const accessStore = useAccessStore();

      config.headers.Authorization = formatToken(accessStore.accessToken);
      config.headers['Accept-Language'] = preferences.app.locale;
      return config;
    },
  });

  // 处理返回的响应数据格式
  // 后端统一返回 code:200 表示成功（非 Vben 默认的 code:0）
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 200,
    }),
  );

  // token过期的处理
  client.addResponseInterceptor(
    authenticateResponseInterceptor({
      client,
      doReAuthenticate,
      doRefreshToken,
      enableRefreshToken: preferences.app.enableRefreshToken,
      formatToken,
    }),
  );

  // 通用的错误处理,如果没有进入上面的错误处理逻辑，就会进入这里
  client.addResponseInterceptor(
    errorMessageResponseInterceptor((msg: string, error) => {
      const responseData = error?.response?.data ?? {};
      // 后端统一用 msg 字段返回错误信息（非 Vben 默认的 message/error 字段）
      const errorMessage =
        responseData?.msg ?? responseData?.message ?? responseData?.error ?? '';
      message.error(errorMessage || msg);
    }),
  );

  return client;
}

// =========================================================================
// 旧版 client（兼容保留，逐步迁移到下面的模块专用 client）
// =========================================================================
export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

export const baseRequestClient = new RequestClient({ baseURL: apiURL });

/**
 * rawRequestClient：baseURL 为空，路径直接命中 vite proxy 规则。
 * @deprecated 请使用模块专用 client（authClient / conversationClient / knowledgeClient）。
 */
export const rawRequestClient = createRequestClient('', {
  responseReturn: 'data',
});

/**
 * I-03：访客公开接口专用 client（无 token 注入）。
 * @deprecated 请使用 publicConversationClient。
 */
export const publicRequestClient = createRequestClient('', {
  responseReturn: 'data',
});

// =========================================================================
// 模块专用 client — 适配 nginx 模块前缀路由
// 规则：浏览器发 /auth/api/v1/xxx → nginx 去 /auth → auth-service
//      浏览器发 /conversation/api/v1/xxx → nginx 去 /conversation → conversation-service
//      浏览器发 /knowledge/api/xxx → nginx 去 /knowledge → knowledge-service
// =========================================================================

/** 认证服务 (auth-service:8083) — 登录/刷新/用户/菜单/AI模型/系统配置 */
export const authClient = createRequestClient('/auth/api/v1', {
  responseReturn: 'data',
});

/** 认证服务 — 无 token 刷新拦截器的 base client（用于 refreshToken/logout） */
export const authBaseClient = new RequestClient({ baseURL: '/auth/api/v1' });

/** 对话服务 (conversation-service:8082) — 会话/队列/Dashboard/DIT */
export const conversationClient = createRequestClient('/conversation/api/v1', {
  responseReturn: 'data',
});

/**
 * 访客公开接口 (conversation-service) — 无 token 注入。
 * 与 authClient 隔离，防止已登录座席的 token 泄露到访客请求。
 */
export const publicConversationClient = createRequestClient(
  '/conversation/api/v1',
  {
    responseReturn: 'data',
  },
);

/** 知识库服务 (knowledge-service:8081) — 文档/Chunk/翻译 */
export const knowledgeClient = createRequestClient('/knowledge', {
  responseReturn: 'data',
});
