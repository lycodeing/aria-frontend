<script lang="ts" setup>
/**
 * CsatRatingCard — 访客端满意度评价卡片
 *
 * 触发来源（chat-widget/index.vue 统一管理）：
 *   - AI 会话：SSE 流末尾的 `csat_request` 事件
 *   - 人工会话：座席关闭后 WS 推送的 `CSAT_REQUEST` 事件
 *
 * 状态机：idle（选择星级 + 可选评语）→ rated / skipped（结果态）
 * 提交/跳过调用访客公开接口（publicConversationClient，无 token 注入）。
 */
import type { CsatRequestPayload } from '#/api/csat/types';

import { computed, ref } from 'vue';

import { Icon } from '@iconify/vue';
import { Button, message, Textarea } from 'ant-design-vue';

import { rateCsatApi, skipCsatApi } from '#/api/csat';

const props = defineProps<{
  /** 评价邀请信封（含 csatId / sessionId / message / expiresAt） */
  payload: CsatRequestPayload;
}>();

const emit = defineEmits<{
  /** 提交或跳过后触发，父组件用于收起卡片 */
  close: [];
}>();

/** 结果态：idle=待评价, rated=已提交, skipped=已跳过 */
const status = ref<'idle' | 'rated' | 'skipped'>('idle');
/** 当前选中的星级 1–5（0=未选） */
const score = ref(0);
/** 鼠标悬停预览星级 */
const hoverScore = ref(0);
const comment = ref('');
const submitting = ref(false);

/** 展示用星级（悬停优先于选中） */
const displayScore = computed(() => hoverScore.value || score.value);

/** 星级文案 */
const scoreLabels = ['', '很不满意', '不满意', '一般', '满意', '非常满意'];

async function submit() {
  if (score.value < 1) {
    message.warning('请先选择星级评分');
    return;
  }
  submitting.value = true;
  try {
    await rateCsatApi(props.payload.csatId, {
      score: score.value,
      comment: comment.value.trim() || undefined,
    });
    status.value = 'rated';
    finish();
  } catch {
    message.error('提交失败，请稍后重试');
  } finally {
    submitting.value = false;
  }
}

async function skip() {
  submitting.value = true;
  try {
    await skipCsatApi(props.payload.csatId);
    status.value = 'skipped';
    finish();
  } catch {
    message.error('操作失败，请稍后重试');
  } finally {
    submitting.value = false;
  }
}

/** 结果态自动 2.5s 后收起 */
function finish() {
  setTimeout(() => emit('close'), 2500);
}
</script>

<template>
  <div
    data-theme="light"
    class="mx-1 my-3 rounded-2xl border px-4 py-4"
    style="
      background: linear-gradient(135deg, #eef2ff 0%, #f8fafc 100%);
      border-color: #c7d2fe;
    "
  >
    <!-- 结果态 -->
    <div
      v-if="status !== 'idle'"
      class="flex flex-col items-center gap-2 py-2 text-center"
    >
      <Icon
        v-if="status === 'rated'"
        icon="lucide:check-circle"
        class="text-3xl"
        style="color: #10b981"
      />
      <Icon
        v-else
        icon="lucide:check-circle"
        class="text-3xl"
        style="color: #94a3b8"
      />
      <p class="text-sm font-medium" style="color: #1e293b">
        {{ status === 'rated' ? '感谢您的评价！' : '已跳过评价' }}
      </p>
      <p class="text-xs" style="color: #64748b">
        {{
          status === 'rated' ? '您的反馈将帮助我们改进服务' : '期待下次为您服务'
        }}
      </p>
    </div>

    <!-- 评价态 -->
    <template v-else>
      <p class="mb-2.5 text-sm font-medium" style="color: #1e293b">
        {{ payload.message || '请对本次服务进行评价' }}
      </p>

      <!-- 星级选择 -->
      <div class="flex items-center gap-1.5">
        <button
          v-for="n in 5"
          :key="n"
          class="transition-transform hover:scale-110"
          style="line-height: 0"
          @mouseenter="hoverScore = n"
          @mouseleave="hoverScore = 0"
          @click="score = n"
        >
          <Icon
            icon="lucide:star"
            class="text-2xl"
            :style="n <= displayScore ? 'color:#f59e0b' : 'color:#d1d5db'"
          />
        </button>
        <span
          v-if="displayScore > 0"
          class="ml-1 text-xs font-medium"
          style="color: #f59e0b"
          >{{ scoreLabels[displayScore] }}</span
        >
      </div>

      <!-- 文字评语 -->
      <Textarea
        v-model:value="comment"
        :auto-size="{ minRows: 2, maxRows: 3 }"
        placeholder="补充说明（选填）"
        class="mt-3"
        style="background: #fff"
      />

      <!-- 操作 -->
      <div class="mt-3 flex items-center gap-2">
        <Button
          type="primary"
          class="flex-1"
          :loading="submitting"
          :disabled="score < 1"
          @click="submit"
        >
          提交评价
        </Button>
        <Button :disabled="submitting" @click="skip">跳过</Button>
      </div>
    </template>
  </div>
</template>
