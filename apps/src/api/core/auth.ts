import { authBaseClient, authClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password?: string;
    username?: string;
    rememberMe?: boolean;
  }

  /** 登录接口返回值（前端使用 accessToken 字段） */
  export interface LoginResult {
    accessToken: string;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

/**
 * 登录。
 * 后端返回 tokenValue 字段，转换为前端期望的 accessToken。
 */
export async function loginApi(data: AuthApi.LoginParams) {
  const result = await authClient.post<{
    [key: string]: any;
    tokenValue: string;
  }>('/auth/login', data);
  // 后端字段 tokenValue → 前端字段 accessToken
  return { accessToken: result.tokenValue, ...result } as AuthApi.LoginResult &
    typeof result;
}

/**
 * 刷新 accessToken。
 */
export async function refreshTokenApi() {
  return authBaseClient.post<AuthApi.RefreshTokenResult>('/auth/refresh', {
    withCredentials: true,
  });
}

/**
 * 退出登录。
 */
export async function logoutApi() {
  return authBaseClient.post('/auth/logout', {
    withCredentials: true,
  });
}

/**
 * 获取用户按钮级权限码列表。
 * 对应后端 GET /api/v1/auth/codes
 */
export async function getAccessCodesApi() {
  return authClient.get<string[]>('/auth/codes');
}
