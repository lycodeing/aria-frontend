// src/api/system-config/index.ts
import { authClient } from '#/api/request';

export interface SystemConfigVO {
  id: number | string; // 后端以 bigint 字符串返回
  configKey: string;
  configValue: string;
  configType: string; // CUSTOMER_SERVICE | SYSTEM
  description: string; // 配置说明（后端字段名）
  isEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SystemConfigRequest {
  configKey: string;
  configValue: string;
  configType: string;
  description?: string;
}

export interface SystemConfigListParams {
  configType: string;
  keyword?: string;
  page?: number;
  size?: number;
}

export interface PageResult<T> {
  total: number | string; // 后端返回字符串，消费方用 Number() 转换
  page: number;
  size: number;
  items: T[];
}

export async function listSystemConfigsApi(
  params: SystemConfigListParams,
): Promise<PageResult<SystemConfigVO>> {
  return authClient.get('/admin/system-config', { params });
}

export async function createSystemConfigApi(
  data: SystemConfigRequest,
): Promise<SystemConfigVO> {
  return authClient.post('/admin/system-config', data);
}

export async function updateSystemConfigApi(
  id: number | string,
  data: Pick<SystemConfigRequest, 'configValue'> & { description?: string },
): Promise<void> {
  return authClient.put(`/admin/system-config/${id}`, data);
}

export async function deleteSystemConfigApi(
  id: number | string,
): Promise<void> {
  return authClient.delete(`/admin/system-config/${id}`);
}

export async function getSystemConfigMapApi(
  configType: string,
): Promise<Record<string, unknown>> {
  return authClient.get('/admin/system-config/map', {
    params: { configType },
  });
}
