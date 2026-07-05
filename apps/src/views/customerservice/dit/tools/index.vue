<script lang="ts" setup>
import type { ToolDTO } from '#/api/dit';

import { onMounted, ref } from 'vue';

import {
  Button,
  Drawer,
  Form,
  FormItem,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  SelectOption,
  Space,
  Switch,
  Table,
  Tag,
  Textarea,
} from 'ant-design-vue';

import {
  createToolApi,
  deleteToolApi,
  listToolsApi,
  updateToolApi,
} from '#/api/dit';

const tools = ref<ToolDTO[]>([]);
const drawerVisible = ref(false);
const editingTool = ref<null | ToolDTO>(null);
const form = ref<Partial<ToolDTO>>({});
const saving = ref(false);

const columns = [
  { title: '工具码', dataIndex: 'code', key: 'code' },
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'toolType', key: 'toolType', width: 90 },
  { title: '方法', dataIndex: 'httpMethod', key: 'httpMethod', width: 80 },
  { title: '认证', dataIndex: 'authType', key: 'authType', width: 90 },
  {
    title: '发现工具',
    dataIndex: 'isDiscoverTool',
    key: 'isDiscoverTool',
    width: 90,
  },
  { title: '操作', key: 'actions', width: 120 },
];

onMounted(() => loadTools());

async function loadTools() {
  try {
    tools.value = await listToolsApi();
  } catch {
    message.error('加载工具列表失败');
  }
}

function openCreate() {
  editingTool.value = null;
  form.value = {
    toolType: 'HTTP',
    httpMethod: 'GET',
    authType: 'NONE',
    timeoutMs: 5000,
    isDiscoverTool: false,
    enabled: true,
  };
  drawerVisible.value = true;
}

function openEdit(t: ToolDTO) {
  editingTool.value = t;
  form.value = { ...t };
  drawerVisible.value = true;
}

async function save() {
  if (!form.value.code || !form.value.name || !form.value.description) {
    message.error('工具码、名称、说明为必填');
    return;
  }
  saving.value = true;
  const data = form.value as ToolDTO;
  try {
    if (editingTool.value?.id) {
      await updateToolApi(editingTool.value.id, data);
      message.success('更新成功');
    } else {
      await createToolApi(data);
      message.success('注册成功');
    }
    drawerVisible.value = false;
    await loadTools();
  } catch {
    message.error('操作失败，请重试');
  } finally {
    saving.value = false;
  }
}

function confirmDelete(t: ToolDTO) {
  Modal.confirm({
    title: `删除工具「${t.name}」？`,
    content: '删除后已绑定的意图工具将失效',
    okType: 'danger',
    async onOk() {
      try {
        await deleteToolApi(t.id!);
        message.success('已删除');
        await loadTools();
      } catch {
        message.error('删除失败，请重试');
      }
    },
  });
}
</script>

<template>
  <div style="padding: 16px">
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      "
    >
      <span style="font-size: 16px; font-weight: 600">工具注册中心</span>
      <Button type="primary" @click="openCreate">+ 注册新工具</Button>
    </div>

    <Table :data-source="tools" :columns="columns" row-key="id" size="middle">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'toolType'">
          <Tag :color="record.toolType === 'HTTP' ? 'blue' : 'purple'">
            {{ record.toolType }}
          </Tag>
        </template>
        <template v-if="column.key === 'isDiscoverTool'">
          <Tag v-if="record.isDiscoverTool" color="green">发现工具</Tag>
          <span v-else>-</span>
        </template>
        <template v-if="column.key === 'actions'">
          <Space>
            <a @click="openEdit(record as ToolDTO)">编辑</a>
            <a style="color: red" @click="confirmDelete(record as ToolDTO)">删除</a>
          </Space>
        </template>
      </template>
    </Table>

    <Drawer
      v-model:open="drawerVisible"
      :title="editingTool ? '编辑工具' : '注册新工具'"
      width="560"
    >
      <Form layout="vertical">
        <FormItem label="工具码 *">
          <Input
            v-model:value="form.code"
            placeholder="如：get_order（全局唯一）"
          />
        </FormItem>
        <FormItem label="名称 *">
          <Input v-model:value="form.name" placeholder="如：查询订单" />
        </FormItem>
        <FormItem label="工具说明（给 LLM 看）*">
          <Textarea
            v-model:value="form.description"
            :rows="2"
            placeholder="根据订单号获取订单详情，当用户询问订单状态时调用"
          />
        </FormItem>
        <FormItem label="工具类型">
          <Select v-model:value="form.toolType" style="width: 100%">
            <SelectOption value="HTTP">HTTP（通用 HTTP 调用）</SelectOption>
            <SelectOption value="BUILTIN">
              BUILTIN（内置 Java 实现）
            </SelectOption>
          </Select>
        </FormItem>
        <FormItem label="HTTP 方法">
          <Select v-model:value="form.httpMethod" style="width: 100%">
            <SelectOption value="GET">GET</SelectOption>
            <SelectOption value="POST">POST</SelectOption>
            <SelectOption value="PUT">PUT</SelectOption>
            <SelectOption value="DELETE">DELETE</SelectOption>
          </Select>
        </FormItem>
        <FormItem label="URL 模板">
          <Input
            v-model:value="form.urlTemplate"
            placeholder="https://api.shop.com/orders/{order_id}"
          />
        </FormItem>
        <FormItem label="参数 JSON Schema">
          <Textarea
            v-model:value="form.paramSchema"
            :rows="3"
            placeholder="{&quot;order_id&quot;:{&quot;type&quot;:&quot;string&quot;,&quot;description&quot;:&quot;订单号&quot;}}"
          />
        </FormItem>
        <FormItem label="响应提取 JSONPath">
          <Input
            v-model:value="form.responseJsonpath"
            placeholder="$.data（为空则返回完整响应）"
          />
        </FormItem>
        <FormItem label="认证类型">
          <Select v-model:value="form.authType" style="width: 100%">
            <SelectOption value="NONE">无认证</SelectOption>
            <SelectOption value="BEARER">Bearer Token</SelectOption>
            <SelectOption value="API_KEY">API Key</SelectOption>
            <SelectOption value="BASIC">Basic Auth</SelectOption>
          </Select>
        </FormItem>
        <FormItem v-if="form.authType !== 'NONE'" label="认证配置（JSON）">
          <Textarea
            v-model:value="form.authConfig"
            :rows="2"
            placeholder="{&quot;token_encrypted&quot;:&quot;your-token&quot;}"
          />
        </FormItem>
        <FormItem label="超时（毫秒）">
          <InputNumber
            v-model:value="form.timeoutMs"
            :min="500"
            :max="30000"
            style="width: 100%"
          />
        </FormItem>
        <FormItem label="可作为发现工具">
          <Switch v-model:checked="form.isDiscoverTool" />
          <span style="margin-left: 8px; font-size: 12px; color: #999">
            启用后可用于槽位 DISCOVER 级候选项发现
          </span>
        </FormItem>
      </Form>
      <template #footer>
        <Button @click="drawerVisible = false">取消</Button>
        <Button
          type="primary"
          style="margin-left: 8px"
          :loading="saving"
          @click="save"
        >
          保存
        </Button>
      </template>
    </Drawer>
  </div>
</template>
