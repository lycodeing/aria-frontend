// src/api/ai-model/index.ts
import { authClient } from '#/api/request';

export interface AiModelConfigItem {
  id: number;
  name: string;
  provider: string;
  apiProtocol: string;
  /** 模型类型：CHAT=对话大模型，EMBEDDING=向量模型，ROUTER=域路由小模型，RERANKER=精排模型，INTENT=BERT意图分类 */
  modelType: string;
  remark?: string;
  baseUrl: string;
  apiKeyEnc: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  timeoutSec: number;
  isDefault: boolean;
  isEnabled: boolean;
  createdAt?: string;
}

export interface AiModelPageResult {
  items: AiModelConfigItem[];
  total: number;
  size: number;
  page: number;
}

export const MODEL_TYPES = [
  { value: 'CHAT', label: '对话模型' },
  { value: 'EMBEDDING', label: '向量模型' },
  { value: 'ROUTER', label: '路由模型' },
  { value: 'RERANKER', label: '精排模型（Reranker）' },
  { value: 'INTENT', label: '意图分类模型（BERT）' },
];

export const PROVIDERS = [
  {
    value: 'CTYUN',
    label: '天翼云',
    defaultBaseUrl: 'https://wishub-x6.ctyun.cn/v1',
  },
  {
    value: 'OPENAI',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    value: 'ANTHROPIC',
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
  },
  {
    value: 'GEMINI',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
  },
  { value: 'CUSTOM', label: '自定义 / 本地部署', defaultBaseUrl: '' },
];

export const PROTOCOLS = [
  { value: 'OPENAI_COMPATIBLE', label: 'OpenAI 兼容（/v1/chat/completions）' },
  { value: 'ANTHROPIC', label: 'Anthropic（/v1/messages）' },
  { value: 'GEMINI', label: 'Google Gemini' },
];

export const PROVIDER_PROTOCOL_MAP: Record<string, string> = {
  CTYUN: 'OPENAI_COMPATIBLE',
  OPENAI: 'OPENAI_COMPATIBLE',
  ANTHROPIC: 'ANTHROPIC',
  GEMINI: 'GEMINI',
  CUSTOM: 'OPENAI_COMPATIBLE',
};

/**
 * 分页查询 AI 模型配置。
 * @param page      0-based 页码，默认 0
 * @param size      每页条数，默认 20
 * @param modelType 可选，'CHAT' / 'EMBEDDING' / 'ROUTER'，不传则返回全部
 */
export async function listAiModelsApi(page = 0, size = 20, modelType?: string) {
  return authClient.get<AiModelPageResult>('/admin/ai-models', {
    params: { page, size, ...(modelType ? { modelType } : {}) },
  });
}

export async function createAiModelApi(data: Partial<AiModelConfigItem>) {
  return authClient.post<AiModelConfigItem>('/admin/ai-models', data);
}

export async function updateAiModelApi(
  id: number,
  data: Partial<AiModelConfigItem>,
) {
  return authClient.put<undefined>(`/admin/ai-models/${id}`, data);
}

/**
 * 启用/禁用 AI 模型配置。
 * 使用独立的 PATCH 端点，避免触发 PUT 接口的完整字段校验。
 */
export async function toggleAiModelEnabledApi(id: number, enabled: boolean) {
  return authClient.patch<undefined>(`/admin/ai-models/${id}/enabled`, {
    enabled,
  });
}

export async function setDefaultAiModelApi(id: number) {
  return authClient.put<undefined>(`/admin/ai-models/${id}/default`);
}

export async function deleteAiModelApi(id: number) {
  return authClient.delete<undefined>(`/admin/ai-models/${id}`);
}

export interface AiModelTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
}

/**
 * 测试模型连通性。
 * CHAT：向 /v1/chat/completions 发送极简非流式请求，验证 API Key + 地址
 * EMBEDDING：向 /v1/embeddings 发送一条测试文本，验证向量服务可访问
 */
export async function testAiModelApi(id: number) {
  return authClient.post<AiModelTestResult>(`/admin/ai-models/${id}/test`);
}
