<script lang="ts" setup>
import type { UploadProps } from 'ant-design-vue';

import type { DocListItem } from '#/api/knowledge';
import type {
  ChunkDetail,
  DocStats,
  KbStats,
  SearchHit,
} from '#/api/knowledge';

import { computed, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Drawer,
  message,
  Modal,
  Pagination,
  Progress,
  Select,
  SelectOption,
  Space,
  Spin,
  Table,
  Tag,
  Upload,
} from 'ant-design-vue';
import { marked } from 'marked';

import {
  batchOfflineApi,
  getDocChunksApi,
  getDocPreviewUrl,
  getDocRawContentApi,
  getDocStatsApi,
  getKbStatsApi,
  listDocsApi,
  offlineDocApi,
  reingestDocApi,
  retryDocApi,
  reviewDocApi,
  searchKnowledgeApi,
  translateApi,
  uploadDocApi,
} from '#/api/knowledge';
import {
  addQAChunkApi,
  disableChunkApi,
  enableChunkApi,
  updateChunkContentApi,
} from '#/api/knowledge/chunk';

// ===== 状态 =====
const loading = ref(false);
const docs = ref<DocListItem[]>([]);
const totalDocs = ref(0);
const pageNum = ref(0);
const pageSize = ref(20);
const filterKeyword = ref('');
const filterStatus = ref('');

// ===== 统计（实时从列表数据派生） =====
const stats = reactive([
  { label: '文档总数', value: 0, trend: '从知识库加载', trendType: 'neutral' },
  { label: '已发布', value: 0, trend: 'PUBLISHED', trendType: 'up' },
  { label: '待审核', value: 0, trend: '需要人工审核', trendType: 'warn' },
  { label: '已下线', value: 0, trend: 'DEPRECATED', trendType: 'down' },
]);

// ===== 多选批量操作 =====
const selectedRowKeys = ref<string[]>([]);
const batchLoading = ref(false);

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys: string[]) => {
    selectedRowKeys.value = keys;
  },
  getCheckboxProps: (record: DocListItem) => ({
    disabled: record.status === 'DEPRECATED',
  }),
}));

async function handleBatchOffline() {
  if (selectedRowKeys.value.length === 0) {
    message.warning('请先勾选要下线的文档');
    return;
  }
  batchLoading.value = true;
  try {
    await batchOfflineApi(selectedRowKeys.value);
    message.success(`已批量下线 ${selectedRowKeys.value.length} 条文档`);
    selectedRowKeys.value = [];
    loadDocs();
  } catch {
    message.error('批量下线失败');
  } finally {
    batchLoading.value = false;
  }
}

// ===== 知识库统计 =====
const kbStatsMap = ref<Record<string, KbStats>>({});

async function loadKbStats() {
  const kbIds = ['default', 'faq', 'ticket'];
  const results = await Promise.allSettled(
    kbIds.map((id) => getKbStatsApi(id)),
  );
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') kbStatsMap.value[kbIds[i]!] = r.value;
  });
}

// ===== 上传弹窗 =====
const uploadVisible = ref(false);
const progressVisible = ref(false);
const uploadKb = ref('default');
const fileList = ref<UploadProps['fileList']>([]);
const progressPct = ref(0);
const progressStep = ref('准备上传...');

// ===== Chunk 详情抽屉 =====
const drawerVisible = ref(false);
const drawerLoading = ref(false);
const currentDocName = ref('');
const chunkList = ref<ChunkDetail[]>([]);
const drawerStats = ref<DocStats | null>(null);

// chunk 分页
const chunkPageNum = ref(1);
const chunkPageSize = ref(10);
const pagedChunks = computed(() =>
  chunkList.value.slice(
    (chunkPageNum.value - 1) * chunkPageSize.value,
    chunkPageNum.value * chunkPageSize.value,
  ),
);

const chunkTypeMap: Record<string, { color: string; label: string }> = {
  TEXT: { color: 'blue', label: '正文' },
  TABLE: { color: 'green', label: '表格' },
  IMAGE_CAPTION: { color: 'purple', label: '图注' },
};

const chunkColumns = [
  { title: '页码', dataIndex: 'pageNum', key: 'pageNum', width: 60 },
  { title: '类型', dataIndex: 'chunkType', key: 'chunkType', width: 70 },
  {
    title: '章节',
    dataIndex: 'sectionTitle',
    key: 'sectionTitle',
    width: 140,
    ellipsis: true,
  },
  { title: 'Token', dataIndex: 'tokenCount', key: 'tokenCount', width: 65 },
  { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true },
  { title: '操作', key: 'chunkAction', width: 120 },
];

async function handleViewChunks(doc: DocListItem) {
  currentDocName.value = doc.fileName;
  drawerVisible.value = true;
  drawerLoading.value = true;
  chunkList.value = [];
  drawerStats.value = null;
  chunkPageNum.value = 1;
  try {
    const [chunks, stats] = await Promise.all([
      getDocChunksApi(doc.docId),
      getDocStatsApi(doc.docId),
    ]);
    chunkList.value = chunks;
    drawerStats.value = stats;
  } catch {
    message.error('加载 Chunk 详情失败');
  } finally {
    drawerLoading.value = false;
  }
}

