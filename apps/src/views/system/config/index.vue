<script lang="ts" setup>
import type { SystemConfigVO } from '#/api/system-config';

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Drawer,
  Empty,
  Form,
  FormItem,
  Input,
  message,
  Modal,
  Spin,
  Switch,
  Tag,
  Textarea,
} from 'ant-design-vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import {
  createSystemConfigApi,
  deleteSystemConfigApi,
  listSystemConfigsApi,
  updateSystemConfigApi,
} from '#/api/system-config';

// ===== Route meta: configType 优先取 meta，降级从 path 判断
const route = useRoute();
const configType = computed(() => {
  if (route.meta.configType) return route.meta.configType as string;
  return route.path === '/system/config' ? 'SYSTEM' : 'CUSTOMER_SERVICE';
});

// ===== 列表状态 =====
const list = ref<SystemConfigVO[]>([]);
const loading = ref(false);
const keyword = ref('');
// 一次拉取全量，分类/统计/搜索均在前端聚合
const PAGE_SIZE = 1000;

// ===== 分类筛选 =====
const selectedCategory = ref('');

// ===== 抽屉状态 =====
const drawerOpen = ref(false);
const editingId = ref<null | number | string>(null);
const submitting = ref(false);

// ===== 行内开关状态 =====
const togglingId = ref<null | number | string>(null);

// ===== 表单状态 =====
const emptyForm = () => ({
  configKey: '',
  configValue: '',
  configType: configType.value,
  description: '',
});
const form = reactive<any>(emptyForm());

// 实时 Markdown 预览
const previewHtml = computed(() =>
  DOMPurify.sanitize(String(marked.parse(form.configValue ?? ''))),
);

// ===== 分类映射 =====
const CATEGORY_LABEL_MAP: Record<string, string> = {
  agent: 'AI配置',
  notify: '通知配置',
  route: '路由配置',
  session: '会话配置',
};

// 无前缀（无 '.'）的归类 key
const OTHER_CATEGORY_KEY = '__other__';

/** 取 configKey 第一个 '.' 前缀作为分类 key（小写）；无前缀返回 __other__ */
function getCategoryKey(configKey: string): string {
  const idx = configKey.indexOf('.');
  if (idx <= 0) return OTHER_CATEGORY_KEY;
  return configKey.slice(0, idx).toLowerCase();
}

/** 分类 key → 中文标签 */
function getCategoryLabel(key: string): string {
  if (key === OTHER_CATEGORY_KEY) return '其他';
  return CATEGORY_LABEL_MAP[key] ?? key.toUpperCase();
}

/** 分类 key → Tag 颜色 */
function getCategoryColor(configKey: string): string {
  const key = getCategoryKey(configKey);
  switch (key) {
    case 'agent': {
      return 'purple';
    }
    case 'notify': {
      return 'orange';
    }
    case 'route': {
      return 'blue';
    }
    case 'session': {
      return 'cyan';
    }
    default: {
      return 'default';
    }
  }
}

// ===== 派生：分类列表（带计数） =====
const categories = computed(() => {
  const map = new Map<string, number>();
  for (const item of list.value) {
    const key = getCategoryKey(item.configKey);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({
      key,
      label: getCategoryLabel(key),
      count,
    }))
    .toSorted((a, b) => b.count - a.count);
});

