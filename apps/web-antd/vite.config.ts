import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          // cs-auth-service (8083)：客服系统独立认证服务（用户/角色/菜单/权限）
          '/api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, '/api/v1'),
            target: 'http://localhost:8083',
            ws: true,
          },
          // knowledge-service (8084)：知识库文档管理（后端路径 /api/knowledge/**）
          '/knowledge-api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/knowledge-api/, ''),
            target: 'http://localhost:8084',
            ws: true,
          },
          // conversation-service (8082)：AI 对话 + SSE 流式输出
          '/chat-api': {
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/chat-api/, '/api/v1'),
            target: 'http://localhost:8082',
            ws: true,
          },
          // WebSocket 双向对话（conversation-service 8082）
          '/ws': {
            changeOrigin: true,
            target: 'http://localhost:8082',
            ws: true,
          },
        },
      },
    },
  };
});
