<script lang="ts" setup>
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  unref,
  watch,
  watchEffect,
} from 'vue';

import { isNumber } from '@vben-core/shared/utils';

import { TransitionPresets, useTransition } from '@vueuse/core';

interface Props {
  autoplay?: boolean;
  color?: string;
  decimal?: string;
  decimals?: number;
  duration?: number;
  endVal?: number;
  prefix?: string;
  separator?: string;
  startVal?: number;
  suffix?: string;
  transition?: keyof typeof TransitionPresets;
  useEasing?: boolean;
}

defineOptions({ name: 'CountToAnimator' });

const props = withDefaults(defineProps<Props>(), {
  autoplay: true,
  color: '',
  decimal: '.',
  decimals: 0,
  duration: 1500,
  endVal: 2021,
  prefix: '',
  separator: ',',
  startVal: 0,
  suffix: '',
  transition: 'linear',
  useEasing: true,
});

const emit = defineEmits<{
  finished: [];
  /**
   * @deprecated 请使用{@link finished}事件
   */
  onFinished: [];
  /**
   * @deprecated 请使用{@link started}事件
   */
  onStarted: [];
  started: [];
}>();

const source = ref(props.startVal);
// Respect prefers-reduced-motion: render the final value immediately instead of
// animating. This is both an accessibility improvement and makes headless/automated
// verification deterministic (rAF is throttled in background/hidden tabs, freezing the count-up).
const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
// When the document is hidden, rAF is paused by the browser so the count-up would
// freeze at startVal forever. Render the final value immediately in that case.
const isHidden =
  typeof document !== 'undefined' && document.visibilityState === 'hidden';
const disabled = ref(prefersReducedMotion || isHidden);
let outputValue = useTransition(source, { disabled });

// 具名函数，便于 onUnmounted 精确移除，避免闭包匿名函数无法反注册的内存泄漏
function handleVisibilityChange() {
  if (!document.hidden && !prefersReducedMotion) {
    disabled.value = false;
    start();
  }
}

const value = computed(() => formatNumber(unref(outputValue)));

watchEffect(() => {
  source.value = props.startVal;
});

watch([() => props.startVal, () => props.endVal], () => {
  if (props.autoplay) {
    start();
  }
});

onMounted(() => {
  // If the tab becomes visible later, let the count-up play for real users
  // who had the component mount while the document was hidden.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  props.autoplay && start();
});

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
});

function start() {
  run();
  source.value = props.endVal;
}

function reset() {
  source.value = props.startVal;
  run();
}

function run() {
  outputValue = useTransition(source, {
    disabled,
    duration: props.duration,
    onFinished: () => {
      emit('finished');
      emit('onFinished');
    },
    onStarted: () => {
      emit('started');
      emit('onStarted');
    },
    ...(props.useEasing
      ? { transition: TransitionPresets[props.transition] }
      : {}),
  });
}

function formatNumber(num: number | string) {
  if (!num && num !== 0) {
    return '';
  }
  const { decimal, decimals, prefix, separator, suffix } = props;
  num = Number(num).toFixed(decimals);
  num += '';

  const x = num.split('.');
  let x1 = x[0];
  const x2 = x.length > 1 ? decimal + x[1] : '';

  const rgx = /(\d+)(\d{3})/;
  if (separator && !isNumber(separator) && x1) {
    while (rgx.test(x1)) {
      x1 = x1.replace(rgx, `$1${separator}$2`);
    }
  }
  return prefix + x1 + x2 + suffix;
}

defineExpose({ reset });
</script>
<template>
  <span :style="{ color }">
    {{ value }}
  </span>
</template>
