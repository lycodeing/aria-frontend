import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';

/**
 * 获取用户信息
 * 后端路径 /users/me，返回 displayName，映射为前端期望的 realName
 */
export async function getUserInfoApi(): Promise<UserInfo> {
  const result = await requestClient.get<any>('/users/me');
  return {
    ...result,
    realName: result?.displayName ?? result?.username ?? '',
    avatar: result?.avatar ?? '',
    homePath: result?.homePath ?? '/dashboard/analytics',
    roles: result?.roles ?? [],
  } as UserInfo;
}
