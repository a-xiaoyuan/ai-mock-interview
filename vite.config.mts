import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时 Vite 跑在 5173，/api 请求转发给 Node 服务（3000）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
