import type { UserInfo } from '@vben/types';

import { authClient } from '#/api/request';

/**
 * 获取当前登录用户信息（Vben UserInfo 格式）。
 * 对应后端 GET /api/v1/user/info → auth-service:8090
 *
 * 后端返回 UserVO（id / displayName / email / ...），此处映射为 Vben UserInfo 所需字段：
 *   id          → userId  (string)
 *   displayName → realName
 *   email       → desc（占位，无 desc 字段时降级）
 *   roles 由登录结果补充（UserVO 不含 roles）
 */
export async function getUserInfoApi(): Promise<UserInfo> {
  const raw = await authClient.get<Record<string, any>>('/user/info');
  return {
    userId: String(raw.id ?? raw.userId ?? ''),
    username: raw.username ?? '',
    realName: raw.displayName ?? raw.realName ?? raw.username ?? '',
    avatar: raw.avatar ?? '',
    desc: raw.email ?? raw.desc ?? '',
    // homePath 由登录时的角色决定（见 authStore.authLogin），这里保留后端可能返回的值
    homePath: raw.homePath ?? '',
    token: raw.token ?? '',
    // roles 由登录结果合并（UserVO 不含 roles），先置空，authLogin 会补充
    roles: (raw.roles as string[]) ?? [],
  } as UserInfo;
}
