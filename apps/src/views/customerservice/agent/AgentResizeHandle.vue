<script setup lang="ts">
import { ResizableHandle } from '@vben-core/shadcn-ui';

import { Icon } from '@iconify/vue';

const props = defineProps<{
  /** 当前侧是否已折叠 */
  collapsed: boolean;
  /** chevron 语义方向：left = 折叠后内容在左侧 */
  direction: 'left' | 'right';
}>();

const emit = defineEmits<{ toggle: [] }>();

/**
 * 折叠态：箭头指向内容所在侧（提示"展开回来"）。
 * 展开态：箭头指向外侧（提示"收起这一侧"）。
 * 左侧栏：折叠显示 chevron-right(→)，展开显示 chevron-left(←)
 * 右侧栏：折叠显示 chevron-left(←)，展开显示 chevron-right(→)
 */
function iconName(): string {
  if (props.direction === 'left') {
    return props.collapsed ? 'lucide:chevron-right' : 'lucide:chevron-left';
  }
  return props.collapsed ? 'lucide:chevron-left' : 'lucide:chevron-right';
}
</script>

<template>
  <!-- ResizableHandle 的 slot 仅在 withHandle 时渲染，因此把按钮作为兄弟节点叠加 -->
  <div class="group relative flex">
    <ResizableHandle
      class="!w-px !bg-[#e4e7ed] transition-colors hover:!bg-[#1a73e8]"
    />
    <!-- 折叠/展开按钮：hover handle 时显示 -->
    <button
      type="button"
      class="absolute left-1/2 top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#e4e7ed] bg-white text-[#52525b] opacity-0 shadow-sm transition-opacity hover:border-[#1a73e8] hover:text-[#1a73e8] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      :title="collapsed ? '展开' : '收起'"
      @click.prevent="emit('toggle')"
    >
      <Icon :icon="iconName()" class="text-[12px]" />
    </button>
  </div>
</template>
