import { requestClient } from '#/api/request';

// ---- 领域 ----
export interface DomainDTO {
  id?: number;
  code: string;
  name: string;
  description?: string;
  systemPromptAddon?: string;
  enabled?: boolean;
}
export const listDomainsApi = () =>
  requestClient.get<DomainDTO[]>('/admin/dit/domains');
export const createDomainApi = (data: Omit<DomainDTO, 'id'>) =>
  requestClient.post<DomainDTO>('/admin/dit/domains', data);
export const updateDomainApi = (id: number, data: Omit<DomainDTO, 'id'>) =>
  requestClient.put<DomainDTO>(`/admin/dit/domains/${id}`, data);
export const deleteDomainApi = (id: number) =>
  requestClient.delete(`/admin/dit/domains/${id}`);

// ---- 意图 ----
export interface IntentDTO {
  id?: number;
  domainId: number;
  code: string;
  name: string;
  description: string;
  exampleQueries?: string;
  autoTransfer?: boolean;
  skipRag?: boolean;
  fallbackReply?: string;
  sortOrder?: number;
  enabled?: boolean;
}
export const listIntentsApi = (domainId: number) =>
  requestClient.get<IntentDTO[]>('/admin/dit/intents', {
    params: { domainId },
  });
export const createIntentApi = (data: Omit<IntentDTO, 'id'>) =>
  requestClient.post<IntentDTO>('/admin/dit/intents', data);
export const updateIntentApi = (id: number, data: Omit<IntentDTO, 'id'>) =>
  requestClient.put<IntentDTO>(`/admin/dit/intents/${id}`, data);
export const deleteIntentApi = (id: number) =>
  requestClient.delete(`/admin/dit/intents/${id}`);

// ---- 槽位 ----
export interface SlotDTO {
  id?: number;
  intentId: number;
  slotName: string;
  slotType?: string;
  description: string;
  required?: boolean;
  resolveStrategy?: string;
  sessionKey?: string;
  discoverToolCode?: string;
  discoverFixedParams?: string;
  askUserPrompt?: string;
  sortOrder?: number;
}
export const listSlotsApi = (intentId: number) =>
  requestClient.get<SlotDTO[]>('/admin/dit/slots', { params: { intentId } });
export const createSlotApi = (data: Omit<SlotDTO, 'id'>) =>
  requestClient.post<SlotDTO>('/admin/dit/slots', data);
export const updateSlotApi = (id: number, data: Omit<SlotDTO, 'id'>) =>
  requestClient.put<SlotDTO>(`/admin/dit/slots/${id}`, data);
export const deleteSlotApi = (id: number) =>
  requestClient.delete(`/admin/dit/slots/${id}`);

// ---- 工具 ----
export interface ToolDTO {
  id?: number;
  code: string;
  name: string;
  description: string;
  toolType?: string;
  httpMethod?: string;
  urlTemplate?: string;
  headersTemplate?: string;
  bodyTemplate?: string;
  paramSchema?: string;
  responseJsonpath?: string;
  authType?: string;
  authConfig?: string;
  timeoutMs?: number;
  isDiscoverTool?: boolean;
  enabled?: boolean;
}
export const listToolsApi = () =>
  requestClient.get<ToolDTO[]>('/admin/dit/tools');
export const createToolApi = (data: Omit<ToolDTO, 'id'>) =>
  requestClient.post<ToolDTO>('/admin/dit/tools', data);
export const updateToolApi = (id: number, data: Omit<ToolDTO, 'id'>) =>
  requestClient.put<ToolDTO>(`/admin/dit/tools/${id}`, data);
export const deleteToolApi = (id: number) =>
  requestClient.delete(`/admin/dit/tools/${id}`);

// ---- 意图-工具绑定 ----
export interface BindingDTO {
  id?: number;
  intentId: number;
  toolId: number;
  executionMode?: string;
  executionOrder?: number;
  paramMappings?: string;
}
export const listBindingsApi = (intentId: number) =>
  requestClient.get<BindingDTO[]>('/admin/dit/bindings', {
    params: { intentId },
  });
export const createBindingApi = (data: Omit<BindingDTO, 'id'>) =>
  requestClient.post<BindingDTO>('/admin/dit/bindings', data);
export const deleteBindingApi = (id: number) =>
  requestClient.delete(`/admin/dit/bindings/${id}`);
