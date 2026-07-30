// src/api/tag/index.ts
import { conversationClient } from '#/api/request';

export interface TagVO {
  id: number | string;
  name: string;
  color: string;
  source: 'CUSTOM' | 'PRESET';
  usageCount?: number;
}

export interface TagReq {
  tagId?: number | string;
  tagName?: string;
}

// -------------------------------------------------------
// 标签字典（管理端）
// -------------------------------------------------------

/** 列出标签字典（可按来源筛选：PRESET / CUSTOM） */
export async function listTagsApi(params?: {
  source?: string;
}): Promise<TagVO[]> {
  return conversationClient.get('/admin/tags', { params });
}

/** 新建自定义标签 */
export async function createTagApi(data: {
  color: string;
  name: string;
  source?: 'CUSTOM' | 'PRESET';
}): Promise<TagVO> {
  return conversationClient.post('/admin/tags', data);
}

/** 更新标签信息 */
export async function updateTagApi(
  id: number | string,
  data: { color: string; name: string; source: string },
): Promise<void> {
  return conversationClient.put(`/admin/tags/${id}`, data);
}

/** 删除标签 */
export async function deleteTagApi(id: number | string): Promise<void> {
  return conversationClient.delete(`/admin/tags/${id}`);
}

// -------------------------------------------------------
// 访客标签（按会话）
// -------------------------------------------------------

/** 获取指定会话的访客标签列表 */
export async function listVisitorTagsApi(sessionId: string): Promise<TagVO[]> {
  return conversationClient.get(`/sessions/${sessionId}/visitor/tags`);
}

/** 为访客添加标签（按名称或 ID） */
export async function addVisitorTagApi(
  sessionId: string,
  data: TagReq,
): Promise<TagVO> {
  return conversationClient.post(`/sessions/${sessionId}/visitor/tags`, data);
}

/** 移除访客标签 */
export async function removeVisitorTagApi(
  sessionId: string,
  tagId: number | string,
): Promise<void> {
  return conversationClient.delete(
    `/sessions/${sessionId}/visitor/tags/${tagId}`,
  );
}

// -------------------------------------------------------
// 会话标签
// -------------------------------------------------------

/** 获取指定会话的会话标签列表 */
export async function listSessionTagsApi(sessionId: string): Promise<TagVO[]> {
  return conversationClient.get(`/sessions/${sessionId}/tags`);
}

/** 为会话添加标签（按名称或 ID） */
export async function addSessionTagApi(
  sessionId: string,
  data: TagReq,
): Promise<TagVO> {
  return conversationClient.post(`/sessions/${sessionId}/tags`, data);
}

/** 移除会话标签 */
export async function removeSessionTagApi(
  sessionId: string,
  tagId: number | string,
): Promise<void> {
  return conversationClient.delete(`/sessions/${sessionId}/tags/${tagId}`);
}
