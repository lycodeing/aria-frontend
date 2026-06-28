<script lang="ts" setup>
import type { UploadProps } from 'ant-design-vue';

import type { DocListItem } from '#/api/knowledge';

import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  message,
  Modal,
  Progress,
  Select,
  SelectOption,
  Space,
  Statistic,
  Table,
  Tag,
  Upload,
} from 'ant-design-vue';

import {
  listDocsApi,
  offlineDocApi,
  reviewDocApi,
  uploadDocApi,
} from '#/api/knowledge';

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

// ===== 上传弹窗 =====
const uploadVisible = ref(false);
const progressVisible = ref(false);
const uploadKb = ref('default');
const fileList = ref<UploadProps['fileList']>([]);
const progressPct = ref(0);
const progressStep = ref('准备上传...');

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

onMounted(loadDocs);
</script>

<template>
  <Page
    title="知识库管理"
    description="管理客服知识文档，支持 PDF / Markdown / HTML / Word / 工单"
  >
    <template #extra>
      <Button type="primary" @click="uploadVisible = true">上传文档</Button>
    </template>

    <!-- 统计卡片 -->
    <div
      style="
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        margin-bottom: 16px;
      "
    >
      <div
        v-for="s in stats"
        :key="s.label"
        style="
          padding: 20px;
          background: #fff;
          border-radius: 8px;
          box-shadow: 0 1px 4px #0001;
        "
      >
        <Statistic :title="s.label" :value="s.value" />
        <p
          :style="{
            fontSize: '12px',
            marginTop: '4px',
            color:
              s.trendType === 'up'
                ? '#52c41a'
                : s.trendType === 'warn'
                  ? '#faad14'
                  : s.trendType === 'down'
                    ? '#ff4d4f'
                    : '#999',
          }"
        >
          {{ s.trend }}
        </p>
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
    <div style=" padding: 16px;background: #fff; border-radius: 8px">
      <Table
        :columns="columns"
        :data-source="docs"
        row-key="docId"
        :loading="loading"
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
                danger
                @click="handleOffline(record)"
                >
下线
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
        style=" display: flex; flex-direction: column; gap: 16px;padding: 8px 0"
      >
        <Upload.Dragger
          v-model:file-list="fileList"
          :before-upload="() => false"
          accept=".pdf,.md,.html,.docx"
          :multiple="false"
        >
          <p style="font-size: 32px">📂</p>
          <p style="font-weight: 500">点击或拖拽文件至此处</p>
          <p style=" font-size: 12px;color: #999">
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
        <p style=" font-size: 14px; color: #666;text-align: center">
          {{ progressStep }}
        </p>
      </div>
    </Modal>
  </Page>
</template>
