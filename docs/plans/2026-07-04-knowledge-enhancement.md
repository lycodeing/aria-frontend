# 知识库管理增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** 在现有 knowledge/index.vue 基础上补充 KB 统计面板、文档预览、Chunk 详情三个功能。

**Architecture:** 改造现有 knowledge/index.vue，新增统计 API 调用和三个 Modal/Drawer 组件（内联 template 实现）。

**Tech Stack:** Vue 3, TypeScript, Ant Design Vue, fetch（预览 iframe）

---

## Task 1: 补充知识库 API

**Files:**
- Modify: `apps/src/api/knowledge/index.ts`

- [ ] **Step 1: 新增统计和预览 API**

在现有 api/knowledge/index.ts 末尾追加：

```typescript
// 知识库汇总统计
export interface KbStatsVO {
  kbId: string;
  docCount: number;
  chunkCount: number;
  tokenSum: number;
}
export const getKbStatsApi = (kbId: string) =>
  requestClient.get<KbStatsVO>(`/api/knowledge/docs/kb-stats`, { params: { kbId } });

// 文档 Chunk 详情
export interface ChunkVO {
  chunkId: string;
  pageNum?: number;
  sectionTitle?: string;
  chunkType: string;
  tokenCount?: number;
  content: string;
}
export const getDocChunksApi = (docId: string) =>
  requestClient.get<ChunkVO[]>(`/api/knowledge/docs/${docId}/chunks`);

// 文档 chunk 统计
export interface DocStatsVO {
  totalChunks: number;
  totalTokens: number;
  textChunks: number;
  tableChunks: number;
  imageChunks: number;
}
export const getDocStatsApi = (docId: string) =>
  requestClient.get<DocStatsVO>(`/api/knowledge/docs/${docId}/stats`);

// 文档预览（返回 URL 供 iframe 使用）
export const getDocPreviewUrl = (docId: string) =>
  `/api/knowledge/docs/${docId}/preview`;
```

- [ ] **Step 2: 提交**

```bash
cd /Users/lycodeing/WebstormProjects/ai-customerservice-frontend
git add apps/src/api/knowledge/index.ts
git commit -m "feat(知识库): 补充 KB 统计/Chunk 详情/预览 API"
```

---

## Task 2: 知识库页面增强

**Files:**
- Modify: `apps/src/views/customerservice/knowledge/index.vue`

- [ ] **Step 1: 引入新 API 和新状态变量**

在 script 顶部追加 import：

```typescript
import { getKbStatsApi, getDocChunksApi, getDocStatsApi, getDocPreviewUrl } from '#/api/knowledge';
import type { KbStatsVO, ChunkVO, DocStatsVO } from '#/api/knowledge';
```

在状态区域追加：

```typescript
// KB 统计
const kbStats = ref<KbStatsVO | null>(null);
async function loadKbStats(kbId: string) {
  try { kbStats.value = await getKbStatsApi(kbId); } catch { /* 忽略 */ }
}

// 文档预览
const previewVisible = ref(false);
const previewDocId = ref('');
const previewUrl = computed(() => previewDocId.value ? getDocPreviewUrl(previewDocId.value) : '');
function openPreview(docId: string) {
  previewDocId.value = docId;
  previewVisible.value = true;
}

// Chunk 详情
const chunksVisible = ref(false);
const chunks = ref<ChunkVO[]>([]);
const chunkDocStats = ref<DocStatsVO | null>(null);
const chunksLoading = ref(false);
async function openChunks(docId: string) {
  chunksVisible.value = true;
  chunksLoading.value = true;
  try {
    [chunks.value, chunkDocStats.value] = await Promise.all([
      getDocChunksApi(docId),
      getDocStatsApi(docId),
    ]);
  } finally {
    chunksLoading.value = false;
  }
}

const chunkColumns = [
  { title: '页码', dataIndex: 'pageNum', key: 'pageNum', width: 70 },
  { title: '章节', dataIndex: 'sectionTitle', key: 'sectionTitle', width: 150, ellipsis: true },
  { title: '类型', dataIndex: 'chunkType', key: 'chunkType', width: 90 },
  { title: 'Token', dataIndex: 'tokenCount', key: 'tokenCount', width: 80 },
  { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
];
```

- [ ] **Step 2: 在页面顶部（文档列表之前）添加统计面板**

