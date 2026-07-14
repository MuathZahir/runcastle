import { describe, expect, it } from 'vitest'
import { createNativePtySession, createPtySession, type PtySession } from '../src/pty/pty'
import { createSidecarPtySession } from '../src/pty/pty-sidecar'
import { ptyRegistry, type ControlFrame } from '../src/pty/registry'
import { RingBuffer } from '../src/pty/ring-buffer'

/**
 * PTY layer unit test (task item 6). Covers, per backend:
 *  1. a real spawn + OUTPUT roundtrip + exit code,
 *  2. a WRITE→ECHO roundtrip (regression guard for the bug where INPUT was dead:
 *     keystrokes never reached the process). We spawn an interactive shell, write
 *     `echo <marker>`, and assert the echoed marker comes back out — output alone
 *     is not enough, the earlier unit test only did `cmd /c echo` (no stdin write)
 *     so the broken write path was never exercised,
 *  3. kill of a long-lived process,
 *  4. ring-buffer replay through the registry.
 *
 * Two backends are exercised: `native` (in-process node-pty — what runs off-win32
 * and under this node/vitest runtime) and `sidecar` (node-pty hosted in a system
 * `node` child — what ships under Bun on win32, where the native write path throws
 * `ERR_SOCKET_CLOSED`). Both must pass the WRITE→ECHO assertion. Cases skip
 * gracefully where the native addon cannot load (CI without prebuilds).
 */

const isWin = process.platform === 'win32'
const SHELL = isWin ? 'cmd.exe' : 'sh'
const CR = isWin ? '\r' : '\n'
const echoArgs = (text: string): string[] => (isWin ? ['/c', 'echo', text] : ['-c', `echo ${text}`])
const idleArgs = (): string[] => []
const baseOpts = { cwd: process.cwd(), env: process.env }
// Wide + short cwd for write→echo tests so the echoed command line never wraps
// (a long cwd + marker past 80 cols would split the marker across rows).
const wideOpts = { cwd: process.cwd(), env: process.env, cols: 220, rows: 50 }

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Probe whether the native node-pty addon can spawn in this runtime. */
function ptyAvailable(): boolean {
  try {
    const p = createNativePtySession(SHELL, echoArgs('probe'), baseOpts)
    p.kill()
    return true
  } catch {
    return false
  }
}
const AVAILABLE = ptyAvailable()

/**
 * Spawn an interactive shell via `make`, wait for its prompt, write
 * `echo <marker>`, and return everything the PTY emitted. Used to assert the
 * INPUT path actually reaches the process (the class of bug this test guards).
 */
async function writeEchoRoundtrip(make: () => PtySession, marker: string): Promise<string> {
  const p = make()
  let data = ''
  const sub = p.onData((chunk) => {
    data += chunk.toString('utf8')
  })
  await delay(900) // let the shell print its prompt / become ready for input
  p.write(`echo ${marker}${CR}`)
  await delay(1600) // let the shell run the command and echo the marker back
  sub.dispose()
  p.kill()
  return data
}

describe('RingBuffer', () => {
  it('replays pushed chunks in order', () => {
    const rb = new RingBuffer()
    rb.push(Buffer.from('foo'))
    rb.push(Buffer.from('bar'))
    expect(rb.snapshot().toString('utf8')).toBe('foobar')
    expect(rb.byteLength).toBe(6)
  })

  it('evicts oldest chunks once over capacity', () => {
    const rb = new RingBuffer(8) // tiny cap
    rb.push(Buffer.from('aaaa')) // 4
    rb.push(Buffer.from('bbbb')) // 8 (at cap)
    rb.push(Buffer.from('cccc')) // 12 → evict 'aaaa' → 'bbbbcccc' (8)
    expect(rb.snapshot().toString('utf8')).toBe('bbbbcccc')
    expect(rb.byteLength).toBe(8)
  })

  it('keeps a single oversized chunk rather than dropping everything', () => {
    const rb = new RingBuffer(4)
    rb.push(Buffer.from('hugechunk'))
    expect(rb.snapshot().toString('utf8')).toBe('hugechunk')
  })
})

