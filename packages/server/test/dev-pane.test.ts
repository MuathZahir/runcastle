import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNativePtySession } from '../src/pty/pty'
import { ptyRegistry, type TerminalSink } from '../src/pty/registry'
import {
  devSpawnTarget,
  drivePaneId,
  isDrivePaneId,
  sniffDevUrl,
  startDevPane,
  type StartDevPaneInput,
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
  const { file, args } = devSpawnTarget(process.platform === 'win32' ? 'rem' : 'true')
  try {
    const p = createNativePtySession(file, args, { cwd: process.cwd(), env: process.env })
    p.kill()
    return true
  } catch {
    return false
  }
}
const AVAILABLE = process.platform !== 'win32' && ptyAvailable()
const WIN_AVAILABLE = process.platform === 'win32' && ptyAvailable()

/** True while `pid` is still a live process (Windows-safe existence probe). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

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

/**
 * The teardown suites below are gated on a working PTY. On win32 that gate must
 * never swallow a broken install: node-pty ships its Windows prebuild in the
 * tarball, so a probe that fails there is a broken install, not an unsupported
 * platform — and a silent skip is exactly how the Windows tree-kill regression
 * test went unrun on every machine. CI without Linux prebuilds stays a legitimate
 * skip, so this only speaks for win32.
 */
describe('PTY availability', () => {
  it('can spawn a PTY on Windows (a failed probe means a broken node-pty install)', () => {
    if (process.platform !== 'win32') return
    expect(
      WIN_AVAILABLE,
      'node-pty could not spawn a PTY on win32 — a broken install, not an unsupported ' +
        'platform. The stopDevPane teardown tests would silently skip.',
    ).toBe(true)
  })
})

describe.skipIf(!AVAILABLE)('startDevPane / stopDevPane', () => {
  afterEach(async () => {
    // Best-effort: never leave a drive pane running between cases.
    for (const id of ptyRegistry().ids()) if (isDrivePaneId(id)) await stopDevPane(id)
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

    await stopDevPane(paneId!)
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

    await stopDevPane(paneId)
    await delay(400)

    // The process group must be gone — `kill -0 -pgid` throws ESRCH once every
    // member (shell + the backgrounded sleep) has been reaped.
    expect(pidAlive(-pgid)).toBe(false)
  }, 15000)
})

/**
 * The Windows half of the tree kill. `devSpawnTarget` always interposes a
 * `cmd.exe /d /s /c` shim there, so the dev server is a GRANDCHILD of the PTY:
 * ConPTY teardown reaps the shim and leaves the server holding its port and its
 * file locks. The POSIX group-kill path is covered by the suite above.
 */
describe.skipIf(!WIN_AVAILABLE)('stopDevPane on Windows', () => {
  const dirs: string[] = []

  afterEach(async () => {
    for (const id of ptyRegistry().ids()) if (isDrivePaneId(id)) await stopDevPane(id)
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  /**
   * A scratch dir holding a long-lived node script that stands in for the dev
   * server. The pane runs it from its own cwd so neither the script's path nor
   * node's needs quoting through `cmd /c` — both routinely contain spaces here.
   */
  function grandchildDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rc-devpane-'))
    dirs.push(dir)
    writeFileSync(
      join(dir, 'grandchild.mjs'),
      "console.log('GRANDCHILD ' + process.pid)\nsetInterval(() => {}, 1000)\n",
    )
    return dir
  }

  /** `node` resolves whichever way the suite was invoked (vitest runs under it). */
  const paneEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
  })

  /** The pid the pane's grandchild announces on stdout, once it is up. */
  async function readGrandchildPid(paneId: string): Promise<number> {
    let out = ''
    const reader: TerminalSink = {
      sendData(chunk) {
        out += chunk.toString('utf8')
      },
      sendControl() {},
    }
    ptyRegistry().attach(paneId, reader)

    let pid: number | undefined
    for (let i = 0; i < 60 && pid === undefined; i++) {
      await delay(250)
      pid = Number(out.match(/GRANDCHILD (\d+)/)?.[1]) || undefined
    }
    expect(pid, `no grandchild pid in pane output: ${JSON.stringify(out)}`).toBeDefined()
    return pid!
  }

  /** Put an env var back where it was — deleted if it was unset (never "undefined"). */
  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  /**
   * Start a pane on the SIDECAR backend and report the pid of the node host it
   * spawned. Both env overrides are read at spawn time and restored immediately
   * after, so only this pane takes the detour; `process.execPath` is a real node
   * because vitest runs under one.
   */
  function startSidecarPane(input: StartDevPaneInput): { paneId: string; hostPid: number } {
    const prevBackend = process.env.RUNCASTLE_PTY_BACKEND
    const prevNodeBin = process.env.RUNCASTLE_NODE_BIN
    try {
      process.env.RUNCASTLE_PTY_BACKEND = 'sidecar'
      process.env.RUNCASTLE_NODE_BIN = process.execPath
      const paneId = startDevPane(input)!
      // Read on THIS tick: `pty.pid` is the host's own pid only until the host's
      // async `ready` frame arrives and replaces it with node-pty's inner pid.
      return { paneId, hostPid: ptyRegistry().get(paneId)!.pty.pid }
    } finally {
      restoreEnv('RUNCASTLE_PTY_BACKEND', prevBackend)
      restoreEnv('RUNCASTLE_NODE_BIN', prevNodeBin)
    }
  }

  /** Wait out the lag between taskkill signalling a tree and Windows reaping it. */
  async function awaitDeath(pid: number): Promise<void> {
    for (let i = 0; i < 20 && pidAlive(pid); i++) await delay(250)
  }

  it('kills the grandchild behind the cmd shim, not just the shim', async () => {
    const ctx = await makeTestCtx()
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'wintree' })

    const paneId = startDevPane({
      ctx,
      scope: { featureId: feature.id },
      repoPath: grandchildDir(),
      devCommand: 'node grandchild.mjs',
      env: paneEnv(),
      onUrl: () => {},
    })!

    const pid = await readGrandchildPid(paneId)
    expect(pidAlive(pid)).toBe(true)

    await stopDevPane(paneId)

    await awaitDeath(pid)
    expect(pidAlive(pid)).toBe(false)
  }, 45000)

  /**
   * The same scenario on the backend PRODUCTION actually runs. Bun+win32 selects
   * the sidecar, but vitest runs under node — so the native test above was never
   * the leaking path. Forcing the sidecar puts a node host between the server and
   * node-pty: the tree to kill is rooted at that host, and the pid the server
   * used to taskkill (`pty.pid`) is swapped to node-pty's inner pid the moment
   * the host's async `ready` frame lands.
   */
  it('kills the sidecar host and its grandchild — the backend production runs', async () => {
    const ctx = await makeTestCtx()
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'winsidecar' })

    const { paneId, hostPid } = startSidecarPane({
      ctx,
      scope: { featureId: feature.id },
      repoPath: grandchildDir(),
      devCommand: 'node grandchild.mjs',
      env: paneEnv(),
      onUrl: () => {},
    })
    expect(hostPid).toBeGreaterThan(0)

    const pid = await readGrandchildPid(paneId)
    expect(pidAlive(pid)).toBe(true)
    expect(pidAlive(hostPid)).toBe(true)

    await stopDevPane(paneId)

    await awaitDeath(pid)
    await awaitDeath(hostPid)
    expect(pidAlive(pid), 'dev server grandchild survived the stop').toBe(false)
    expect(pidAlive(hostPid), 'sidecar host survived the stop').toBe(false)
    expect(ptyRegistry().has(paneId)).toBe(false)
  }, 45000)
})
