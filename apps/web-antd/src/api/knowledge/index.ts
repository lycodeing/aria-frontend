
import { requestClient } from '#/api/request';

// -------------------------------------------------------
// 类型定义
// -------------------------------------------------------

export interface DocListItem {
  docId: string;
  kbId: string;
  fileName: string;
  fileType: string;
  status: 'DEPRECATED' | 'DRAFT' | 'FAILED' | 'PUBLISHED' | 'REVIEW';
  version: null | string;
  uploaderId: string;
  reviewerId: null | string;
  createdAt: string;
  updatedAt: string;
}

export interface DocListResult {
  list: DocListItem[];
  total: number;
  page: number;
  size: number;
}

export interface DocStatusResult {
  docId: string;
  status: string;
  fileName: string;
  message?: string;
}

export interface DocUploadResult {
  docId: string;
  status: string;
  message: string;
}

export interface DocListParams {
  keyword?: string;
  kbId?: string;
  status?: string;
  page?: number;
  size?: number;
}

// -------------------------------------------------------
// API 函数
// -------------------------------------------------------

/** 分页查询文档列表 */
export async function listDocsApi(
  params: DocListParams = {},
): Promise<DocListResult> {
  return requestClient.get('/knowledge-api/api/knowledge/docs', { params });
}

/** 查询文档摄取进度 */
export async function getDocStatusApi(docId: string): Promise<DocStatusResult> {
  return requestClient.get(`/knowledge-api/api/knowledge/docs/${docId}/status`);
}

/** 上传文档（multipart/form-data） */
export async function uploadDocApi(
  file: File,
  kbId: string,
): Promise<DocUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('kbId', kbId);
  // 直接用 axios 发 multipart，requestClient 不含 token 注入时可能有问题
  return requestClient.post(
    '/knowledge-api/api/knowledge/docs/upload',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
}

/** 审核文档（通过或退回） */
export async function reviewDocApi(
  docId: string,
  approved: boolean,
  rejectReason?: string,
): Promise<void> {
  return requestClient.put(
    `/knowledge-api/api/knowledge/docs/${docId}/review`,
    {
      approved,
      rejectReason: rejectReason ?? '',
    },
  );
}

/** 下线文档 */
export async function offlineDocApi(docId: string): Promise<void> {
  return requestClient.delete(`/knowledge-api/api/knowledge/docs/${docId}`);
}
