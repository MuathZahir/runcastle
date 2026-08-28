import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Web dev server runs on 4513 (SPEC §0). `/api` is proxied to the runcastle
 * server on 4512 so the tRPC client can use a same-origin `/api/trpc` URL — no
 * CORS handling needed anywhere. `/ws` is proxied with `ws: true` so W1's
 * embedded-terminal WebSocket (`/ws/terminal/:sessionId`, UI-SPEC §5) works
 * same-origin in dev without an explicit `wsBase`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4513,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4512',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4512',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