// ===== 派生：前端过滤（分类 + 关键字） =====
const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const cat = selectedCategory.value;
  return list.value.filter((item) => {
    if (cat && getCategoryKey(item.configKey) !== cat) return false;
    if (kw) {
      const hay = `${item.configKey}\n${item.description ?? ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
});

// ===== 派生：统计（前端聚合全量） =====
const stats = computed(() => {
  const total = list.value.length;
  const enabled = list.value.filter((i) => i.isEnabled).length;
  return { total, enabled, disabled: total - enabled };
});

// ===== 配置值预览（截断） =====
function previewValue(value: string | undefined, max = 100): string {
  if (!value) return '';
  const text = value.replaceAll(/\n+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ===== 加载列表 =====
async function loadList() {
  loading.value = true;
  try {
    const result = await listSystemConfigsApi({
      configType: configType.value,
      page: 0,
      size: PAGE_SIZE,
    });
    list.value = result.items;
    // 切换 configType 后重置筛选
    selectedCategory.value = '';
    keyword.value = '';
  } catch (error: any) {
    message.error(error?.response?.data?.msg ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

// ===== 新增 =====
function openCreate() {
  editingId.value = null;
  Object.assign(form, emptyForm());
  drawerOpen.value = true;
}

// ===== 编辑 =====
function openEdit(row: SystemConfigVO) {
  editingId.value = row.id;
  Object.assign(form, {
    configKey: row.configKey,
    configValue: row.configValue ?? '',
    configType: row.configType,
    description: row.description ?? '',
  });
  drawerOpen.value = true;
}

// ===== 提交 =====
async function submit() {
  if (!form.configKey.trim() && editingId.value === null) {
    message.warning('配置键不能为空');
    return;
  }
  submitting.value = true;
  try {
    if (editingId.value === null) {
      await createSystemConfigApi({ ...form });
      message.success('新增成功');
    } else {
      await updateSystemConfigApi(editingId.value, {
        configValue: form.configValue,
        description: form.description,
      });
      message.success('编辑成功');
    }
    drawerOpen.value = false;
    loadList();
  } catch (error: any) {
    message.error(error?.response?.data?.msg ?? '操作失败');
  } finally {
    submitting.value = false;
  }
}

// ===== 行内启用/停用 =====
async function toggleEnabled(row: SystemConfigVO) {
  if (!row.id) return;
  if (togglingId.value !== null) return;
  togglingId.value = row.id;
  const next = !row.isEnabled;
  try {
    await updateSystemConfigApi(row.id, {
      configValue: row.configValue,
      description: row.description,
      isEnabled: next,
    });
    row.isEnabled = next;
    message.success(`已${next ? '启用' : '停用'}`);
  } catch (error: any) {
    message.error(error?.response?.data?.msg ?? '操作失败');
  } finally {
    togglingId.value = null;
  }
}

// ===== 删除 =====
function confirmDelete(row: SystemConfigVO) {
  if (!row.id) return;
  Modal.confirm({
    title: `确认删除「${row.description || row.configKey}」？`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await deleteSystemConfigApi(row.id);
        message.success('删除成功');
        loadList();
      } catch (error: any) {
        message.error(error?.response?.data?.msg ?? '删除失败');
      }
    },
  });
}

onMounted(loadList);

watch(configType, () => {
  loadList();
});
</script>

<template>
  <Page>
    <div class="flex gap-4">
      <!-- 左侧分类侧栏 -->
      <aside class="w-48 shrink-0">
        <div class="mb-2 px-2 text-xs font-medium text-gray-500">分类</div>
        <nav class="space-y-1">
          <button
            class="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm transition"
            :class="
              selectedCategory === ''
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            "
            @click="selectedCategory = ''"
          >
            <span>全部配置</span>
            <span class="text-xs text-gray-400">{{ stats.total }}</span>
          </button>
          <button
            v-for="cat in categories"
            :key="cat.key"
            class="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm transition"
            :class="
              selectedCategory === cat.key
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            "
            @click="selectedCategory = cat.key"
          >
            <span>{{ cat.label }}</span>
            <span class="text-xs text-gray-400">{{ cat.count }}</span>
          </button>
        </nav>
      </aside>

      <!-- 主区域 -->
      <section class="min-w-0 flex-1">
        <!-- 顶部统计 + 搜索 -->
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <div
            class="flex items-center gap-2 rounded border border-gray-200 px-3 py-1.5 dark:border-gray-700"
          >
            <span class="text-xs text-gray-500">总计</span>
            <span class="text-base font-semibold">{{ stats.total }}</span>
          </div>
          <div
            class="flex items-center gap-2 rounded border border-green-200 bg-green-50 px-3 py-1.5 dark:border-green-800 dark:bg-green-900/20"
          >
            <span class="text-xs text-green-600 dark:text-green-400">启用</span>
            <span
              class="text-base font-semibold text-green-600 dark:text-green-400"
              >{{ stats.enabled }}</span
            >
          </div>
          <div
            class="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800/50"
          >
            <span class="text-xs text-gray-500">停用</span>
            <span class="text-base font-semibold text-gray-500">{{
              stats.disabled
            }}</span>
          </div>

          <div class="ml-auto flex items-center gap-2">
            <Input
              v-model:value="keyword"
              allow-clear
              placeholder="搜索 configKey / 说明"
              style="width: 240px"
            />
            <Button type="primary" @click="openCreate">新增配置</Button>
          </div>
        </div>

        <!-- 卡片列表 -->
        <Spin :spinning="loading">
          <Empty
            v-if="filteredList.length === 0"
            class="py-16"
            description="暂无配置"
          />
          <div v-else class="grid grid-cols-1 gap-3">
            <div
              v-for="item in filteredList"
              :key="item.id"
              class="group rounded-lg border border-gray-200 bg-white p-4 transition hover:border-primary/40 hover:shadow-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <!-- 标题行：configKey + 分类标签 + 停用标记 -->
                  <div class="mb-1 flex flex-wrap items-center gap-2">
                    <span
                      class="font-mono text-sm font-medium text-gray-900 dark:text-gray-100"
                      >{{ item.configKey }}</span
                    >
                    <Tag :color="getCategoryColor(item.configKey)">
                      {{ getCategoryLabel(getCategoryKey(item.configKey)) }}
                    </Tag>
                    <Tag v-if="!item.isEnabled" color="default">停用</Tag>
                  </div>
                  <!-- 说明 -->
                  <div
                    v-if="item.description"
                    class="mb-1 truncate text-xs text-gray-500 dark:text-gray-400"
                  >
                    {{ item.description }}
                  </div>
                  <!-- 值预览 -->
                  <div
                    class="truncate font-mono text-xs text-gray-600 dark:text-gray-300"
                  >
                    {{ previewValue(item.configValue) || '（空）' }}
                  </div>
                </div>

                <!-- 右侧操作：启用开关 + 编辑/删除 -->
                <div class="flex shrink-0 flex-col items-end gap-2">
                  <Switch
                    :checked="item.isEnabled"
                    :loading="togglingId === item.id"
                    size="small"
                    @change="toggleEnabled(item)"
                  />
                  <div
                    class="flex gap-1 opacity-0 transition group-hover:opacity-100"
                  >
                    <Button
                      size="small"
                      type="link"
                      @click="openEdit(item as SystemConfigVO)"
                      >编辑</Button
                    >
                    <Button
                      danger
                      size="small"
                      type="link"
                      @click="confirmDelete(item as SystemConfigVO)"
                      >删除</Button
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Spin>
      </section>
    </div>

    <!-- 新增 / 编辑抽屉（左编辑 右预览） -->
    <Drawer
      v-model:open="drawerOpen"
      :mask-closable="false"
      :title="editingId ? `编辑配置 — ${form.configKey}` : '新增配置'"
      :width="720"
      placement="right"
    >
      <Form layout="vertical">
        <!-- 新增时填写 configKey；编辑时只读展示 -->
        <FormItem v-if="!editingId" label="配置键" required>
          <Input
            v-model:value="form.configKey"
            placeholder="如 agent.xxx（创建后不可改）"
          />
        </FormItem>
        <FormItem v-else label="配置键">
          <Input :value="form.configKey" disabled />
        </FormItem>

        <FormItem label="说明">
          <Input
            v-model:value="form.description"
            placeholder="可选，配置说明"
          />
        </FormItem>

        <FormItem label="配置值">
          <!-- 左右分栏：编辑 + 预览 常驻显示 -->
          <div class="flex gap-3" style="height: 420px">
            <!-- 左：编辑 -->
            <div class="flex flex-1 flex-col">
              <div class="mb-1 text-xs font-medium text-gray-500">编辑</div>
              <Textarea
                v-model:value="form.configValue"
                class="flex-1 resize-none font-mono text-sm"
                placeholder="支持 Markdown 格式"
                style="height: 100%; min-height: 0"
              />
            </div>
            <!-- 右：预览 -->
            <div class="flex flex-1 flex-col">
              <div class="mb-1 text-xs font-medium text-gray-500">预览</div>
              <div
                class="flex-1 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800"
              >
                <!-- eslint-disable vue/no-v-html -->
                <div
                  class="prose prose-sm max-w-none"
                  v-html="previewHtml"
                ></div>
                <!-- eslint-enable vue/no-v-html -->
              </div>
            </div>
          </div>
        </FormItem>
      </Form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button @click="drawerOpen = false">取消</Button>
          <Button :loading="submitting" type="primary" @click="submit">
            保存
          </Button>
        </div>
      </template>
    </Drawer>
  </Page>
</template>
