// apps/src/views/customerservice/agent/types.ts
// 座席工作台共享类型定义，供 index.vue 及各子组件使用

import type { ChatToolCall } from '#/api/session';

export interface Msg {
  id: number;
  role: 'agent' | 'ai' | 'system' | 'tool' | 'user';
  text: string;
  time?: string;
  /** 原始毫秒时间戳，用于左栏列表项按"今天 HH:MM / 昨天 / MM-DD"智能格式化 */
  ts?: number;
  /** 仅 role='tool' 填充：被调用的工具名 */
  toolName?: string;
  /** 仅 role='tool' 填充：对应 AI 请求里的 toolCalls[].id */
  toolRequestId?: string;
  /** 仅 role='ai' 填充：本轮触发的工具调用列表 */
  toolCalls?: ChatToolCall[];
}

export interface SessionData {
  id: string;
  name: string;
  nameChar: string;
  color: string;
  min: string;
  active: boolean;
  sessionCode: string;
  transferReason: string;
  /** 问题标签（来自转人工请求） */
  tag: string;
  /** 入队时间戳（epoch 秒） */
  waitSince: number;
  msgs: Msg[];
  /** 非当前会话时收到的未读消息数，切换到该会话时归零 */
  unread: number;
}

export interface ClosedSessionItem {
  id: string;
  name: string;
  nameChar: string;
  endedAt: string;
  transferReason: string;
  tag: string;
}

export interface ClosedView {
  /** 只读预览来源：closed=已结束会话，ai=AI 对话阶段旁观预览 */
  kind?: 'ai' | 'closed';
  msgs: Msg[];
  session: ClosedSessionItem;
}
