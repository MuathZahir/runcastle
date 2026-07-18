import { describe, expect, it } from 'vitest'
import {
  applyLinuxPrebuildBridge,
  type PrebuildBridgeFs,
  type PrebuildBridgeOptions,
} from '../src/pty/prebuild-bridge'

/**
 * Root-postinstall Linux prebuild bridge (issue #39).
 *
 * node-pty 1.1.0 ships no `linux-*` prebuild and its `install` hook is neutralised
 * to a no-op (a `patchedDependencies` patch rewrites node-pty's `install` script),
 * so nothing lands `pty.node` on Linux. The root `postinstall` calls
 * {@link applyLinuxPrebuildBridge} to copy the
 * vendored binary into node-pty's `prebuilds/linux-<arch>/` — the loader's search
 * path — before first use. It must: act only on glibc Linux, be idempotent, and
 * never explode (a thrown postinstall aborts `bun install`). These tests inject
 * platform/arch/fs so the branches run identically on every OS.
 */

const VENDOR = '/repo/vendor/node-pty'
const PTY = '/pkg/node-pty'
const vendored = (arch: string) => `${VENDOR}/linux-${arch}/pty.node`
const target = (arch: string) => `${PTY}/prebuilds/linux-${arch}/pty.node`

/** A recording fake fs seeded with a set of already-present paths. */
function fakeFs(present: string[] = []): PrebuildBridgeFs & {
  copies: Array<{ from: string; to: string }>
  dirs: string[]
} {
  const set = new Set(present)
  const copies: Array<{ from: string; to: string }> = []
  const dirs: string[] = []
  return {
    copies,
    dirs,
    existsSync: (p) => set.has(p),
    mkdirSync: (p) => {
      dirs.push(p)
    },
    copyFileSync: (from, to) => {
      copies.push({ from, to })
      set.add(to)
    },
    chmodSync: () => {},
  }
}

const opts = (over: Partial<PrebuildBridgeOptions>): PrebuildBridgeOptions => ({
  platform: 'linux',
  arch: 'x64',
  musl: false,
  vendorRoot: VENDOR,
  ptyRoot: PTY,
  fs: fakeFs([vendored('x64')]),
  ...over,
})

describe('applyLinuxPrebuildBridge', () => {
  it('copies the vendored binary into node-pty prebuilds on glibc linux-x64', () => {
    const fs = fakeFs([vendored('x64')])
    const res = applyLinuxPrebuildBridge(opts({ fs }))
    expect(res.action).toBe('copied')
    expect(res.from).toBe(vendored('x64'))
    expect(res.to).toBe(target('x64'))
    expect(fs.copies).toEqual([{ from: vendored('x64'), to: target('x64') }])
    expect(fs.dirs).toContain(`${PTY}/prebuilds/linux-x64`)
  })

  it('resolves the vendored/target dir by the running arch (arm64)', () => {
    const fs = fakeFs([vendored('arm64')])
    const res = applyLinuxPrebuildBridge(opts({ arch: 'arm64', fs }))
    expect(res.action).toBe('copied')
    expect(res.from).toBe(vendored('arm64'))
    expect(res.to).toBe(target('arm64'))
  })

  it('is idempotent: no copy when the binary is already in prebuilds', () => {
    const fs = fakeFs([vendored('x64'), target('x64')])
    const res = applyLinuxPrebuildBridge(opts({ fs }))
    expect(res.action).toBe('already-present')
    expect(fs.copies).toEqual([])
  })

  it('no-ops on macOS (its prebuilds ship in the tarball)', () => {
    const fs = fakeFs([vendored('x64')])
    const res = applyLinuxPrebuildBridge(opts({ platform: 'darwin', arch: 'arm64', fs }))
    expect(res.action).toBe('skipped-not-linux')
    expect(fs.copies).toEqual([])
  })

  it('no-ops on Windows', () => {
    const fs = fakeFs([vendored('x64')])
    const res = applyLinuxPrebuildBridge(opts({ platform: 'win32', fs }))
    expect(res.action).toBe('skipped-not-linux')
    expect(fs.copies).toEqual([])
  })

  it('skips musl/Alpine and points at the source-build fallback', () => {
    const fs = fakeFs([vendored('x64')])
    const res = applyLinuxPrebuildBridge(opts({ musl: true, fs }))
    expect(res.action).toBe('skipped-musl')
    expect(res.message).toMatch(/musl|Alpine/i)
    expect(res.message).toMatch(/build-base|source/i)
    expect(fs.copies).toEqual([])
  })

  it('skips (with guidance) when no vendored binary exists for the arch', () => {
    // e.g. linux-arm64 was never vendored — don't fail the install, report it.
    const fs = fakeFs([]) // nothing vendored
    const res = applyLinuxPrebuildBridge(opts({ arch: 'arm64', fs }))
    expect(res.action).toBe('skipped-no-vendor')
    expect(res.message).toMatch(/arm64/)
    expect(fs.copies).toEqual([])
  })

  it('skips cleanly when node-pty is not resolvable', () => {
    const fs = fakeFs([vendored('x64')])
    const res = applyLinuxPrebuildBridge(opts({ ptyRoot: null, fs }))
    expect(res.action).toBe('skipped-no-pty')
    expect(fs.copies).toEqual([])
  })
})