// ===== 检索测试 Modal =====
const searchModalVisible = ref(false);
const searchQuery = ref('');
const searchKbId = ref('default');
const searchTopK = ref(5);
const searchLoading = ref(false);
const searchResults = ref<SearchHit[]>([]);

const sourceColorMap: Record<string, string> = {
  VECTOR: 'blue',
  FULL_TEXT: 'green',
  RERANK: 'purple',
};

// 每条检索结果的翻译缓存 key=chunkId, value=翻译结果
const translationMap = ref<Record<string, string>>({});
const translatingSet = ref<Set<string>>(new Set());
// 每条检索结果的展开状态
const searchExpandSet = ref<Set<string>>(new Set());
// 翻译结果弹窗
const transModalVisible = ref(false);
const transModalText = ref('');
const transModalTitle = ref('');

async function handleTranslate(hit: SearchHit) {
  // 已有缓存，直接弹窗
  if (translationMap.value[hit.chunkId]) {
    transModalTitle.value = `🔤 译文 — ${hit.fileName || ''}${hit.pageNum != null ? ` P${hit.pageNum}` : ''}`;
    transModalText.value = translationMap.value[hit.chunkId]!;
    transModalVisible.value = true;
    return;
  }
  translatingSet.value.add(hit.chunkId);
  translatingSet.value = new Set(translatingSet.value);
  try {
    const result = await translateApi(hit.content);
    translationMap.value[hit.chunkId] = result;
    translationMap.value = { ...translationMap.value };
    transModalTitle.value = `🔤 译文 — ${hit.fileName || ''}${hit.pageNum != null ? ` P${hit.pageNum}` : ''}`;
    transModalText.value = result;
    transModalVisible.value = true;
  } catch {
    message.error('翻译失败');
  } finally {
    translatingSet.value.delete(hit.chunkId);
    translatingSet.value = new Set(translatingSet.value);
  }
}

function toggleSearchExpand(chunkId: string) {
  if (searchExpandSet.value.has(chunkId)) {
    searchExpandSet.value.delete(chunkId);
  } else {
    searchExpandSet.value.add(chunkId);
  }
  searchExpandSet.value = new Set(searchExpandSet.value);
}

async function handleSearchTest() {
  if (!searchQuery.value.trim()) {
    message.warning('请输入查询内容');
    return;
  }
  searchLoading.value = true;
  searchResults.value = [];
  try {
    searchResults.value = await searchKnowledgeApi(
      searchQuery.value,
      searchKbId.value,
      searchTopK.value,
    );
  } catch {
    message.error('检索失败');
  } finally {
    searchLoading.value = false;
  }
}

// ===== 文档预览 =====
const previewVisible = ref(false);
const previewUrl = ref('');
const previewTitle = ref('');

const previewHtml = ref('');
const previewIsPdf = ref(false);
const previewLoading = ref(false);

async function handlePreview(doc: DocListItem) {
  previewTitle.value = doc.fileName;
  previewVisible.value = true;
  if (doc.fileType === 'PDF') {
    previewIsPdf.value = true;
    previewHtml.value = '';
    previewUrl.value = getDocPreviewUrl(doc.docId);
  } else {
    previewIsPdf.value = false;
    previewUrl.value = '';
    previewLoading.value = true;
    previewHtml.value = '';
    try {
      const text = await getDocRawContentApi(doc.docId);
      previewHtml.value =
        doc.fileType === 'MARKDOWN'
          ? (marked.parse(text) as string)
          : `<pre style="white-space:pre-wrap;word-break:break-all;font-size:13px;line-height:1.7;">${text.replaceAll('<', '&lt;')}</pre>`;
    } catch {
      previewHtml.value = '<p style="color:red">加载失败</p>';
    } finally {
      previewLoading.value = false;
    }
  }
}

// ===== Chunk 展开收起 =====
const expandedChunks = ref<Set<string>>(new Set());
function toggleExpand(chunkId: string) {
  if (expandedChunks.value.has(chunkId)) {
    expandedChunks.value.delete(chunkId);
  } else {
    expandedChunks.value.add(chunkId);
  }
  // 触发响应式更新
  expandedChunks.value = new Set(expandedChunks.value);
}

// ===== Chunk 编辑 =====
const editingChunkId = ref<null | string>(null);
const editingContent = ref('');
const editLoading = ref(false);

// ===== Q&A 添加 =====
const qaModalVisible = ref(false);
const qaDocId = ref('');
const qaKbId = ref('default');
const qaQuestion = ref('');
const qaAnswer = ref('');
const qaLoading = ref(false);

async function handleToggleChunk(chunk: ChunkDetail) {
  const isEnabled = chunk.retrievalWeight !== 0;
  try {
    if (isEnabled) {
      await disableChunkApi(chunk.chunkId);
      message.success('Chunk 已禁用');
    } else {
      await enableChunkApi(chunk.chunkId);
      message.success('Chunk 已启用');
    }
    // 刷新当前文档 chunk 列表
    const doc = docs.value.find(
      (d) => d.docId === chunkList.value[0]?.chunkId?.slice(0, -1),
    );
    if (doc) await handleViewChunks(doc);
  } catch {
    message.error('操作失败');
  }
}

async function handleSaveEdit() {
  if (!editingChunkId.value || !editingContent.value.trim()) return;
  editLoading.value = true;
  try {
    await updateChunkContentApi(editingChunkId.value, editingContent.value);
    message.success('Chunk 已更新并重新向量化');
    editingChunkId.value = null;
    editingContent.value = '';
  } catch {
    message.error('更新失败');
  } finally {
    editLoading.value = false;
  }
}

