// src/api/ai-model/index.ts
import { requestClient } from '#/api/request';

export interface AiModelConfigItem {
  id: number;
  name: string;
  provider: string;
  apiProtocol: string;
  /** 模型类型：CHAT=对话大模型，EMBEDDING=向量模型 */
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
  records: AiModelConfigItem[];
  total: number;
  size: number;
  current: number;
}

export const MODEL_TYPES = [
  { value: 'CHAT',      label: '对话模型' },
  { value: 'EMBEDDING', label: '向量模型' },
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
 * @param modelType 可选，'CHAT' 或 'EMBEDDING'，不传则返回全部
 */
export async function listAiModelsApi(
  pageNum = 1,
  pageSize = 20,
  modelType?: string,
) {
  return requestClient.get<AiModelPageResult>('/admin/ai-models', {
    params: { pageNum, pageSize, ...(modelType ? { modelType } : {}) },
  });
}

export async function createAiModelApi(data: Partial<AiModelConfigItem>) {
  return requestClient.post<AiModelConfigItem>('/admin/ai-models', data);
}

export async function updateAiModelApi(
  id: number,
  data: Partial<AiModelConfigItem>,
) {
  return requestClient.put<void>(`/admin/ai-models/${id}`, data);
}

export async function setDefaultAiModelApi(id: number) {
  return requestClient.put<void>(`/admin/ai-models/${id}/default`);
}

export async function deleteAiModelApi(id: number) {
  return requestClient.delete<void>(`/admin/ai-models/${id}`);
}
