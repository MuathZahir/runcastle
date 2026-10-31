import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { usePipePty } from './helpers/pipe-pty'
import { ptyRegistry, type TerminalSink } from '../src/pty/registry'
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
 * The pure helpers are unit-tested; start/stop are exercised against the pipe
 * stand-in, since vitest runs on node. The shipped terminal's own tree kill is in
 * `pty-bun.test.ts` and `dev-pane-stop-bun.test.ts`.
 */

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

usePipePty()
const AVAILABLE = process.platform !== 'win32'
const WIN_AVAILABLE = process.platform === 'win32'

/** True while `pid` is still a live process (Windows-safe existence probe). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * True while any member of POSIX process group `pgid` is still running. Not
 * `kill -0 -pgid`: that succeeds on zombies, and a killed member stays a zombie
 * until init reaps it — which a container whose PID 1 is not a real init (a
 * `sleep`, say) never does, so the group reads as alive long after it died.
 */
function groupHasLiveMember(pgid: number): boolean {
  return execFileSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .some(([group, stat]) => Number(group) === pgid && !stat?.startsWith('Z'))
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

  it('keeps the port when the dev server bolds it (Vite)', () => {
    const out =
      '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m33113\x1b[22m/\x1b[39m'
    expect(sniffDevUrl(out)).toBe('http://localhost:33113/')
    expect(sniffDevUrl('\x1b[1mhttp://127.0.0.1:\x1b[1m4000\x1b[22m\x1b[0m')).toBe(
      'http://127.0.0.1:4000',
    )
  })

  it('sees through OSC-8 hyperlink wrappers', () => {
    const st = '\x1b\\'
    expect(sniffDevUrl(`\x1b]8;;http://localhost:5173/${st}http://localhost:5173/\x1b]8;;${st}`)).toBe(
      'http://localhost:5173/',
    )
    expect(sniffDevUrl('\x1b]8;;http://localhost:5173/\x07http://localhost:5173/\x1b]8;;\x07')).toBe(
      'http://localhost:5173/',
    )
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

    // No member of the process group (shell + the backgrounded sleep) may still
    // be running; unreaped zombies are dead and do not count.
    expect(groupHasLiveMember(pgid)).toBe(false)
  }, 15000)
})

/**
 * The Windows half of the tree kill. `devSpawnTarget` always interposes a
 * `cmd.exe /d /s /c` shim there, so the dev server is a GRANDCHILD of the PTY:
 * ConPTY teardown reaps the shim and leaves the server holding its port and its
 * file locks. The POSIX group-kill path is covered by the suite above.
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN HERE. This suite runs under NODE — vitest's
 * runtime — and therefore does NOT exercise the runtime production uses. The
 * runtime was the variable: every case below was GREEN throughout the period when stopping a drive on Windows
 * hung forever in production (preparation-bug), because `promisify(execFile)` settles
 * fine under node and never settled under Bun. A green run here is evidence about
 * node only. The production runtime is covered by `dev-pane-stop-bun.test.ts`, which
 * drives this same path from inside a real Bun process.
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
})
