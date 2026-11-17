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
/**
 * Third-party code that only the lazily loaded parts use (`src/components/lazy.tsx`):
 * kept out of the vendor chunk, so it stays in those parts' own chunks.
 */
const LAZY_ONLY = /[\\/]node_modules[\\/](@xterm|qrcode-generator)[\\/]/

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The vendor chunk is big on purpose (it is cached across app updates).
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // The stable libraries (React, Radix, TanStack Query, tRPC, the
              // markdown stack, …) in one chunk of their own: an app update
              // changes the app chunk's name only, so a browser that has this
              // one keeps it (a-faster-web-app).
              name: 'vendor',
              test: (id) => /[\\/]node_modules[\\/]/.test(id) && !LAZY_ONLY.test(id),
            },
          ],
        },
      },
    },
  },
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