async function handleAddQA() {
  if (!qaQuestion.value.trim() || !qaAnswer.value.trim()) {
    message.warning('问题和答案不能为空');
    return;
  }
  qaLoading.value = true;
  try {
    await addQAChunkApi(
      qaDocId.value,
      qaKbId.value,
      qaQuestion.value,
      qaAnswer.value,
    );
    message.success('Q&A 已添加');
    qaModalVisible.value = false;
    qaQuestion.value = '';
    qaAnswer.value = '';
  } catch {
    message.error('添加失败');
  } finally {
    qaLoading.value = false;
  }
}

// ===== 状态样式映射 =====
const statusMap: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: '草稿' },
  REVIEW: { color: 'warning', label: '审核中' },
  PUBLISHED: { color: 'success', label: '已发布' },
  DEPRECATED: { color: 'error', label: '已下线' },
  FAILED: { color: 'red', label: '摄取失败' },
};

const fmtIcon: Record<string, string> = {
  MARKDOWN: '📝',
  PDF: '📕',
  HTML: '🌐',
  DOCX: '📄',
  TICKET: '🎫',
};

const columns = [
  { title: '文档名称', dataIndex: 'fileName', key: 'fileName' },
  { title: '格式', dataIndex: 'fileType', key: 'fileType', width: 80 },
  { title: '知识库', dataIndex: 'kbId', key: 'kbId', width: 120 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 180 },
  { title: '操作', key: 'action', width: 160 },
];

// ===== 加载文档列表 =====
async function loadDocs() {
  loading.value = true;
  try {
    const result = await listDocsApi({
      keyword: filterKeyword.value || undefined,
      status: filterStatus.value || undefined,
      page: pageNum.value,
      size: pageSize.value,
    });
    docs.value = result.items ?? (result as any).list ?? [];
    totalDocs.value = Number(result.total ?? 0);
    updateStats();
  } catch {
    message.error('加载文档列表失败');
  } finally {
    loading.value = false;
  }
}

function updateStats() {
  stats[0]!.value = totalDocs.value;
  stats[1]!.value = docs.value.filter((d) => d.status === 'PUBLISHED').length;
  stats[2]!.value = docs.value.filter(
    (d) => d.status === 'DRAFT' || d.status === 'REVIEW',
  ).length;
  stats[3]!.value = docs.value.filter((d) => d.status === 'DEPRECATED').length;
}

function handleSearch() {
  pageNum.value = 0;
  loadDocs();
}
function handlePageChange(p: number) {
  pageNum.value = p - 1;
  loadDocs();
}

// ===== 审核 =====
async function handleApprove(doc: DocListItem) {
  await reviewDocApi(doc.docId, true);
  message.success(`文档 "${doc.fileName}" 已审核通过`);
  loadDocs();
}

// ===== 下线 =====
async function handleOffline(doc: DocListItem) {
  await offlineDocApi(doc.docId);
  message.success('文档已下线');
  loadDocs();
}

// ===== 上传 =====
async function startUpload() {
  if (!fileList.value?.length) {
    message.warning('请先选择文件');
    return;
  }
  const file = fileList.value[0]?.originFileObj as File;
  if (!file) {
    message.warning('无法获取文件对象');
    return;
  }
  uploadVisible.value = false;
  progressVisible.value = true;
  progressPct.value = 10;
  progressStep.value = '正在上传文件...';
  try {
    progressPct.value = 50;
    progressStep.value = '服务器接收中...';
    await uploadDocApi(file, uploadKb.value);
    progressPct.value = 100;
    progressStep.value = '上传完成，后台处理中...';
    setTimeout(() => {
      progressVisible.value = false;
      fileList.value = [];
      message.success('文档上传成功，等待后台处理');
      loadDocs();
    }, 800);
  } catch {
    progressVisible.value = false;
    message.error('文档上传失败');
  }
}

function formatTime(ts: null | string) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

onMounted(() => {
  loadDocs();
  loadKbStats();
});
</script>

