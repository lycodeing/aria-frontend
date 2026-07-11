// src/api/system-config/index.ts
import { requestClient } from '#/api/request';

export interface SystemConfigVO {
  id: number;
  configKey: string;
  configValue: string;
  configType: string; // CUSTOMER_SERVICE | SYSTEM
  valueType: string; // NUMBER | STRING | BOOLEAN | JSON
  configName: string;
  configGroup: string;
  remark: null | string;
  isEnabled: boolean;
  isSystem: boolean;
}

export interface SystemConfigRequest {
  configKey: string;
  configValue: string;
  configType: string;
  valueType: string;
  configName: string;
  configGroup: string;
  remark?: string;
}

export interface SystemConfigListParams {
  configType: string;
  keyword?: string;
  page?: number;
  size?: number;
}

export interface PageResult<T> {
  total: number;
  page: number;
  size: number;
  items: T[];
}

export async function listSystemConfigsApi(
  params: SystemConfigListParams,
): Promise<PageResult<SystemConfigVO>> {
  return requestClient.get('/admin/system-config', { params });
}

export async function createSystemConfigApi(
  data: SystemConfigRequest,
): Promise<SystemConfigVO> {
  return requestClient.post('/admin/system-config', data);
}

export async function updateSystemConfigApi(
  id: number,
  data: Partial<
    Pick<
      SystemConfigRequest,
      'configGroup' | 'configName' | 'configValue' | 'remark'
    >
  >,
): Promise<void> {
  return requestClient.put(`/admin/system-config/${id}`, data);
}

export async function deleteSystemConfigApi(id: number): Promise<void> {
  return requestClient.delete(`/admin/system-config/${id}`);
}

export async function getSystemConfigMapApi(
  configType: string,
): Promise<Record<string, unknown>> {
  return requestClient.get('/admin/system-config/map', {
    params: { configType },
  });
}
