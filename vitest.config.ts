import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts'],
    // Fixture repos under `test/fixtures/` carry their OWN test files — the
    // burn-cache probe fixtures exist precisely to be typechecked and tested by
    // their own toolchain (vitest 3, jest) inside a burn container. `include`
    // above reaches them, so they have to be excluded here or this suite tries
    // to run another project's tests with the wrong runner and no deps.
    exclude: [...configDefaults.exclude, '**/test/fixtures/**'],
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
