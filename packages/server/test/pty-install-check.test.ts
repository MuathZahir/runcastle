import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNativePtySession } from '../src/pty/pty'
import {
  assertPtyInstalled,
  checkPtyInstall,
  ptyAddonName,
  type PtyInstallProbe,
} from '../src/pty/install-check'

/**
 * Install-completeness check for node-pty's native binary (issue #39).
 *
 * Where node-pty has no usable prebuild its install falls through to
 * `node-gyp rebuild` and — worse — a *second* `bun install` after a failure
 * exits 0 while the tree is still broken. Any check therefore must verify the
 * addon exists ON DISK, not trust the installer's exit code. These tests drive that check via injected
 * platform/arch/fs so they run identically on every OS.
 */

const has = (...present: string[]) => {
  const set = new Set(present)
  return (p: string) => set.has(p)
}

// Build expected paths with node:path.join so they match the source's own
// `join(ptyRoot, dir, ...)` on every host — Windows included (issue #54). Hard-
// coded '/'-separated literals only match on POSIX; the source is host-correct.
const linuxRoot = '/pkg/node-pty'
const bin = (dir: string) => join(linuxRoot, dir, 'pty.node')
const helper = (dir: string) => join(linuxRoot, dir, 'spawn-helper')
// node-pty 1.2 ships no pty.node for win32 — ConPTY is its only backend there.
const conpty = (dir: string) => join(linuxRoot, dir, 'conpty.node')

const probe = (over: Partial<PtyInstallProbe>): PtyInstallProbe => ({
  ptyRoot: linuxRoot,
  platform: 'linux',
  arch: 'x64',
  musl: false,
  exists: () => false,
  ...over,
})

describe('checkPtyInstall', () => {
  it('is ok when the linux prebuild (pty.node alone) is in place', () => {
    // Linux node-pty needs only pty.node — spawn-helper is macOS-only.
    const status = checkPtyInstall(probe({ exists: has(bin('prebuilds/linux-x64')) }))
    expect(status.ok).toBe(true)
    expect(status.binaryPath).toBe(bin('prebuilds/linux-x64'))
    expect(status.message).toBe('')
  })

  it('is ok when built from source into build/Release', () => {
    const status = checkPtyInstall(probe({ exists: has(bin('build/Release')) }))
    expect(status.ok).toBe(true)
    expect(status.binaryPath).toBe(bin('build/Release'))
  })

  it('probes build/Release, build/Debug then the platform prebuild, in that order', () => {
    const status = checkPtyInstall(probe({}))
    expect(status.checked).toEqual([
      'build/Release',
      'build/Debug',
      'prebuilds/linux-x64',
    ])
  })

  it('catches the lying retry: binary absent → not ok, with remediation', () => {
    const status = checkPtyInstall(probe({ exists: () => false }))
    expect(status.ok).toBe(false)
    expect(status.binaryPath).toBeNull()
    // Says what to do, not just "broken".
    expect(status.message).toMatch(/bun install/i)
    expect(status.message).toMatch(/pty\.node/)
  })

  it('on macOS requires spawn-helper next to pty.node, not just the addon', () => {
    const status = checkPtyInstall(
      probe({
        platform: 'darwin',
        arch: 'arm64',
        exists: has(bin('prebuilds/darwin-arm64')), // no spawn-helper
      }),
    )
    expect(status.ok).toBe(false)
    expect(status.message).toMatch(/spawn-helper/)
  })

  it('on linux does not require spawn-helper (macOS-only)', () => {
    const status = checkPtyInstall(probe({ exists: has(bin('prebuilds/linux-x64')) }))
    expect(status.ok).toBe(true)
  })

  it('on win32 looks for conpty.node and does not require spawn-helper', () => {
    const status = checkPtyInstall(
      probe({
        platform: 'win32',
        exists: has(conpty('prebuilds/win32-x64')),
      }),
    )
    expect(status.ok).toBe(true)
    expect(status.binaryPath).toBe(conpty('prebuilds/win32-x64'))
  })

  it('on win32 a lone pty.node is not an install', () => {
    const status = checkPtyInstall(
      probe({ platform: 'win32', exists: has(bin('prebuilds/win32-x64')) }),
    )
    expect(status.ok).toBe(false)
    expect(status.message).toMatch(/conpty.node/)
  })

  it('names the addon each platform loads', () => {
    expect(ptyAddonName('win32')).toBe('conpty.node')
    expect(ptyAddonName('linux')).toBe('pty.node')
    expect(ptyAddonName('darwin')).toBe('pty.node')
  })

  it('on musl/Alpine the glibc prebuild does not count — only a source build does', () => {
    // node-pty's install hook sees prebuilds/linux-x64 and skips the compile, so
    // on musl the unloadable glibc binary is exactly what is on disk.
    const prebuildOnly = checkPtyInstall(probe({ musl: true, exists: has(bin('prebuilds/linux-x64')) }))
    expect(prebuildOnly.ok).toBe(false)
    expect(prebuildOnly.checked).toEqual(['build/Release', 'build/Debug'])
    const built = checkPtyInstall(probe({ musl: true, exists: has(bin('build/Release')) }))
    expect(built.ok).toBe(true)
  })

  it('on musl/Alpine points at the compile fallback', () => {
    const status = checkPtyInstall(probe({ musl: true, exists: () => false }))
    expect(status.ok).toBe(false)
    expect(status.message).toMatch(/musl|Alpine/i)
    expect(status.message).toMatch(/build-base|python3|source/i)
    expect(status.message).toMatch(/npm_config_build_from_source=true/)
  })

  it('reports a clear message when node-pty itself is unresolvable', () => {
    const status = checkPtyInstall(probe({ ptyRoot: null }))
    expect(status.ok).toBe(false)
    expect(status.message).toMatch(/node-pty/)
    expect(status.message).toMatch(/bun install/i)
  })
})

describe('assertPtyInstalled', () => {
  it('throws the remediation message when the binary is missing', () => {
    expect(() => assertPtyInstalled(probe({ exists: () => false }))).toThrow(/pty\.node/)
  })

  it('does not throw when the binary is present', () => {
    expect(() =>
      assertPtyInstalled(
        probe({ exists: has(bin('build/Release'), helper('build/Release')) }),
      ),
    ).not.toThrow()
  })
})

describe('checkPtyInstall against the real install', () => {
  /** Whether the native addon actually loads in this runtime. */
  const nativeLoads = (() => {
    try {
      createNativePtySession(process.platform === 'win32' ? 'cmd.exe' : 'sh', [], {
        cwd: process.cwd(),
        env: process.env,
      }).kill()
      return true
    } catch {
      return false
    }
  })()

  it('agrees with whether node-pty can actually load', () => {
    // The check and the real loader must never disagree: if node-pty loads, the
    // check must say ok; the whole point is to detect a broken tree, not invent one.
    const status = checkPtyInstall()
    if (nativeLoads) {
      expect(status.ok).toBe(true)
      expect(status.binaryPath).not.toBeNull()
    }
  })
})
