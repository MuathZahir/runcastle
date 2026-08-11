import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Strips inherited RUNCASTLE_* state before anything imports core's paths.
    setupFiles: ['./vitest.setup.ts'],
  },
})
