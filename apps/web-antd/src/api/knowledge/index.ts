import { rawRequestClient } from '#/api/request';

// rawRequestClient baseURL 为空，路径直接命中 vite proxy /knowledge-api 规则
// 避免与 /api (auth) 代理冲突
const requestClient = rawRequestClient;

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
  // rawRequestClient 同样注入了 Authorization token（使用相同的 createRequestClient 工厂）
  // baseURL 为空，路径直接命中 /knowledge-api vite proxy，不被 /api (auth) 代理拦截
  return requestClient.post(
    '/knowledge-api/api/knowledge/docs/upload',
    formData,
    // 不手动设置 Content-Type，让浏览器自动携带 boundary 参数
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
