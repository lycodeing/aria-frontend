import { defineConfig } from '@vben/eslint-config';

// oxfmt 负责 Vue 模板格式化，关闭与其冲突的 ESLint 格式规则
export default defineConfig().then((config) => [
  ...config,
  {
    files: ['**/*.vue'],
    rules: {
      'vue/html-closing-bracket-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },
]);
