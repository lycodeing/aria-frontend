// src/api/sla/index.ts
import { conversationClient } from '#/api/request';

export interface SlaBreachActions {
  recordBreachOnly: boolean;
  sseAlert: boolean;
  autoEscalate: boolean;
  escalateToUserId?: string;
  webhookIds?: number[];
}

export interface SlaPolicyVO {
  id: number | string;
  name: string;
  isEnabled: boolean;
  priority: number;
  matchVisitorTags?: string[];
  matchTransferTags?: string[];
  timeMode: 'BUSINESS_HOURS' | 'CALENDAR';
  waitTimeTargetSec: number;
  frtTargetSec: number;
  handleTimeTargetSec: number;
  warningThresholdPct: number;
  actions: SlaBreachActions;
}

export interface SlaBreachVO {
  id: number | string;
  sessionId: string;
  policyId: number | string;
  breachType: 'FRT' | 'HANDLE' | 'WAIT';
  stage: 'BREACH' | 'WARNING';
  targetSec: number;
  actualSec: number;
  breachAt: string;
  alertedAt?: string;
  escalatedAt?: string;
}

export interface SlaBreachListParams {
  sessionId?: string;
  breachType?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

/** 列出所有 SLA 策略 */
export async function listSlaPoliciesApi(): Promise<SlaPolicyVO[]> {
  return conversationClient.get('/admin/sla/policies');
}

/** 新建 SLA 策略 */
export async function createSlaPolicyApi(
  data: Omit<SlaPolicyVO, 'id'>,
): Promise<SlaPolicyVO> {
  return conversationClient.post('/admin/sla/policies', data);
}

/** 更新 SLA 策略 */
export async function updateSlaPolicyApi(
  id: number | string,
  data: Omit<SlaPolicyVO, 'id'>,
): Promise<void> {
  return conversationClient.put(`/admin/sla/policies/${id}`, data);
}

/** 删除 SLA 策略 */
export async function deleteSlaPolicyApi(id: number | string): Promise<void> {
  return conversationClient.delete(`/admin/sla/policies/${id}`);
}

/** 列出 SLA 违规记录（支持按会话/类型/日期范围分页查询） */
export async function listSlaBreachesApi(
  params: SlaBreachListParams,
): Promise<SlaBreachVO[]> {
  return conversationClient.get('/admin/sla/breaches', { params });
}
