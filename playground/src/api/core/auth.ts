import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password?: string;
    rememberMe?: boolean;
    username?: string;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

/**
 * 登录
 * 后端返回 tokenValue，映射为前端 accessStore 期望的 accessToken
 */
export async function loginApi(data: AuthApi.LoginParams) {
  const result = await requestClient.post<any>('/auth/login', data, {
    withCredentials: true,
  });
  return {
    ...result,
    accessToken: result?.tokenValue ?? result?.accessToken ?? '',
  };
}

/**
 * 刷新 accessToken
 */
export async function refreshTokenApi() {
  return baseRequestClient.post<AuthApi.RefreshTokenResult>(
    '/auth/refresh',
    null,
    {
      withCredentials: true,
    },
  );
}

/**
 * 退出登录
 */
export async function logoutApi() {
  return baseRequestClient.post('/auth/logout', null, {
    withCredentials: true,
  });
}

/**
 * 获取用户权限码
 * 权限由角色控制，此处返回空数组
 */
export async function getAccessCodesApi() {
  return [] as string[];
}
