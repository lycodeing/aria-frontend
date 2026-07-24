// src/api/business-hours/index.ts
import { conversationClient } from '#/api/request';

export interface TimeRange {
  start: string; // "09:00"
  end: string; // "18:00"
}

export interface ScheduleItem {
  dayOfWeek: number; // 1=Mon...7=Sun
  isOpen: boolean;
  timeRanges: TimeRange[];
  timezone: string;
}

export interface HolidayItem {
  id: number | string;
  date: string; // "2026-01-01"
  type: 'CLOSED' | 'CUSTOM' | 'WORKDAY';
  timeRanges?: TimeRange[];
  remark?: string;
  source: 'AUTO' | 'MANUAL';
}

/** 获取工作时间排班配置 */
export async function getScheduleApi(): Promise<ScheduleItem[]> {
  return conversationClient.get('/admin/business-hours/schedule');
}

/** 更新工作时间排班配置 */
export async function updateScheduleApi(data: ScheduleItem[]): Promise<void> {
  return conversationClient.put('/admin/business-hours/schedule', data);
}

/** 列出节假日（可按年份筛选） */
export async function listHolidaysApi(params?: {
  year?: number;
}): Promise<HolidayItem[]> {
  return conversationClient.get('/admin/business-hours/holidays', { params });
}

/** 新增节假日 */
export async function createHolidayApi(
  data: Omit<HolidayItem, 'id' | 'source'>,
): Promise<void> {
  return conversationClient.post('/admin/business-hours/holidays', data);
}

/** 更新节假日 */
export async function updateHolidayApi(
  id: number | string,
  data: Omit<HolidayItem, 'id' | 'source'>,
): Promise<void> {
  return conversationClient.put(`/admin/business-hours/holidays/${id}`, data);
}

/** 删除节假日 */
export async function deleteHolidayApi(id: number | string): Promise<void> {
  return conversationClient.delete(`/admin/business-hours/holidays/${id}`);
}

/** 同步指定年份的法定节假日，返回同步条数 */
export async function syncHolidaysApi(year?: number): Promise<number> {
  return conversationClient.post('/admin/business-hours/holidays/sync', null, {
    params: year === undefined ? undefined : { year },
  });
}

/** 获取非工作时间离线回复内容 */
export async function getOfflineReplyApi(): Promise<string> {
  return conversationClient.get('/admin/business-hours/offline-reply');
}

/** 更新非工作时间离线回复内容 */
export async function updateOfflineReplyApi(message: string): Promise<void> {
  return conversationClient.put('/admin/business-hours/offline-reply', {
    message,
  });
}

/** 查询当前是否处于工作时间及下次开放时间 */
export async function getBusinessHoursStatusApi(): Promise<{
  nextOpenTime: string;
  open: boolean;
}> {
  return conversationClient.get('/business-hours/status');
}
