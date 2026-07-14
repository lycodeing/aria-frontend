import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          // ----------------------------------------------------------------
          // 开发环境代理规则 — 所有请求通过 nginx 容器 (https://127.0.0.1:443)
          // nginx 容器内再路由到各个后端服务，与生产环境保持一致
          // ----------------------------------------------------------------

          // 认证服务（经 nginx /auth/ 前缀路由到 auth-service）
          '/auth/api/v1': {
            changeOrigin: true,
            target: 'https://127.0.0.1:443',
            secure: false, // 自签名证书
            ws: true,
          },

          // 对话服务（经 nginx /conversation/ 前缀路由到 conversation-service）
          '/conversation/api/v1': {
            changeOrigin: true,
            target: 'https://127.0.0.1:443',
            secure: false, // 自签名证书
          },

          // 知识库服务（经 nginx /knowledge/ 前缀路由到 knowledge-service）
          '/knowledge/api': {
            changeOrigin: true,
            target: 'https://127.0.0.1:443',
            secure: false, // 自签名证书
          },

          // WebSocket 双向对话（经 nginx /ws/ 前缀路由到 conversation-service）
          '/ws': {
            changeOrigin: true,
            target: 'https://127.0.0.1:443',
            secure: false, // 自签名证书
            ws: true,
          },
        },
      },
    },
  };
});
