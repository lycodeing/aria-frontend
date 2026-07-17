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

/** 星级对应的语义标签（悬停/选中时展示，给用户即时反馈） */
const SCORE_LABELS = ['非常不满意', '不满意', '一般', '满意', '非常满意'];
const scoreLabel = computed(() =>
  displayScore.value > 0 ? SCORE_LABELS[displayScore.value - 1] : '',
);

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
    class="mx-1 my-3 rounded-2xl border px-5 py-5"
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
      <!-- 标题 + 副标题 -->
      <p class="text-sm font-bold" style="color: #1e293b">
        {{ payload.message || '请对本次服务进行评价' }}
      </p>
      <p class="mt-1 mb-4 text-xs" style="color: #94a3b8">
        您的反馈将帮助我们改进服务质量
      </p>

      <!-- 星级选择 -->
      <!--
        用两个不同的图标（material-symbols:star 实心 / lucide:star 描边）区分状态。
        原方案两侧都用 lucide:star + CSS fill 覆盖 —— 但 lucide 图标 SVG 内
        path 硬编码了 fill="none"，外层 style 的 fill:#f59e0b 无法生效，
        导致选中态只有描边变金色，星身仍空心，UI 上看起来"没标记黄色"。
      -->
      <div class="flex items-center justify-center gap-2">
        <button
          v-for="n in 5"
          :key="n"
          class="csat-star-btn"
          :aria-label="`${n} 星`"
          @mouseenter="hoverScore = n"
          @mouseleave="hoverScore = 0"
          @click="score = n"
        >
          <Icon
            v-if="n <= displayScore"
            icon="material-symbols:star-rounded"
            class="csat-star csat-star--active"
          />
          <Icon
            v-else
            icon="material-symbols:star-outline-rounded"
            class="csat-star csat-star--inactive"
          />
        </button>
      </div>

      <!-- 悬停/选中星级的语义标签（占位保持高度稳定，不让下方内容跳动） -->
      <p class="mt-2 h-4 text-center text-xs" style="color: #f59e0b">
        {{ scoreLabel }}
      </p>

      <!--
        文字评语（未选星前禁用，引导用户先评分再补文字）。
        show-count 会把字数塞到文本域右下角贴着按钮，视觉杂乱 —
        改成自绘的左下小字，跟按钮行分开。
      -->
      <div class="csat-textarea-wrap mt-3">
        <Textarea
          v-model:value="comment"
          :auto-size="{ minRows: 2, maxRows: 3 }"
          :maxlength="200"
          :disabled="score < 1"
          :placeholder="score < 1 ? '请先选择星级评分' : '补充说明（可选）'"
          style="background: #fff"
        />
        <span
          class="csat-count"
          :class="{ 'csat-count--max': comment.length >= 200 }"
        >
          {{ comment.length }} / 200
        </span>
      </div>

      <!-- 操作：跳过在左（次要），提交在右（主要），等宽避免主次不清 -->
      <div class="csat-actions mt-4">
        <Button
          class="csat-btn"
          :disabled="submitting"
          size="large"
          @click="skip"
        >
          跳过
        </Button>
        <Button
          type="primary"
          class="csat-btn"
          :loading="submitting"
          :disabled="score < 1"
          size="large"
          @click="submit"
        >
          提交评价
        </Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ===== 星级按钮 =====
 * 用两枚不同图标（material-symbols 实心 / 描边）区分状态，
 * 避免 lucide:star 硬编码 fill="none" 无法被外层 CSS 覆盖的问题。
 */
.csat-star-btn {
  padding: 2px;
  line-height: 0;
  cursor: pointer;
  background: transparent;
  border: 0;
  transition:
    transform 0.15s ease,
    filter 0.15s ease;
}

.csat-star-btn:hover {
  transform: scale(1.12);
}

.csat-star-btn:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
  border-radius: 6px;
}

.csat-star {
  font-size: 40px;
  transition: color 0.15s ease;
}

.csat-star--active {
  color: #f59e0b;

  /* 让金色更饱满 */
  filter: drop-shadow(0 1px 2px rgb(245 158 11 / 25%));
}

.csat-star--inactive {
  color: #d1d5db;
}

/* ===== 文本域 + 自绘字数 =====
 * antd 原生 show-count 位于右下角外部，跟按钮行紧邻会挤在一起；
 * 改成左下小字，跟按钮行明确分离。
 */
.csat-textarea-wrap {
  position: relative;
}

.csat-count {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1;
  color: #94a3b8;
  text-align: right;
  transition: color 0.15s ease;
}

.csat-count--max {
  color: #ef4444;
}

/* ===== 操作按钮 =====
 * 等宽（1:1 flex）让「跳过」和「提交评价」在视觉上等分，
 * 避免默认 antd 二级按钮太单薄跟主按钮分量不匹配。
 */
.csat-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.csat-actions :deep(.csat-btn) {
  flex: 1;
  height: 40px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 8px;
}
</style>
