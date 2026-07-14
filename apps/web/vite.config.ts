import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Web dev server runs on 4513 (SPEC §0). `/api` is proxied to the runcastle
 * server on 4512 so the tRPC client can use a same-origin `/api/trpc` URL — no
 * CORS handling needed anywhere.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4513,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4512',
        changeOrigin: true,
      },
    },
  },
})
