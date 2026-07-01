// src/api/ai-model/index.ts
import { requestClient } from '#/api/request';

export interface AiModelConfigItem {
  id: number;
  name: string;
  provider: string;
  apiProtocol: string;
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
  { value: 'CUSTOM', label: '自定义', defaultBaseUrl: '' },
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

export async function listAiModelsApi(pageNum = 1, pageSize = 20) {
  return requestClient.get<AiModelPageResult>('/admin/ai-models', {
    params: { pageNum, pageSize },
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
  return requestClient.patch<void>(`/admin/ai-models/${id}/default`);
}

export async function deleteAiModelApi(id: number) {
  return requestClient.delete<void>(`/admin/ai-models/${id}`);
}
