import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          // ----------------------------------------------------------------
          // 统一 API 路由规则：前端全部使用 /api/ 开头，无需 rewrite
          // 生产环境 nginx 按同样规则路由到不同服务
          // ----------------------------------------------------------------

          // knowledge-service (8084)：路径本身就是 /api/knowledge/**，无需 rewrite
          '/api/knowledge': {
            changeOrigin: true,
            target: 'http://localhost:8084',
          },

          // conversation-service (8082)：对话 + 会话队列 + DIT 管理
          '/api/v1/chat': {
            changeOrigin: true,
            target: 'http://localhost:8082',
          },
          '/api/v1/sessions': {
            changeOrigin: true,
            target: 'http://localhost:8082',
          },
          '/api/v1/admin/dit': {
            changeOrigin: true,
            target: 'http://localhost:8082',
          },

          // WebSocket 双向对话（conversation-service 8082）
          '/ws': {
            changeOrigin: true,
            target: 'http://localhost:8082',
            ws: true,
          },

          // auth-service (8083)：兜底规则，匹配其他所有 /api/v1/** 请求
          '/api/v1': {
            changeOrigin: true,
            target: 'http://localhost:8083',
            ws: true,
          },
        },
      },
    },
  };
});
