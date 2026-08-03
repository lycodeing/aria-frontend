// src/api/webhook/index.ts
import { conversationClient } from '#/api/request';

export interface WebhookVO {
  id: number | string;
  name: string;
  type: 'CUSTOM' | 'DINGTALK' | 'FEISHU' | 'WECOM';
  url: string;
  secret?: string;
  customHeaders?: Record<string, string>;
  messageTemplate?: string;
  isEnabled: number; // 1=启用, 0=禁用
  scopes: string[]; // 订阅的事件范围（WebhookScope 枚举名）
}

/** 列出所有 Webhook 配置 */
export async function listWebhooksApi(): Promise<WebhookVO[]> {
  return conversationClient.get('/admin/sla/webhooks');
}

/** 新建 Webhook */
export async function createWebhookApi(
  data: Omit<WebhookVO, 'id'>,
): Promise<WebhookVO> {
  return conversationClient.post('/admin/sla/webhooks', data);
}

/** 更新 Webhook 配置 */
export async function updateWebhookApi(
  id: number | string,
  data: Omit<WebhookVO, 'id'>,
): Promise<void> {
  return conversationClient.put(`/admin/sla/webhooks/${id}`, data);
}

/** 删除 Webhook */
export async function deleteWebhookApi(id: number | string): Promise<void> {
  return conversationClient.delete(`/admin/sla/webhooks/${id}`);
}

/** 测试 Webhook 连通性（发送一条测试消息） */
export async function testWebhookApi(id: number | string): Promise<void> {
  return conversationClient.post(`/admin/sla/webhooks/${id}/test`);
}
