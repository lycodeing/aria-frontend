/**
 * 会话查询页共享常量与格式化工具。
 *
 * <p>集中管理状态/结束方/角色的映射，避免 index.vue 与 SessionDetailDrawer.vue 重复定义。
 */
import dayjs from 'dayjs';

/** 会话状态 → 展示配色与文案 */
export const STATUS_MAP: Record<string, { color: string; label: string }> = {
  AI_CHAT: { color: 'blue', label: 'AI对话' },
  ACTIVE: { color: 'green', label: '人工接待' },
  CLOSED: { color: 'default', label: '已关闭' },
  WAITING: { color: 'orange', label: '排队中' },
};

/** 结束方 → 展示配色与文案 */
export const CLOSED_BY_MAP: Record<string, { color: string; label: string }> = {
  AGENT: { color: 'blue', label: '客服' },
  VISITOR: { color: 'green', label: '访客' },
  SYSTEM: { color: 'orange', label: '系统' },
};

/** 消息角色 → 气泡样式（详情抽屉对话记录用） */
export const ROLE_META: Record<
  string,
  { bg: string; color: string; icon: string; label: string }
> = {
  user: { label: '访客', icon: 'lucide:user', bg: '#f3f4f6', color: '#374151' },
  ai: { label: 'AI', icon: 'lucide:bot', bg: '#eff6ff', color: '#3b82f6' },
  assistant: {
    label: 'AI',
    icon: 'lucide:bot',
    bg: '#eff6ff',
    color: '#3b82f6',
  },
  agent: {
    label: '客服',
    icon: 'lucide:headphones',
    bg: '#f0fdf4',
    color: '#22c55e',
  },
  system: {
    label: '系统',
    icon: 'lucide:info',
    bg: '#fef3c7',
    color: '#d97706',
  },
  tool: {
    label: '工具',
    icon: 'lucide:wrench',
    bg: '#faf5ff',
    color: '#8b5cf6',
  },
};

/**
 * 会话时长（秒）→ 展示配色标签。
 * <1分钟=高效(绿)，1-10分钟=常规(默认)，>10分钟=超长(橙)，便于快速定位异常会话。
 */
export function durationTagColor(sec: null | number): string {
  if (sec === null || sec === undefined || sec < 0) return 'default';
  if (sec < 60) return 'green';
  if (sec > 600) return 'orange';
  return 'default';
}

/**
 * 会话时长（秒）→ 「X分Y秒」文案。
 * null / 负值（时间异常）返回 '—'；正确区分 0 秒与无值。
 */
export function formatDuration(sec: null | number): string {
  if (sec === null || sec === undefined || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

/** ISO 时间 → 「MM-DD HH:mm」，无值或非法返回 '—' */
export function formatTime(iso: null | string): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  return d.isValid() ? d.format('MM-DD HH:mm') : '—';
}

/** 毫秒时间戳 → 「HH:mm」（消息气泡用），无值返回空串 */
export function formatMsgTime(ts?: null | number): string {
  if (!ts) return '';
  const d = dayjs(ts);
  return d.isValid() ? d.format('HH:mm') : '';
}

/**
 * 问题标签 → 展示配色。
 * 常见类别固定配色便于快速辨识；未命中类别按字符串 hash 稳定取色，避免全部灰色。
 */
const TAG_COLOR_MAP: Record<string, string> = {
  投诉: 'red',
  退款: 'orange',
  售后: 'gold',
  咨询: 'blue',
  故障: 'volcano',
  建议: 'green',
};

const TAG_FALLBACK_COLORS = ['cyan', 'geekblue', 'purple', 'magenta', 'lime'];

export function tagColor(tag: null | string): string {
  if (!tag) return 'default';
  const mapped = TAG_COLOR_MAP[tag];
  if (mapped) return mapped;
  // 未知类别：按字符串 hash 稳定映射到固定色板，同名标签始终同色
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + (tag.codePointAt(i) ?? 0)) % 997;
  }
  const idx = hash % TAG_FALLBACK_COLORS.length;
  return TAG_FALLBACK_COLORS[idx] ?? 'default';
}
