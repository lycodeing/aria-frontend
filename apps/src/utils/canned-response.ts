// src/utils/canned-response.ts
// 快捷回复变量替换。
// 设计文档 §5.4 规定：变量替换由前端在「插入前」完成，后端仅存储模板原文。

export interface CannedVarContext {
  /** 访客名称，替换 {{visitor_name}} */
  visitorName?: string;
  /** 坐席名称，替换 {{agent_name}} */
  agentName?: string;
}

/** 支持的变量 → 上下文字段映射 */
const VAR_MAP: Record<string, keyof CannedVarContext> = {
  visitor_name: 'visitorName',
  agent_name: 'agentName',
};

/**
 * 将模板中的 {{var}} 占位符替换为实际值。
 * - 已知变量：取上下文值，缺省置空串（不残留占位符）
 * - 未知变量：直接置空串，避免把脏模板发到对话里
 */
export function replaceCannedVars(
  content: string,
  ctx: CannedVarContext,
): string {
  return content.replaceAll(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const key = VAR_MAP[name];
    if (!key) return '';
    return ctx[key] ?? '';
  });
}
