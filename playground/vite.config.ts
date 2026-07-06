import { defineConfig } from '@vben/vite-config';

export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      server: {
        proxy: {
          // 认证 & 用户 & 角色 → auth-service:8083
          '/api/v1/auth': {
            changeOrigin: true,
            target: 'http://localhost:8083',
            ws: true,
          },
          '/api/v1/users': {
            changeOrigin: true,
            target: 'http://localhost:8083',
          },
          // /api/v1/user/info — Vben Admin 默认用户信息路径，兼容旧调用
          '/api/v1/user': {
            changeOrigin: true,
            target: 'http://localhost:8083',
          },
          '/api/v1/roles': {
            changeOrigin: true,
            target: 'http://localhost:8083',
          },
          // 知识库 → knowledge-service:8081
          '/api/knowledge': {
            changeOrigin: true,
            target: 'http://localhost:8081',
          },
          // 对话 / 座席 / 访客 → conversation-service:8082
          '/api/v1/chat': {
            changeOrigin: true,
            target: 'http://localhost:8082',
            ws: true,
          },
          '/api/v1/sessions': {
            changeOrigin: true,
            target: 'http://localhost:8082',
            ws: true,
          },
          '/api/v1/visitor': {
            changeOrigin: true,
            target: 'http://localhost:8082',
          },
        },
      },
    },
  };
});
