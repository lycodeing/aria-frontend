import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';

/**
 * 获取当前登录用户信息（Vben UserInfo 格式）。
 * 对应后端 GET /api/v1/user/info → auth-service:8090
 */
export async function getUserInfoApi() {
  return requestClient.get<UserInfo>('/user/info');
}
