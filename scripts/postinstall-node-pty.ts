/**
 * Root `postinstall` — the Linux prebuild bridge for node-pty (issue #39).
 *
 * Root lifecycle scripts always run, so this runs on every `bun install`. On glibc
 * Linux it copies the vendored `pty.node` (committed under
 * `vendor/node-pty/linux-<arch>/`) into the resolved node-pty package's
 * `prebuilds/linux-<arch>/` — the loader's search path — because node-pty 1.1.0
 * ships no linux prebuild and its compile-from-source `install` hook is rewritten
 * to a no-op via a `patchedDependencies` patch (`patches/node-pty@1.1.0.patch`).
 * No-op on Windows/macOS (their prebuilds ship in the tarball) and on musl/Alpine
 * (a glibc prebuild can't load there — build from source instead). Never fails the
 * install: a thrown postinstall aborts it.
 *
 * All real logic lives in `applyLinuxPrebuildBridge` (unit-tested with injected
 * fs); this wrapper only wires in the real fs, paths, and musl detection.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyLinuxPrebuildBridge } from '../packages/server/src/pty/prebuild-bridge.ts'
import { detectMusl, resolvePtyRoot } from '../packages/server/src/pty/install-check.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorRoot = join(repoRoot, 'vendor', 'node-pty')

try {
  const result = applyLinuxPrebuildBridge({
    vendorRoot,
    ptyRoot: resolvePtyRoot(),
    musl: detectMusl(),
    fs: { existsSync, mkdirSync, copyFileSync, chmodSync },
  })
  const loud = result.action === 'copied' || result.action.startsWith('skipped-no')
  // Copies and real gaps get a line; silent skips (not-linux/musl/idempotent) stay quiet.
  if (loud) console.log(`[node-pty bridge] ${result.message}`)
} catch (err) {
  // Must never abort `bun install` — the completeness check (checkPtyInstall)
  // surfaces a missing binary later with remediation.
  console.warn(
    `[node-pty bridge] skipped after an unexpected error (install continues): ${
      err instanceof Error ? err.message : String(err)
    }`,
  )
}
