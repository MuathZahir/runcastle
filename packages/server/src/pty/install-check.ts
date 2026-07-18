import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Install-completeness check for node-pty's native binary (issue #39).
 *
 * WHY THIS EXISTS. node-pty ships prebuilt addons for darwin + win32 but **no
 * `linux-*` prebuild**, so on stock glibc Linux its install hook
 * (`node scripts/prebuild.js || node-gyp rebuild`) falls through to compiling
 * from source — which needs a C++ toolchain and node ≥22. The prebuild bridge
 * (`patches/node-pty@1.1.0.patch` + `patchedDependencies`) drops a vendored
 * linux prebuild into place *before* that hook runs so the compile never fires.
 *
 * WHY A DISK CHECK, NOT AN EXIT CODE. A second `bun install` after a failed one
 * exits **0** ("no changes") while the tree is still missing `pty.node` — the
 * retry lies. So doctor / first-run must verify the binary exists ON DISK, which
 * is what {@link checkPtyInstall} does. It mirrors node-pty's own loader
 * (`lib/utils.js`): probe `build/Release`, `build/Debug`, then
 * `prebuilds/<platform>-<arch>`. On **macOS** it also requires the `spawn-helper`
 * executable alongside the addon — but only there: node-pty's native `fork` uses
 * the helper solely under `#if defined(__APPLE__)` (`src/unix/pty.cc`), and the
 * spawn-helper build target is gated to `OS=="mac"` (`binding.gyp`), so Linux
 * ships and needs `pty.node` alone.
 */

/** Where node-pty's loader looks for its addon, in order (`lib/utils.js`). */
const CANDIDATE_DIRS = ['build/Release', 'build/Debug'] as const

export interface PtyInstallStatus {
  /** True when the native addon (and, on unix, `spawn-helper`) is on disk. */
  ok: boolean
  platform: NodeJS.Platform
  arch: string
  /** Absolute path to the resolved `pty.node`, or null when unresolved. */
  binaryPath: string | null
  /** Relative dirs probed, in loader order — for diagnostics. */
  checked: string[]
  /** Human-facing remediation; empty string when {@link ok}. */
  message: string
}

export interface PtyInstallProbe {
  /** node-pty package root; `undefined` = resolve the real install, `null` = unresolvable. */
  ptyRoot?: string | null
  platform?: NodeJS.Platform
  arch?: string
  /** True on musl/Alpine, where the glibc prebuild won't load. Defaults to runtime detection. */
  musl?: boolean
  /** Absolute-path predicate; defaults to `fs.existsSync`. Injected in tests. */
  exists?: (path: string) => boolean
}

/**
 * musl libc can't load a glibc prebuild, so the bridge doesn't help there and
 * the fix is a source rebuild. `process.report` exposes the runtime glibc
 * version on glibc systems and omits it on musl; Alpine's marker file is the
 * belt-and-braces fallback.
 */
function detectMusl(): boolean {
  if (process.platform !== 'linux') return false
  try {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined
    if (report?.header && !report.header.glibcVersionRuntime) return true
  } catch {
    // process.report unavailable — fall through to the file probe.
  }
  return existsSync('/etc/alpine-release')
}

/** Resolve node-pty's package root via its manifest, or null if not installed. */
function resolvePtyRoot(): string | null {
  try {
    const require = createRequire(import.meta.url)
    return dirname(require.resolve('node-pty/package.json'))
  } catch {
    return null
  }
}

function remediation(
  platform: NodeJS.Platform,
  arch: string,
  musl: boolean,
  checked: string[],
): string {
  const where = checked.join(', ')
  if (musl) {
    return (
      "node-pty's native binary (pty.node) is missing and this is a musl/Alpine " +
      'system, where the vendored glibc prebuild cannot load. Install a build ' +
      'toolchain and rebuild from source: `apk add build-base python3` then ' +
      '`bun install` (see docs/research/POSIX-VERIFICATION.md, musl fallback).'
    )
  }
  return (
    `node-pty's native binary (pty.node) is missing for ${platform}-${arch} ` +
    `(looked in: ${where}). The embedded terminal will not work. Re-run ` +
    '`bun install` — the linux prebuild bridge should place it before node-pty ' +
    "builds. If it still fails you're likely without a C++ toolchain or on node " +
    '<22; see docs/research/POSIX-VERIFICATION.md.'
  )
}

/**
 * Check whether node-pty's native binary is installed and loadable-by-path.
 * Pure given its options — {@link PtyInstallProbe} injects platform/arch/fs so
 * the same logic is exercised on every OS. Called with no args it inspects the
 * real install in the current runtime.
 */
export function checkPtyInstall(probe: PtyInstallProbe = {}): PtyInstallStatus {
  const platform = probe.platform ?? process.platform
  const arch = probe.arch ?? process.arch
  const musl = probe.musl ?? detectMusl()
  const exists = probe.exists ?? existsSync
  const ptyRoot = probe.ptyRoot === undefined ? resolvePtyRoot() : probe.ptyRoot

  const checked = [...CANDIDATE_DIRS, `prebuilds/${platform}-${arch}`]

  if (ptyRoot === null) {
    return {
      ok: false,
      platform,
      arch,
      binaryPath: null,
      checked,
      message:
        'node-pty is not installed (its package could not be resolved). Run `bun install`.',
    }
  }

  // spawn-helper is only forked on macOS (src/unix/pty.cc, `#if __APPLE__`);
  // Linux and win32 need the addon alone.
  const needsHelper = platform === 'darwin'
  for (const dir of checked) {
    const binaryPath = join(ptyRoot, dir, 'pty.node')
    if (!exists(binaryPath)) continue
    if (needsHelper && !exists(join(ptyRoot, dir, 'spawn-helper'))) {
      return {
        ok: false,
        platform,
        arch,
        binaryPath: null,
        checked,
        message:
          `node-pty's addon is at ${binaryPath} but its spawn-helper is missing ` +
          'from the same dir — a partial install. Re-run `bun install`.',
      }
    }
    return { ok: true, platform, arch, binaryPath, checked, message: '' }
  }

  return {
    ok: false,
    platform,
    arch,
    binaryPath: null,
    checked,
    message: remediation(platform, arch, musl, checked),
  }
}

/**
 * Throw {@link checkPtyInstall}'s remediation message unless the binary is
 * present. For call sites that want a hard gate (doctor `--strict`, boot preflight).
 */
export function assertPtyInstalled(probe?: PtyInstallProbe): void {
  const status = checkPtyInstall(probe)
  if (!status.ok) throw new Error(status.message)
}
