import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts'],
    // Strips inherited RUNCASTLE_* state before anything imports core's paths.
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        // Node builtins imported from inside node_modules are loaded natively and
        // are therefore unmockable. sandcastle's docker/podman providers reach
        // `docker run` through `child_process`, and the named-volume patch
        // (patches/@ai-hero%2Fsandcastle@0.12.0.patch) is only observable in that
        // argv — so this one dependency is processed by vitest rather than
        // externalised, which is what makes `vi.mock('node:child_process')` bite.
        inline: ['@ai-hero/sandcastle'],
      },
    },
  },
})
