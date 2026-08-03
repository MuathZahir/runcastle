import { afterEach, describe, expect, it } from 'vitest'
import { createNativePtySession } from '../src/pty/pty'
import { ptyRegistry } from '../src/pty/registry'
import {
  devSpawnTarget,
  drivePaneId,
  isDrivePaneId,
  sniffDevUrl,
  startDevPane,
  stopDevPane,
} from '../src/pty/dev-pane'
import { listAfter } from '../src/services/events'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Test-drive dev pane (issue #41): the non-session PTY id, the localhost URL
 * sniffer, the generalized shell/cmd shim, and the process-tree kill on stop.
 * The pure helpers are unit-tested; start/stop are exercised against a real PTY
 * (gated on the native node-pty addon loading in this runtime).
 */

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Probe whether node-pty can spawn here (CI without prebuilds cannot). */
function ptyAvailable(): boolean {
  try {
    const p = createNativePtySession('/bin/sh', ['-c', 'true'], { cwd: process.cwd(), env: process.env })
    p.kill()
    return true
  } catch {
    return false
  }
}
const AVAILABLE = process.platform !== 'win32' && ptyAvailable()

describe('drivePaneId', () => {
  it('is a non-session id (no sess_ prefix) so session guards never see it', () => {
    const id = drivePaneId('feat_abc')
    expect(id).toBe('drive:feat_abc')
    expect(id.startsWith('sess_')).toBe(false)
    expect(isDrivePaneId(id)).toBe(true)
    expect(isDrivePaneId('sess_xyz')).toBe(false)
  })
})

describe('sniffDevUrl', () => {
  it('finds the first localhost URL a dev server prints', () => {
    expect(sniffDevUrl('  ➜  Local:   http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(sniffDevUrl('now listening on http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(sniffDevUrl('serving at https://localhost:8443/app')).toBe('https://localhost:8443/app')
    expect(sniffDevUrl('ipv6 http://[::1]:4000/')).toBe('http://[::1]:4000/')
  })

  it('ignores network/LAN URLs and non-matching output', () => {
    expect(sniffDevUrl('  ➜  Network: http://192.168.1.20:5173/')).toBeUndefined()
    expect(sniffDevUrl('compiled successfully')).toBeUndefined()
    expect(sniffDevUrl('')).toBeUndefined()
  })

  it('returns the localhost URL even when a network URL precedes it in the buffer', () => {
    const out = 'Network: http://10.0.0.5:5173/\nLocal:   http://localhost:5173/\n'
    expect(sniffDevUrl(out)).toBe('http://localhost:5173/')
  })

  it('strips a trailing ANSI colour reset butted directly against the URL', () => {
    const out = '\x1b[32m  ➜  Local:\x1b[39m   \x1b[1mhttp://localhost:5173/\x1b[22m'
    expect(sniffDevUrl(out)).toBe('http://localhost:5173/')
  })

  it('strips a trailing OSC-8 hyperlink terminator butted directly against the URL', () => {
    const out = '\x1b]8;;http://localhost:3000/\x1b\\http://localhost:3000/\x1b]8;;\x1b\\'
    expect(sniffDevUrl(out)).toBe('http://localhost:3000/')
  })
})

describe('devSpawnTarget', () => {
  it('runs POSIX dev commands through /bin/sh -c (shell hosts the tree)', () => {
    if (process.platform === 'win32') return
    expect(devSpawnTarget('npm run dev')).toEqual({ file: '/bin/sh', args: ['-c', 'npm run dev'] })
  })

  it('runs Windows dev commands through the generalized cmd shim', () => {
    if (process.platform !== 'win32') return
    const t = devSpawnTarget('npm run dev')
    expect(t.file.toLowerCase()).toContain('cmd')
    expect(t.args).toEqual(['/d', '/s', '/c', 'npm run dev'])
  })
})

describe.skipIf(!AVAILABLE)('startDevPane / stopDevPane', () => {
  afterEach(() => {
    // Best-effort: never leave a drive pane running between cases.
    for (const id of ptyRegistry().ids()) if (isDrivePaneId(id)) stopDevPane(id)
  })

  it('spawns under a non-session id, sniffs the localhost URL, then tree-kills on stop', async () => {
    const ctx = await makeTestCtx()
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'dp' })

    let url: string | undefined
    const paneId = startDevPane({
      ctx,
      scope: { featureId: feature.id },
      repoPath: process.cwd(),
      // Print a Vite-style local URL, then idle so the pane stays live to kill.
      devCommand: 'echo "  Local:   http://localhost:5173/"; sleep 30',
      onUrl: (u) => {
        url = u
      },
    })

    expect(paneId).toBe(drivePaneId(feature.id))
    expect(ptyRegistry().has(paneId!)).toBe(true)

    // Give the shell a beat to print the line and the sniffer to catch it.
    await delay(1200)
    expect(url).toBe('http://localhost:5173/')
    expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain('testdrive.dev_started')

    stopDevPane(paneId!)
    expect(ptyRegistry().has(paneId!)).toBe(false)
  }, 15000)

  it('kills the child process tree so the port-holder is not orphaned', async () => {
    const ctx = await makeTestCtx()
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'tree' })

    const paneId = startDevPane({
      ctx,
      scope: { featureId: feature.id },
      repoPath: process.cwd(),
      // A child `sleep` in the same process group stands in for `npm → node`.
      devCommand: 'sleep 300 & echo child $!; wait',
      onUrl: () => {},
    })!
    await delay(600)
    const entry = ptyRegistry().get(paneId)!
    const pgid = entry.pty.pid

    stopDevPane(paneId)
    await delay(400)

    // The process group must be gone — `kill -0 -pgid` throws ESRCH once every
    // member (shell + the backgrounded sleep) has been reaped.
    let groupAlive = true
    try {
      process.kill(-pgid, 0)
    } catch {
      groupAlive = false
    }
    expect(groupAlive).toBe(false)
  }, 15000)
})