<template>
  <Page
    title="知识库管理"
    description="管理客服知识文档，支持 PDF / Markdown / HTML / Word / 工单"
  >
    <template #extra>
      <Space>
        <Button @click="searchModalVisible = true">🔍 检索测试</Button>
        <Button type="primary" @click="uploadVisible = true">上传文档</Button>
      </Space>
    </template>

    <!-- 知识库统计卡片 -->
    <div
      style="
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin-bottom: 16px;
      "
    >
      <div
        v-for="kb in [
          { id: 'default', label: '默认知识库', icon: '📚' },
          { id: 'faq', label: 'FAQ 知识库', icon: '❓' },
          { id: 'ticket', label: '历史工单库', icon: '🎫' },
        ]"
        :key="kb.id"
        style="
          padding: 20px;
          background: #fff;
          border-radius: 8px;
          box-shadow: 0 1px 4px #0001;
        "
      >
        <div
          style="
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 12px;
          "
        >
          <span style="font-size: 20px">{{ kb.icon }}</span>
          <span style="font-size: 15px; font-weight: 600">{{ kb.label }}</span>
        </div>
        <div
          v-if="kbStatsMap[kb.id]"
          style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px"
        >
          <div style="text-align: center">
            <div style="font-size: 20px; font-weight: 600; color: #1677ff">
              {{ kbStatsMap[kb.id]?.docCount ?? 0 }}
            </div>
            <div style="font-size: 11px; color: #999">文档数</div>
          </div>
          <div style="text-align: center">
            <div style="font-size: 20px; font-weight: 600; color: #52c41a">
              {{ kbStatsMap[kb.id]?.chunkCount ?? 0 }}
            </div>
            <div style="font-size: 11px; color: #999">Chunk 数</div>
          </div>
          <div style="text-align: center">
            <div style="font-size: 20px; font-weight: 600; color: #fa8c16">
              {{ ((kbStatsMap[kb.id]?.tokenSum ?? 0) / 1000).toFixed(1) }}K
            </div>
            <div style="font-size: 11px; color: #999">Token</div>
          </div>
        </div>
        <div
          v-else
          style="padding: 8px; font-size: 13px; color: #ccc; text-align: center"
        >
          加载中...
        </div>
      </div>
    </div>

    <!-- 过滤栏 -->
    <div
      style="
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 16px;
        margin-bottom: 16px;
        background: #fff;
        border-radius: 8px;
      "
    >
      <input
        v-model="filterKeyword"
        placeholder="搜索文档名称..."
        style="
          width: 220px;
          padding: 4px 11px;
          border: 1px solid #d9d9d9;
          border-radius: 6px;
        "
        @keyup.enter="handleSearch"
      />
      <Select
        v-model:value="filterStatus"
        placeholder="全部状态"
        style="width: 120px"
        allow-clear
        @change="handleSearch"
      >
        <SelectOption value="DRAFT">草稿</SelectOption>
        <SelectOption value="REVIEW">审核中</SelectOption>
        <SelectOption value="PUBLISHED">已发布</SelectOption>
        <SelectOption value="DEPRECATED">已下线</SelectOption>
      </Select>
      <Button @click="handleSearch">搜索</Button>
    </div>

    <!-- 文档表格 -->
    <div style="padding: 16px; background: #fff; border-radius: 8px">
      <!-- 批量操作栏 -->
      <div
        v-if="selectedRowKeys.length > 0"
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          margin-bottom: 12px;
          background: #e6f4ff;
          border: 1px solid #91caff;
          border-radius: 6px;
        "
      >
        <span style="font-size: 13px; color: #1677ff">
          已选择 <strong>{{ selectedRowKeys.length }}</strong> 条文档
        </span>
        <Space>
          <Button size="small" @click="selectedRowKeys = []">取消选择</Button>
          <Button
            size="small"
            danger
            :loading="batchLoading"
            @click="handleBatchOffline"
          >
            批量下线
          </Button>
        </Space>
      </div>

      <Table
        :columns="columns"
        :data-source="docs"
        row-key="docId"
        :loading="loading"
        :row-selection="rowSelection"
        :pagination="{
          current: pageNum + 1,
          pageSize,
          total: totalDocs,
          onChange: handlePageChange,
          showTotal: (total: number) => `共 ${total} 条`,
        }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'fileName'">
            <span style="margin-right: 6px">{{
              fmtIcon[record.fileType] ?? '📄'
            }}</span>
            <span style="font-weight: 500">{{ record.fileName }}</span>
          </template>
          <template v-if="column.key === 'status'">
            <Tag :color="statusMap[record.status]?.color">
              {{ statusMap[record.status]?.label ?? record.status }}
            </Tag>
          </template>
          <template v-if="column.key === 'updatedAt'">
            {{ formatTime(record.updatedAt) }}
          </template>
          <template v-if="column.key === 'action'">
            <Space>
              <Button size="small" @click="handleViewChunks(record)">
                详 情
              </Button>
              <Button
                v-if="
                  record.fileType === 'PDF' || record.fileType === 'MARKDOWN'
                "
                size="small"
                @click="handlePreview(record)"
              >
                预 览
              </Button>
              <Button
                v-if="record.status === 'DRAFT' || record.status === 'REVIEW'"
                size="small"
                type="primary"
                ghost
                @click="handleApprove(record)"
              >
                审核通过
              </Button>
              <Button
                v-if="record.status === 'PUBLISHED'"
                size="small"
                @click="
                  async () => {
                    await reingestDocApi(record.docId);
                    message.success('已触发重新摄取');
                    loadDocs();
                  }
                "
              >
                重新摄取
              </Button>
              <Button
                v-if="record.status === 'FAILED'"
                size="small"
                type="primary"
                @click="
                  async () => {
                    await retryDocApi(record.docId);
                    message.success('重试已触发');
                    loadDocs();
                  }
                "
              >
                重 试
              </Button>
              <Button
                v-if="record.status === 'PUBLISHED'"
                size="small"
                danger
                @click="handleOffline(record)"
              >
                下 线
              </Button>
            </Space>
          </template>
        </template>
      </Table>
    </div>

    <!-- 上传弹窗 -->
    <Modal
      v-model:open="uploadVisible"
      title="上传知识文档"
      :footer="null"
      :width="440"
      centered
    >
      <div
        style="display: flex; flex-direction: column; gap: 16px; padding: 8px 0"
      >
        <Upload.Dragger
          v-model:file-list="fileList"
          :before-upload="() => false"
          accept=".pdf,.md,.html,.docx"
          :multiple="false"
        >
          <p style="font-size: 32px">📂</p>
          <p style="font-weight: 500">点击或拖拽文件至此处</p>
          <p style="font-size: 12px; color: #999">
            支持 PDF、Markdown、HTML、Word，单文件最大 50MB
          </p>
        </Upload.Dragger>
        <div>
          <div style="margin-bottom: 4px; font-size: 14px">目标知识库</div>
          <Select v-model:value="uploadKb" style="width: 100%">
            <SelectOption value="default">默认知识库</SelectOption>
            <SelectOption value="faq">FAQ</SelectOption>
            <SelectOption value="ticket">历史工单</SelectOption>
          </Select>
        </div>
        <div style="display: flex; gap: 8px">
          <Button style="flex: 1" @click="uploadVisible = false">取消</Button>
          <Button type="primary" style="flex: 1" @click="startUpload">
            开始上传
          </Button>
        </div>
      </div>
    </Modal>

    <!-- 上传进度弹窗 -->
    <Modal
      v-model:open="progressVisible"
      title="文档处理中"
      :footer="null"
      :closable="false"
      :width="360"
      centered
    >
      <div
        style="
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px 0;
        "
      >
        <Progress :percent="progressPct" status="active" />
        <p style="font-size: 14px; color: #666; text-align: center">
          {{ progressStep }}
        </p>
      </div>
    </Modal>

    <!-- Chunk 解析详情抽屉 -->
    <Drawer
      v-model:open="drawerVisible"
      :title="`解析详情 — ${currentDocName}`"
      placement="right"
      width="800"
    >
      <!-- chunk 统计卡片 -->
      <div
        v-if="drawerStats"
        style="
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 10px;
          margin-bottom: 12px;
        "
      >
        <div
          style="
            padding: 10px 14px;
            text-align: center;
            background: #e6f4ff;
            border: 1px solid #91caff;
            border-radius: 6px;
          "
        >
          <div style="font-size: 20px; font-weight: 600; color: #1677ff">
            {{ drawerStats.totalChunks }}
          </div>
          <div style="margin-top: 2px; font-size: 11px; color: #666">
            总 Chunk 数
          </div>
        </div>
        <div
          style="
            padding: 10px 14px;
            text-align: center;
            background: #f6ffed;
            border: 1px solid #b7eb8f;
            border-radius: 6px;
          "
        >
          <div style="font-size: 20px; font-weight: 600; color: #52c41a">
            {{ drawerStats.totalTokens }}
          </div>
          <div style="margin-top: 2px; font-size: 11px; color: #666">
            总 Token 数
          </div>
        </div>
        <div
          style="
            padding: 10px 14px;
            text-align: center;
            background: #e6f4ff;
            border: 1px solid #91caff;
            border-radius: 6px;
          "
        >
          <div style="font-size: 20px; font-weight: 600; color: #1677ff">
            {{ drawerStats.textChunks }}
          </div>
          <div style="margin-top: 2px; font-size: 11px; color: #666">
            📄 正文
          </div>
        </div>
        <div
          style="
            padding: 10px 14px;
            text-align: center;
            background: #f6ffed;
            border: 1px solid #95de64;
            border-radius: 6px;
          "
        >
          <div style="font-size: 20px; font-weight: 600; color: #389e0d">
            {{ drawerStats.tableChunks }}
          </div>
          <div style="margin-top: 2px; font-size: 11px; color: #666">
            📊 表格
          </div>
        </div>
        <div
          style="
            padding: 10px 14px;
            text-align: center;
            background: #f9f0ff;
            border: 1px solid #d3adf7;
            border-radius: 6px;
          "
        >
          <div style="font-size: 20px; font-weight: 600; color: #722ed1">
            {{ drawerStats.imageChunks }}
          </div>
          <div style="margin-top: 2px; font-size: 11px; color: #666">
            🖼️ 图注
          </div>
        </div>
      </div>

      <!-- Q&A 入口 -->
      <div
        style="display: flex; justify-content: flex-end; margin-bottom: 10px"
      >
        <Button
          type="dashed"
          size="small"
          @click="
            qaDocId = chunkList[0]?.chunkId ?? 'manual';
            qaKbId = 'default';
            qaModalVisible = true;
          "
        >
          + 添加 Q&A
        </Button>
      </div>

      <!-- 内联编辑区 -->
      <div
        v-if="editingChunkId"
        style="
          padding: 12px;
          margin-bottom: 12px;
          background: #fffbe6;
          border: 1px solid #ffe58f;
          border-radius: 6px;
        "
      >
        <div style="margin-bottom: 8px; font-size: 13px; color: #ad8b00">
          ✏️ 正在编辑 Chunk
        </div>
        <textarea
          v-model="editingContent"
          rows="5"
          style="
            box-sizing: border-box;
            width: 100%;
            padding: 8px;
            font-size: 13px;
            resize: vertical;
            border: 1px solid #d9d9d9;
            border-radius: 4px;
          "
        ></textarea>
        <div
          style="
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 8px;
          "
        >
          <Button size="small" @click="editingChunkId = null">取消</Button>
          <Button
            type="primary"
            size="small"
            :loading="editLoading"
            @click="handleSaveEdit"
          >
            保存并重新向量化
          </Button>
        </div>
      </div>

      <!-- Chunk 卡片列表 -->
      <div style="max-height: calc(100vh - 290px); overflow-y: auto">
        <Spin
          v-if="drawerLoading"
          style="display: block; padding: 40px; text-align: center"
        />
        <div
          v-else-if="chunkList.length === 0"
          style="
            padding: 40px;
            font-size: 14px;
            color: #ccc;
            text-align: center;
          "
        >
          暂无 Chunk 数据
        </div>
        <template v-else>
          <div
            v-for="(chunk, idx) in pagedChunks"
            :key="chunk.chunkId"
            :style="{
              border: `1px solid ${
                (chunk.retrievalWeight ?? 1) === 0 ? '#ffccc7' : '#f0f0f0'
              }`,
              borderRadius: '8px',
              padding: '12px 14px',
              marginBottom: '10px',
              background:
                (chunk.retrievalWeight ?? 1) === 0 ? '#fff2f0' : '#fff',
              opacity: (chunk.retrievalWeight ?? 1) === 0 ? '0.7' : '1',
            }"
          >
            <!-- 顶部元数据行 -->
            <div
              style="
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
              "
            >
              <div
                style="
                  display: flex;
                  flex: 1;
                  flex-wrap: wrap;
                  gap: 6px;
                  align-items: center;
                  min-width: 0;
                "
              >
                <span
                  style="
                    flex-shrink: 0;
                    padding: 1px 7px;
                    font-size: 11px;
                    font-weight: 600;
                    color: #fff;
                    background: #1677ff;
                    border-radius: 4px;
                  "
                >
                  #{{ (chunkPageNum - 1) * chunkPageSize + idx + 1 }}
                </span>
                <span
                  v-if="chunk.pageNum != null"
                  style="
                    flex-shrink: 0;
                    padding: 1px 6px;
                    font-size: 11px;
                    color: #595959;
                    background: #f5f5f5;
                    border: 1px solid #e8e8e8;
                    border-radius: 4px;
                  "
                >
                  P{{ chunk.pageNum }}
                </span>
                <Tag
                  :color="chunkTypeMap[chunk.chunkType]?.color ?? 'default'"
                  style="flex-shrink: 0; margin: 0; font-size: 11px"
                >
                  {{ chunkTypeMap[chunk.chunkType]?.label ?? chunk.chunkType }}
                </Tag>
                <span
                  v-if="chunk.sectionTitle"
                  style="
                    max-width: 220px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    font-size: 12px;
                    color: #595959;
                    white-space: nowrap;
                  "
                  :title="chunk.sectionTitle"
                >
                  📑 {{ chunk.sectionTitle }}
                </span>
                <Tag
                  v-if="(chunk.retrievalWeight ?? 1) === 0"
                  color="error"
                  style="margin: 0; font-size: 11px"
                >
                  已禁用
                </Tag>
              </div>
              <div
                style="
                  display: flex;
                  flex-shrink: 0;
                  gap: 6px;
                  align-items: center;
                "
              >
                <span style="font-size: 11px; color: #bbb">{{ chunk.tokenCount }} tokens</span>
                <Button
                  size="small"
                  @click="
                    editingChunkId = chunk.chunkId;
                    editingContent = chunk.content;
                  "
                >
                  编辑
                </Button>
                <Button
                  size="small"
                  :danger="(chunk.retrievalWeight ?? 1) !== 0"
                  :type="
                    (chunk.retrievalWeight ?? 1) === 0 ? 'primary' : 'default'
                  "
                  @click="handleToggleChunk(chunk)"
                >
                  {{ (chunk.retrievalWeight ?? 1) === 0 ? '启用' : '禁用' }}
                </Button>
              </div>
            </div>
            <!-- 内容区：默认截断，点击展开 -->
            <div
              style="
                position: relative;
                padding: 10px 12px;
                font-size: 13px;
                line-height: 1.8;
                color: #333;
                word-break: break-all;
                white-space: pre-wrap;
                cursor: pointer;
                background: #fafafa;
                border: 1px solid #f0f0f0;
                border-radius: 4px;
              "
              @click="toggleExpand(chunk.chunkId)"
            >
              <span v-if="expandedChunks.has(chunk.chunkId)">{{
                chunk.content
              }}</span>
              <span v-else>{{
                chunk.content.length > 180
                  ? `${chunk.content.slice(0, 180)}…`
                  : chunk.content
              }}</span>
              <span
                v-if="chunk.content.length > 180"
                style="
                  display: inline-block;
                  margin-left: 4px;
                  font-size: 12px;
                  color: #1677ff;
                  user-select: none;
                "
              >
                {{
                  expandedChunks.has(chunk.chunkId) ? '收起 ↑' : '展开全文 ↓'
                }}
              </span>
            </div>
          </div>
          <div
            style="
              padding: 6px 0 2px;
              font-size: 12px;
              color: #bbb;
              text-align: center;
            "
          >
            共 {{ chunkList.length }} 个 chunk
          </div>
        </template>
        <!-- 分页器：超过一页才显示，翻页时收起所有展开内容 -->
        <div
          v-if="chunkList.length > chunkPageSize"
          style="
            display: flex;
            justify-content: center;
            padding: 16px 0 4px;
            margin-top: 4px;
            border-top: 1px solid #f5f5f5;
          "
        >
          <Pagination
            v-model:current="chunkPageNum"
            :total="chunkList.length"
            :page-size="chunkPageSize"
            :show-size-changer="true"
            :page-size-options="['10', '20', '50']"
            size="small"
            @change="
              (p: number) => {
                chunkPageNum = p;
                expandedChunks = new Set();
              }
            "
            @show-size-change="
              (_: number, size: number) => {
                chunkPageSize = size;
                chunkPageNum = 1;
              }
            "
          />
        </div>
      </div>
    </Drawer>

    <!-- 文档预览 Modal -->
    <Modal
      v-model:open="previewVisible"
      :title="previewTitle"
      :footer="null"
      :width="900"
      :body-style="{
        padding: previewIsPdf ? '0' : '20px 24px',
        height: '80vh',
        overflowY: 'auto',
      }"
      style="top: 40px"
    >
      <!-- PDF：iframe 原生渲染 -->
      <iframe
        v-if="previewIsPdf && previewVisible"
        :src="previewUrl"
        style="display: block; width: 100%; height: 100%; border: none"
        title="文档预览"
      ></iframe>
      <!-- Markdown / 文本：rendered HTML -->
      <div
        v-else-if="previewLoading"
        style="padding: 60px; font-size: 14px; color: #bbb; text-align: center"
      >
        加载中...
      </div>
      <div
        v-else
        class="markdown-preview-body"
        style="font-size: 14px; line-height: 1.9; color: #333"
        v-html="previewHtml"
      ></div>
    </Modal>

    <!-- 添加 Q&A Modal -->
    <Modal
      v-model:open="qaModalVisible"
      title="添加 Q&A 问答对"
      :confirm-loading="qaLoading"
      @ok="handleAddQA"
      :width="520"
    >
      <div
        style="display: flex; flex-direction: column; gap: 12px; padding: 8px 0"
      >
        <div>
          <div style="margin-bottom: 4px; font-size: 13px; font-weight: 500">
            问题 Q
          </div>
          <textarea
            v-model="qaQuestion"
            rows="3"
            placeholder="输入用户可能问的问题..."
            style="
              box-sizing: border-box;
              width: 100%;
              padding: 8px;
              font-size: 13px;
              resize: none;
              border: 1px solid #d9d9d9;
              border-radius: 4px;
            "
          ></textarea>
        </div>
        <div>
          <div style="margin-bottom: 4px; font-size: 13px; font-weight: 500">
            答案 A
          </div>
          <textarea
            v-model="qaAnswer"
            rows="5"
            placeholder="输入对应的标准答案..."
            style="
              box-sizing: border-box;
              width: 100%;
              padding: 8px;
              font-size: 13px;
              resize: none;
              border: 1px solid #d9d9d9;
              border-radius: 4px;
            "
          ></textarea>
        </div>
        <div>
          <div style="margin-bottom: 4px; font-size: 13px; font-weight: 500">
            目标知识库
          </div>
          <Select v-model:value="qaKbId" style="width: 100%">
            <SelectOption value="default">默认知识库</SelectOption>
            <SelectOption value="faq">FAQ</SelectOption>
            <SelectOption value="ticket">历史工单</SelectOption>
          </Select>
        </div>
      </div>
    </Modal>

    <!-- 翻译结果 Modal -->
    <Modal
      v-model:open="transModalVisible"
      :title="transModalTitle"
      :footer="null"
      :width="620"
    >
      <div style="max-height: 60vh; padding: 4px 0; overflow-y: auto">
        <p
          style="
            margin: 0;
            font-size: 14px;
            line-height: 1.9;
            color: #333;
            word-break: break-all;
            white-space: pre-wrap;
          "
        >
          {{ transModalText }}
        </p>
      </div>
    </Modal>

    <!-- 检索测试 Modal -->
    <Modal
      v-model:open="searchModalVisible"
      title="🔍 检索测试"
      :footer="null"
      :width="860"
    >
      <div
        style="
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 16px;
        "
      >
        <Select v-model:value="searchKbId" style="width: 140px">
          <SelectOption value="default">默认知识库</SelectOption>
          <SelectOption value="faq">FAQ</SelectOption>
          <SelectOption value="ticket">历史工单</SelectOption>
        </Select>
        <input
          v-model="searchQuery"
          placeholder="输入查询内容，回车搜索..."
          style="
            flex: 1;
            padding: 6px 12px;
            font-size: 14px;
            border: 1px solid #d9d9d9;
            border-radius: 6px;
          "
          @keyup.enter="handleSearchTest"
        />
        <Select v-model:value="searchTopK" style="width: 90px">
          <SelectOption :value="3">Top 3</SelectOption>
          <SelectOption :value="5">Top 5</SelectOption>
          <SelectOption :value="10">Top 10</SelectOption>
        </Select>
        <Button
          type="primary"
          :loading="searchLoading"
          @click="handleSearchTest"
        >
          搜 索
        </Button>
      </div>
      <Spin :spinning="searchLoading">
        <div
          v-if="searchResults.length === 0 && !searchLoading"
          style="padding: 40px 0; color: #999; text-align: center"
        >
          输入查询词后点击搜索，查看 RAG 召回结果与分数
        </div>
        <div
          v-for="(hit, idx) in searchResults"
          :key="hit.chunkId"
          style="
            padding: 12px 14px;
            margin-bottom: 10px;
            background: #fff;
            border: 1px solid #f0f0f0;
            border-radius: 8px;
          "
        >
          <!-- 顶部元数据行 -->
          <div
            style="
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 8px;
            "
          >
            <div
              style="
                display: flex;
                flex: 1;
                flex-wrap: wrap;
                gap: 5px;
                align-items: center;
                min-width: 0;
              "
            >
              <span
                style="
                  flex-shrink: 0;
                  padding: 1px 7px;
                  font-size: 11px;
                  font-weight: 600;
                  color: #fff;
                  background: #8c8c8c;
                  border-radius: 4px;
                "
              >
                #{{ idx + 1 }}
              </span>
              <Tag
                :color="sourceColorMap[hit.source] ?? 'default'"
                style="flex-shrink: 0; margin: 0; font-size: 11px"
              >
                {{ hit.source }}
              </Tag>
              <Tag
                :color="chunkTypeMap[hit.chunkType]?.color ?? 'default'"
                style="flex-shrink: 0; margin: 0; font-size: 11px"
              >
                {{ chunkTypeMap[hit.chunkType]?.label ?? hit.chunkType }}
              </Tag>
              <span
                v-if="hit.fileName"
                style="
                  flex-shrink: 0;
                  max-width: 160px;
                  padding: 1px 6px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  font-size: 11px;
                  color: #595959;
                  white-space: nowrap;
                  background: #f5f5f5;
                  border: 1px solid #e8e8e8;
                  border-radius: 4px;
                "
                :title="hit.fileName"
              >
                📄 {{ hit.fileName }}
              </span>
              <span
                v-if="hit.pageNum != null"
                style="
                  flex-shrink: 0;
                  padding: 1px 6px;
                  font-size: 11px;
                  color: #595959;
                  background: #f0f7ff;
                  border: 1px solid #91caff;
                  border-radius: 4px;
                "
              >
                P{{ hit.pageNum }}
              </span>
              <span
                v-if="hit.sectionTitle"
                style="
                  max-width: 180px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  font-size: 11px;
                  color: #595959;
                  white-space: nowrap;
                "
                :title="hit.sectionTitle"
              >
                📑 {{ hit.sectionTitle }}
              </span>
            </div>
            <div
              style="
                display: flex;
                flex-shrink: 0;
                gap: 8px;
                align-items: center;
              "
            >
              <span style="font-size: 12px; font-weight: 500; color: #1677ff">
                分数: {{ hit.score.toFixed(4) }}
              </span>
              <Button
                size="small"
                :loading="translatingSet.has(hit.chunkId)"
                @click="handleTranslate(hit)"
                style="font-size: 12px"
              >
                {{ translationMap[hit.chunkId] ? '再看译文' : '翻译' }}
              </Button>
            </div>
          </div>
          <!-- 原文内容（3行截断） -->
          <div
            style="
              padding: 8px 10px;
              font-size: 13px;
              line-height: 1.7;
              color: #333;
              word-break: break-all;
              white-space: pre-wrap;
              cursor: pointer;
              background: #fafafa;
              border: 1px solid #f0f0f0;
              border-radius: 4px;
            "
            @click="toggleSearchExpand(hit.chunkId)"
          >
            <span v-if="searchExpandSet.has(hit.chunkId)">{{
              hit.content
            }}</span>
            <span
              v-else
              style="
                display: -webkit-box;
                overflow: hidden;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
              "
            >
              {{ hit.content }}
            </span>
            <span
              v-if="hit.content.length > 120"
              style="
                display: block;
                margin-top: 2px;
                font-size: 11px;
                color: #1677ff;
                text-align: right;
                user-select: none;
              "
            >
              {{ searchExpandSet.has(hit.chunkId) ? '收起 ↑' : '展开 ↓' }}
            </span>
          </div>
        </div>
      </Spin>
    </Modal>
  </Page>
