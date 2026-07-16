// src/api/canned-response/types.ts
// 快捷回复（Canned Responses）前端类型定义。
// 字段与后端 cs_canned_response / cs_canned_response_group 表及 SearchVO 对齐。

/** 快捷回复分组 */
export interface CannedResponseGroup {
  id: number;
  name: string;
  /** 父分组 id，顶层为 null */
  parentId: null | number;
  sortOrder: number;
  createdBy: number;
  createdAt?: string;
  deleted?: boolean;
}

/** 快捷回复模板（公共 / 私人） */
export interface CannedResponse {
  id: number;
  /** 所属分组 id */
  groupId: null | number;
  title: string;
  content: string;
  /** PUBLIC=公共, PRIVATE=个人 */
  scope: 'PRIVATE' | 'PUBLIC';
  /** PRIVATE 时所属坐席 id */
  ownerId?: null | number;
  /** 使用次数，用于搜索排序 */
  useCount: number;
  sortOrder: number;
  createdBy: number;
  createdAt?: string;
  updatedAt?: string;
  deleted?: boolean;
}

/** 搜索结果 VO（屏蔽无关字段，前端直接使用） */
export interface CannedResponseSearchVO {
  id: number;
  title: string;
  content: string;
  scope: 'PRIVATE' | 'PUBLIC';
  useCount: number;
}

/** 分组新增/编辑请求体 */
export interface CannedGroupPayload {
  name: string;
  parentId?: null | number;
  sortOrder?: number;
}

/** 公共快捷回复新增/编辑请求体 */
export interface CannedPublicPayload {
  title: string;
  content: string;
  groupId?: null | number;
  sortOrder?: number;
}

/** 个人快捷回复新增/编辑请求体 */
export interface CannedMinePayload {
  title: string;
  content: string;
  groupId?: null | number;
}
