// src/api/canned-response/index.ts
// 快捷回复（Canned Responses）接口层。
// 所有接口走 conversationClient（baseURL=/conversation/api/v1，自动注入座席 token）。
// 后端统一返回 R<T>，responseReturn:'data' 已解包到 data 字段。

import type {
  CannedGroupPayload,
  CannedMinePayload,
  CannedPublicPayload,
  CannedResponse,
  CannedResponseGroup,
  CannedResponseSearchVO,
} from './types';

import { conversationClient } from '#/api/request';

// =========================================================================
// 管理端（super_admin / kf_manager）：分组管理
// =========================================================================

/** 分组列表（树形扁平返回，按 sortOrder 升序） */
export async function listGroupsApi(): Promise<CannedResponseGroup[]> {
  return conversationClient.get('/admin/canned-response-groups');
}

/** 新建分组 */
export async function createGroupApi(
  payload: CannedGroupPayload,
): Promise<CannedResponseGroup> {
  return conversationClient.post('/admin/canned-response-groups', payload);
}

/** 编辑分组 */
export async function updateGroupApi(
  id: number,
  payload: CannedGroupPayload,
): Promise<void> {
  return conversationClient.put(`/admin/canned-response-groups/${id}`, payload);
}

/** 删除分组（有子分组或有效模板时后端抛错） */
export async function deleteGroupApi(id: number): Promise<void> {
  return conversationClient.delete(`/admin/canned-response-groups/${id}`);
}

// =========================================================================
// 管理端：公共快捷回复 CRUD
// =========================================================================

/** 公共快捷回复列表（按 groupId 过滤，分页） */
export async function listPublicApi(
  groupId?: null | number,
  page = 1,
  size = 50,
): Promise<CannedResponse[]> {
  return conversationClient.get('/admin/canned-responses', {
    params: { groupId: groupId ?? undefined, page, size },
  });
}

/** 新建公共快捷回复 */
export async function createPublicApi(
  payload: CannedPublicPayload,
): Promise<CannedResponse> {
  return conversationClient.post('/admin/canned-responses', payload);
}

/** 编辑公共快捷回复 */
export async function updatePublicApi(
  id: number,
  payload: CannedPublicPayload,
): Promise<void> {
  return conversationClient.put(`/admin/canned-responses/${id}`, payload);
}

/** 删除公共快捷回复（软删除） */
export async function deletePublicApi(id: number): Promise<void> {
  return conversationClient.delete(`/admin/canned-responses/${id}`);
}

// =========================================================================
// 坐席端：搜索 + 个人常用语 + 使用记录
// =========================================================================

/**
 * 搜索快捷回复。
 * q 为空时后端按 useCount 倒序返回热门；非空时走全文检索。
 * 同时返回本人 PRIVATE 模板（后端按 agentId 过滤）。
 */
export async function searchCannedApi(
  q?: string,
  groupId?: null | number,
  limit = 10,
): Promise<CannedResponseSearchVO[]> {
  return conversationClient.get('/canned-responses/search', {
    params: { q: q || undefined, group_id: groupId ?? undefined, limit },
  });
}

/** 当前坐席的个人快捷回复列表 */
export async function listMineApi(): Promise<CannedResponse[]> {
  return conversationClient.get('/canned-responses/mine');
}

/** 新建个人快捷回复 */
export async function createMineApi(
  payload: CannedMinePayload,
): Promise<CannedResponse> {
  return conversationClient.post('/canned-responses/mine', payload);
}

/** 编辑个人快捷回复（仅本人） */
export async function updateMineApi(
  id: number,
  payload: CannedMinePayload,
): Promise<void> {
  return conversationClient.put(`/canned-responses/mine/${id}`, payload);
}

/** 删除个人快捷回复（仅本人） */
export async function deleteMineApi(id: number): Promise<void> {
  return conversationClient.delete(`/canned-responses/mine/${id}`);
}

/** 使用上报：use_count +1（异步，不阻塞插入） */
export async function recordUseApi(id: number): Promise<void> {
  return conversationClient.post(`/canned-responses/${id}/use`);
}