</template>

<style>
.markdown-preview-body h1,
.markdown-preview-body h2,
.markdown-preview-body h3 {
  margin: 1em 0 0.5em;
  font-weight: 600;
  color: #1677ff;
}

.markdown-preview-body p {
  margin: 0.6em 0;
}

.markdown-preview-body code {
  padding: 2px 6px;
  font-family: monospace;
  font-size: 13px;
  background: #f6f8fa;
  border-radius: 3px;
}

.markdown-preview-body pre {
  padding: 12px;
  margin: 0.8em 0;
  overflow-x: auto;
  background: #f6f8fa;
  border-radius: 6px;
}

.markdown-preview-body blockquote {
  padding-left: 12px;
  margin: 8px 0;
  color: #888;
  border-left: 3px solid #1677ff;
}

.markdown-preview-body table {
  width: 100%;
  margin: 0.8em 0;
  border-collapse: collapse;
}

.markdown-preview-body th,
.markdown-preview-body td {
  padding: 6px 12px;
  border: 1px solid #e8e8e8;
}

.markdown-preview-body th {
  font-weight: 600;
  background: #fafafa;
}

.markdown-preview-body ul,
.markdown-preview-body ol {
  padding-left: 1.8em;
  margin: 0.5em 0;
}

.markdown-preview-body hr {
  margin: 1em 0;
  border: none;
  border-top: 1px solid #f0f0f0;
}

.markdown-preview-body img {
  max-width: 100%;
  border-radius: 4px;
}

.markdown-preview-body a {
  color: #1677ff;
}
</style>
