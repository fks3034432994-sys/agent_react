import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发环境：/api 转发到后端 FastAPI（SSE 流式接口）
      // 后端地址可用 VITE_API_BASE 覆盖（见 .env.example）
      '/api': {
        target: process.env.VITE_API_BASE ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