describe.skipIf(!AVAILABLE)('createPtySession (native backend)', () => {
  it(
    'spawns a process and roundtrips its output + exit code',
    async () => {
      const p = createNativePtySession(SHELL, echoArgs('hi-roundtrip'), baseOpts)
      const result = await new Promise<{ data: string; code: number }>((resolve) => {
        let data = ''
        p.onData((chunk) => {
          data += chunk.toString('utf8')
        })
        p.onExit(({ exitCode }) => resolve({ data, code: exitCode }))
      })
      expect(result.data).toContain('hi-roundtrip')
      expect(result.code).toBe(0)
    },
    15000,
  )

  it(
    'delivers written keystrokes to the process (write→echo INPUT path)',
    async () => {
      const marker = `mark_native_${Date.now()}`
      const data = await writeEchoRoundtrip(
        () => createNativePtySession(SHELL, idleArgs(), wideOpts),
        marker,
      )
      // The marker appears twice on success (the typed command line + the echo
      // output); the input path is dead if it never appears beyond what we typed.
      // A ConPTY echoes the keystrokes, so require the *command output* line too.
      expect(data).toContain(marker)
      expect(data.split(marker).length - 1).toBeGreaterThanOrEqual(2)
    },
    15000,
  )

  it(
    'kill() terminates a long-lived process',
    async () => {
      const p = createNativePtySession(SHELL, idleArgs(), baseOpts) // interactive shell, stays alive
      const exit = new Promise<number>((resolve) => p.onExit(({ exitCode }) => resolve(exitCode)))
      // give it a beat to actually start before killing
      await delay(200)
      p.kill()
      const code = await exit
      expect(typeof code).toBe('number')
      expect(p.killed).toBe(true)
    },
    15000,
  )
})

describe.skipIf(!AVAILABLE)('createSidecarPtySession (node sidecar backend)', () => {
  it(
    'spawns via the node host and roundtrips output + exit code',
    async () => {
      const p = createSidecarPtySession(SHELL, echoArgs('hi-sidecar'), baseOpts)
      const result = await new Promise<{ data: string; code: number }>((resolve) => {
        let data = ''
        p.onData((chunk) => {
          data += chunk.toString('utf8')
        })
        p.onExit(({ exitCode }) => resolve({ data, code: exitCode }))
      })
      expect(result.data).toContain('hi-sidecar')
      expect(result.code).toBe(0)
    },
    20000,
  )

  it(
    'delivers written keystrokes to the process (write→echo INPUT path)',
    async () => {
      const marker = `mark_sidecar_${Date.now()}`
      const data = await writeEchoRoundtrip(
        () => createSidecarPtySession(SHELL, idleArgs(), wideOpts),
        marker,
      )
      expect(data).toContain(marker)
      expect(data.split(marker).length - 1).toBeGreaterThanOrEqual(2)
    },
    20000,
  )

  it(
    'kill() terminates the sidecar process',
    async () => {
      const p = createSidecarPtySession(SHELL, idleArgs(), baseOpts)
      const exit = new Promise<number>((resolve) => p.onExit(({ exitCode }) => resolve(exitCode)))
      await delay(400)
      p.kill()
      const code = await exit
      expect(typeof code).toBe('number')
      expect(p.killed).toBe(true)
    },
    20000,
  )
})

describe.skipIf(!AVAILABLE)('createPtySession backend dispatch', () => {
  it('honours RUNCASTLE_PTY_BACKEND override', async () => {
    const prev = process.env.RUNCASTLE_PTY_BACKEND
    process.env.RUNCASTLE_PTY_BACKEND = 'sidecar'
    try {
      const marker = `mark_dispatch_${Date.now()}`
      const data = await writeEchoRoundtrip(
        () => createPtySession(SHELL, idleArgs(), wideOpts),
        marker,
      )
      expect(data).toContain(marker)
    } finally {
      if (prev === undefined) delete process.env.RUNCASTLE_PTY_BACKEND
      else process.env.RUNCASTLE_PTY_BACKEND = prev
    }
  }, 20000)
})

describe.skipIf(!AVAILABLE)('ptyRegistry replay', () => {
  it(
    'buffers output and replays it to a late-attaching sink with an ended status',
    async () => {
      const sessionId = `sess_pty_test_${Date.now()}`
      await new Promise<void>((resolve) => {
        ptyRegistry().create({
          sessionId,
          cmd: SHELL,
          args: echoArgs('replay-marker'),
          opts: baseOpts,
          onExit: () => resolve(),
        })
      })

      const chunks: Buffer[] = []
      let status = ''
      const ok = ptyRegistry().attach(sessionId, {
        sendData: (c) => chunks.push(c),
        sendControl: (f: ControlFrame) => {
          if (f.t === 'status') status = f.status
        },
      })

      expect(ok).toBe(true)
      expect(Buffer.concat(chunks).toString('utf8')).toContain('replay-marker')
      expect(status).toBe('ended')

      ptyRegistry().remove(sessionId)
      expect(ptyRegistry().has(sessionId)).toBe(false)
    },
    15000,
  )
})