找到知识库选择器或文档列表的 template 最前面，追加统计卡片：

```html
<!-- KB 统计面板 -->
<a-row v-if="kbStats" :gutter="16" style="margin-bottom: 16px">
  <a-col :span="6">
    <a-statistic title="已发布文档" :value="kbStats.docCount" suffix="篇" />
  </a-col>
  <a-col :span="6">
    <a-statistic title="Chunk 总数" :value="kbStats.chunkCount" />
  </a-col>
  <a-col :span="6">
    <a-statistic title="Token 总量" :value="kbStats.tokenSum" />
  </a-col>
  <a-col :span="6">
    <a-statistic title="平均 Token/Chunk"
      :value="kbStats.chunkCount > 0 ? Math.round(kbStats.tokenSum / kbStats.chunkCount) : 0" />
  </a-col>
</a-row>
```

- [ ] **Step 3: 在文档列表操作列追加「预览」和「查看解析」按钮**

找到操作列的 template，追加两个按钮：

```html
<a @click="openPreview(record.docId)">预览</a>
<a-divider type="vertical" />
<a @click="openChunks(record.docId)">查看解析</a>
```

- [ ] **Step 4: 追加预览 Modal 和 Chunk 详情 Drawer**

在 template 末尾追加：

```html
<!-- 文档预览 Modal -->
<a-modal
  v-model:open="previewVisible"
  title="文档预览"
  width="80%"
  :footer="null"
  destroy-on-close
>
  <iframe
    v-if="previewUrl"
    :src="previewUrl"
    style="width:100%; height:70vh; border:none"
  />
</a-modal>

<!-- Chunk 详情 Drawer -->
<a-drawer
  v-model:open="chunksVisible"
  title="文档解析详情"
  width="800"
  placement="right"
>
  <!-- 统计摘要 -->
  <a-row v-if="chunkDocStats" :gutter="12" style="margin-bottom:16px">
    <a-col :span="5"><a-statistic title="总 Chunk" :value="chunkDocStats.totalChunks" /></a-col>
    <a-col :span="5"><a-statistic title="总 Token" :value="chunkDocStats.totalTokens" /></a-col>
    <a-col :span="5"><a-statistic title="文本块" :value="chunkDocStats.textChunks" /></a-col>
    <a-col :span="5"><a-statistic title="表格块" :value="chunkDocStats.tableChunks" /></a-col>
    <a-col :span="4"><a-statistic title="图片块" :value="chunkDocStats.imageChunks" /></a-col>
  </a-row>

  <a-table
    :data-source="chunks"
    :columns="chunkColumns"
    :loading="chunksLoading"
    row-key="chunkId"
    size="small"
    :scroll="{ y: 500 }"
    :pagination="{ pageSize: 20 }"
  >
    <template #bodyCell="{ column, record }">
      <template v-if="column.key === 'chunkType'">
        <a-tag :color="record.chunkType === 'TABLE' ? 'blue' : record.chunkType === 'IMAGE_CAPTION' ? 'purple' : 'default'">
          {{ record.chunkType }}
        </a-tag>
      </template>
      <template v-if="column.key === 'content'">
        <a-tooltip :title="record.content">
          <span>{{ record.content.slice(0, 80) }}{{ record.content.length > 80 ? '...' : '' }}</span>
        </a-tooltip>
      </template>
    </template>
  </a-table>
</a-drawer>
```

- [ ] **Step 5: 在 kbId 变化时触发统计加载**

找到切换知识库的 watch 或函数，在其中追加：

```typescript
// 在 kbId 变化时加载统计
watch(currentKbId, (id) => {
  if (id) loadKbStats(id);
}, { immediate: true });
```

- [ ] **Step 6: 本地验证**

访问 `http://localhost:5671/customerservice/knowledge`，确认统计面板显示、预览和 Chunk 详情弹出正常。

- [ ] **Step 7: 提交**

```bash
git add apps/src/views/customerservice/knowledge/index.vue
git commit -m "feat(知识库): 新增 KB 统计面板、文档预览、Chunk 详情弹窗"
```

---

## 验收标准

- [ ] 选择知识库后顶部显示文档数/Chunk数/Token总量统计
- [ ] 点击「预览」弹出 iframe 渲染文档原文（PDF/HTML/Markdown）
- [ ] 点击「查看解析」弹出 Chunk 列表，含分类统计和逐条内容
