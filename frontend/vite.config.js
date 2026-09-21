import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser never talks to the backend directly: it calls relative /api
// paths and Vite proxies them. That keeps the app working behind any
// preview/deployment host instead of hardcoding localhost.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
