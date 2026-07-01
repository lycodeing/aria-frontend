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

/**
 * 上传文档（multipart/form-data）。
 *
 * 使用 vben 内置 {@link requestClient.upload}，内部会构造 FormData 并显式设置
 * Content-Type=multipart/form-data；axios 会自动补全 boundary。
 *
 * 历史 bug：直接 client.post(url, formData) 会被 axios 序列化为 JSON
 * `{"file":{"uid":"..."}, "kbId":"default"}`，文件流丢失，后端 500。
 */
export async function uploadDocApi(
  file: File,
  kbId: string,
): Promise<DocUploadResult> {
  return requestClient.upload('/knowledge-api/api/knowledge/docs/upload', {
    file,
    kbId,
  });
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

// -------------------------------------------------------
// Chunk 详情
// -------------------------------------------------------

export interface ChunkDetail {
  chunkId: string;
  pageNum: null | number;
  sectionTitle: null | string;
  chunkType: 'IMAGE_CAPTION' | 'TABLE' | 'TEXT';
  tokenCount: number;
  content: string;
  retrievalWeight: number;
}

/** 查询文档所有 chunk 解析详情 */
export async function getDocChunksApi(docId: string): Promise<ChunkDetail[]> {
  return requestClient.get(`/knowledge-api/api/knowledge/docs/${docId}/chunks`);
}

// -------------------------------------------------------
// P1 增强接口
// -------------------------------------------------------

export interface SearchHit {
  chunkId: string;
  docId: string;
  kbId: string;
  fileName: string;
  content: string;
  score: number;
  source: 'FULL_TEXT' | 'RERANK' | 'VECTOR';
  pageNum: null | number;
  sectionTitle: null | string;
  chunkType: 'IMAGE_CAPTION' | 'TABLE' | 'TEXT';
}

export interface DocStats {
  totalChunks: number;
  totalTokens: number;
  textChunks: number;
  tableChunks: number;
  imageChunks: number;
}

/** 检索测试（管理后台用） */
export async function searchKnowledgeApi(
  query: string,
  kbId: string,
  topK = 5,
): Promise<SearchHit[]> {
  return requestClient.post('/knowledge-api/api/knowledge/docs/search-test', {
    query,
    kbId,
    topK,
  });
}

/** 失败文档重试摄取 */
export async function retryDocApi(docId: string): Promise<void> {
  return requestClient.post(`/knowledge-api/api/knowledge/docs/${docId}/retry`);
}

/** 已发布文档重新摄取 */
export async function reingestDocApi(docId: string): Promise<void> {
  return requestClient.post(
    `/knowledge-api/api/knowledge/docs/${docId}/reingest`,
  );
}

/** 查询文档 chunk 统计 */
export async function getDocStatsApi(docId: string): Promise<DocStats> {
  return requestClient.get(`/knowledge-api/api/knowledge/docs/${docId}/stats`);
}

// -------------------------------------------------------
// P3 批量操作 + 知识库统计
// -------------------------------------------------------

export interface KbStats {
  kbId: string;
  docCount: number;
  chunkCount: number;
  tokenSum: number;
}

/** 批量下线文档 */
export async function batchOfflineApi(docIds: string[]): Promise<void> {
  return requestClient.post('/knowledge-api/api/knowledge/docs/batch-offline', {
    docIds,
  });
}

/** 查询知识库汇总统计 */
export async function getKbStatsApi(kbId: string): Promise<KbStats> {
  return requestClient.get('/knowledge-api/api/knowledge/docs/kb-stats', {
    params: { kbId },
  });
}

/** 翻译文本为中文 */
export async function translateApi(text: string): Promise<string> {
  return requestClient.post('/knowledge-api/api/knowledge/translate', { text });
}

/** 获取文档预览 URL（直接返回 URL 字符串，用于 iframe src） */
export function getDocPreviewUrl(docId: string): string {
  return `/knowledge-api/api/knowledge/docs/${docId}/preview`;
}

/** 获取文档原始文本内容（用于 Markdown 前端渲染） */
export async function getDocRawContentApi(docId: string): Promise<string> {
  const res = await fetch(`/knowledge-api/api/knowledge/docs/${docId}/preview`);
  return res.text();
}
