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

          // WebSocket 双向对话（经 nginx 8090 负载均衡到 conversation-service 集群）
          '/ws': {
            changeOrigin: true,
            target: 'http://localhost:8090',
            ws: true,
          },

          // conversation-service (经 nginx 8090 负载均衡)：对话 + 会话队列 + DIT 管理
          '/api/v1/chat': {
            changeOrigin: true,
            target: 'http://localhost:8090',
          },
          '/api/v1/sessions': {
            changeOrigin: true,
            target: 'http://localhost:8090',
          },
          '/api/v1/admin/dit': {
            changeOrigin: true,
            target: 'http://localhost:8090',
          },

          // conversation-service (经 nginx 8090)：Dashboard 统计接口
          '/api/v1/dashboard': {
            changeOrigin: true,
            target: 'http://localhost:8090',
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
