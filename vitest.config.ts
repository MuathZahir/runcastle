import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The apps glob takes `.tsx` too: component tests that need a DOM opt into
    // one per file with `// @vitest-environment happy-dom` (apps/web/STYLE.md),
    // and JSX is easier to read than `createElement` once there is a DOM.
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.{ts,tsx}',
      'services/*/test/**/*.test.ts',
    ],
    // Fixture repos under `test/fixtures/` carry their OWN test files — the
    // burn-cache probe fixtures exist precisely to be typechecked and tested by
    // their own toolchain (vitest 3, jest) inside a burn container. `include`
    // above reaches them, so they have to be excluded here or this suite tries
    // to run another project's tests with the wrong runner and no deps.
    exclude: [...configDefaults.exclude, '**/test/fixtures/**'],
    // Test-env firewall: strips inherited RUNCASTLE_* state before anything
    // imports core's paths, and swaps Bun's throwing `localStorage` placeholder
    // for a working in-memory one.
    setupFiles: ['./vitest.setup.ts'],
    // The git-heavy server tests each spawn dozens of `git` children (init,
    // config, add, commit, worktree add). Off win32 that is ~600–1100ms against
    // the 5s default — comfortable. On win32 every one of those spawns pays
    // process-creation plus on-access AV scanning of a fresh temp tree, and the
    // same cases have been observed timing out at 5s on a loaded dev machine
    // (docs/features/ux-issues/test-notes.md) with nothing wrong in them. Widen
    // the budget on win32 only, so POSIX and CI keep the tight guard that would
    // otherwise let a real hang through.
    ...(process.platform === 'win32' ? { testTimeout: 30_000, hookTimeout: 30_000 } : {}),
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
