import type { RouteRecordStringComponent } from '@vben/types';

import { requestClient } from '#/api/request';

/**
 * 获取当前用户可见菜单（动态路由）。
 * 对应后端 GET /api/v1/menus/me → auth-service:8090
 */
export async function getAllMenusApi() {
  return requestClient.get<RouteRecordStringComponent[]>('/menus/me');
}

/**
 * 获取全量菜单树（系统管理页使用）。
 */
export async function getAllMenuTreeApi() {
  return requestClient.get<any[]>('/menus');
}

/**
 * 新增菜单。
 */
export async function createMenuApi(data: Record<string, any>) {
  return requestClient.post('/menus', data);
}

/**
 * 编辑菜单。
 */
export async function updateMenuApi(id: number, data: Record<string, any>) {
  return requestClient.put(`/menus/${id}`, data);
}

/**
 * 删除菜单。
 */
export async function deleteMenuApi(id: number) {
  return requestClient.delete(`/menus/${id}`);
}
