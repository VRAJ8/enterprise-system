/// <reference types="vitest" />
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', 'openapi-fetch'],
          charts: ['recharts'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
