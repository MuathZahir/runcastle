import { join } from 'node:path'

/**
 * Linux prebuild bridge for node-pty (issue #39), run from the ROOT `postinstall`.
 *
 * WHY. node-pty 1.1.0 ships prebuilt addons for darwin + win32 but **no `linux-*`
 * prebuild**, so on Linux its `install` hook (`node scripts/prebuild.js ||
 * node-gyp rebuild`) falls through to compiling from source — needing a C++
 * toolchain and node ≥22. We neutralise that hook with a bun `patchedDependencies`
 * patch (`patches/node-pty@1.1.0.patch`) that rewrites node-pty's `install` script
 * to a no-op (`node -e "process.exit(0)"`). Nothing then lands `pty.node` on Linux
 * — so this bridge copies a vendored binary into node-pty's `prebuilds/linux-<arch>/`,
 * exactly where its runtime loader looks (`build/Release` →
 * `prebuilds/<platform>-<arch>`), before first use.
 *
 * WHY A NO-OP, NOT A DELETED SCRIPT. Removing the `install` key entirely does NOT
 * disable the hook: node-pty ships a `binding.gyp`, and bun (like npm) falls back
 * to an *implicit* `node-gyp rebuild` for gyp packages that declare no install
 * script — so a toolchain-less install still aborts. Replacing the script with an
 * explicit no-op is what actually stops the compile, on every platform (on
 * win/mac the original hook was already a no-op — its prebuild ships in the tarball).
 *
 * WHY A ROOT postinstall for the copy (not the dependency's, not the patch itself).
 * Root lifecycle scripts always run. Bun's `patchedDependencies` cannot *create* a
 * new directory (`prebuilds/linux-x64/`) inside an installed package (bun
 * #13770/#22137), so the patch can only edit node-pty's existing `package.json`;
 * the actual binary copy has to happen from the root postinstall.
 *
 * This function is pure given its options — {@link PrebuildBridgeOptions} injects
 * platform/arch/musl/fs — so every branch is unit-testable on any OS. It must
 * never throw: a postinstall that throws aborts `bun install`.
 *
 * RETIREMENT. node-pty 1.2 is expected to ship `linux-*` prebuilds. When bumping
 * to it, delete this bridge, the vendored binaries, and the `patchedDependencies`
 * patch, confirm `bun install` still lands `pty.node` on stock glibc, and
 * re-verify the Windows sidecar path (`pty-sidecar.ts`).
 */

/** The `fs` surface the bridge needs; injected in tests, `node:fs` at runtime. */
export interface PrebuildBridgeFs {
  existsSync: (path: string) => boolean
  mkdirSync: (path: string, opts: { recursive: boolean }) => void
  copyFileSync: (src: string, dest: string) => void
  chmodSync: (path: string, mode: number) => void
}

export interface PrebuildBridgeOptions {
  platform?: NodeJS.Platform
  arch?: string
  /** True on musl/Alpine, where a glibc prebuild won't load. Default: false. */
  musl?: boolean
  /** Repo dir holding vendored binaries at `<vendorRoot>/linux-<arch>/pty.node`. */
  vendorRoot: string
  /** Resolved node-pty package root; `null` when it can't be resolved. */
  ptyRoot: string | null
  fs: PrebuildBridgeFs
}

export type PrebuildBridgeAction =
  | 'copied'
  | 'already-present'
  | 'skipped-not-linux'
  | 'skipped-musl'
  | 'skipped-no-vendor'
  | 'skipped-no-pty'

export interface PrebuildBridgeResult {
  action: PrebuildBridgeAction
  /** Vendored source path, when an arch was resolved. */
  from?: string
  /** node-pty prebuilds destination, when an arch was resolved. */
  to?: string
  message: string
}

/**
 * Copy the vendored `pty.node` for the running glibc-Linux arch into node-pty's
 * `prebuilds/linux-<arch>/`, idempotently. No-op everywhere else. Never throws.
 */
export function applyLinuxPrebuildBridge(opts: PrebuildBridgeOptions): PrebuildBridgeResult {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const { fs, vendorRoot, ptyRoot } = opts

  if (platform !== 'linux') {
    return {
      action: 'skipped-not-linux',
      message: `not linux (${platform}) — node-pty's own prebuild ships in the tarball; nothing to bridge`,
    }
  }

  if (opts.musl) {
    return {
      action: 'skipped-musl',
      message:
        'musl/Alpine detected — the vendored glibc prebuild cannot load here. Install a ' +
        'build toolchain and rebuild node-pty from source: `apk add build-base python3` ' +
        'then `bun install` (see docs/research/POSIX-VERIFICATION.md, musl fallback).',
    }
  }

  if (ptyRoot === null) {
    return {
      action: 'skipped-no-pty',
      message: 'node-pty could not be resolved — skipping the prebuild bridge. Run `bun install`.',
    }
  }

  const from = join(vendorRoot, `linux-${arch}`, 'pty.node')
  const to = join(ptyRoot, 'prebuilds', `linux-${arch}`, 'pty.node')

  if (!fs.existsSync(from)) {
    return {
      action: 'skipped-no-vendor',
      from,
      to,
      message:
        `no vendored linux-${arch} pty.node at ${from} — node-pty's native binary will be ` +
        `absent for linux-${arch}. Build one on a linux-${arch} host with ` +
        '`bun scripts/vendor-node-pty-prebuilds.ts` and commit it, or install a toolchain ' +
        'and rebuild from source. The embedded terminal will not work until then.',
    }
  }

  if (fs.existsSync(to)) {
    return {
      action: 'already-present',
      from,
      to,
      message: `node-pty linux-${arch} prebuild already in place at ${to}`,
    }
  }

  fs.mkdirSync(join(ptyRoot, 'prebuilds', `linux-${arch}`), { recursive: true })
  fs.copyFileSync(from, to)
  fs.chmodSync(to, 0o755)
  return {
    action: 'copied',
    from,
    to,
    message: `bridged node-pty linux-${arch} prebuild: ${from} -> ${to}`,
  }
}
