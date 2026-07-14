import { describe, expect, it } from 'vitest'
import { createPtySession } from '../src/pty/pty'
import { ptyRegistry, type ControlFrame } from '../src/pty/registry'
import { RingBuffer } from '../src/pty/ring-buffer'

/**
 * PTY layer unit test (task item 6): a real node-pty spawn + data roundtrip,
 * ring-buffer replay through the registry, and kill. The node-pty-backed cases
 * skip gracefully where the native addon cannot load (CI without prebuilds); the
 * pure RingBuffer case always runs. On this Windows dev box node-pty loads under
 * both bun and node, so the gated block RUNS here.
 */

const isWin = process.platform === 'win32'
const SHELL = isWin ? 'cmd.exe' : 'sh'
const echoArgs = (text: string): string[] => (isWin ? ['/c', 'echo', text] : ['-c', `echo ${text}`])
const idleArgs = (): string[] => (isWin ? [] : [])
const baseOpts = { cwd: process.cwd(), env: process.env }

/** Probe whether the native node-pty addon can spawn in this runtime. */
function ptyAvailable(): boolean {
  try {
    const p = createPtySession(SHELL, echoArgs('probe'), baseOpts)
    p.kill()
    return true
  } catch {
    return false
  }
}
const AVAILABLE = ptyAvailable()

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

describe.skipIf(!AVAILABLE)('createPtySession (node-pty)', () => {
  it(
    'spawns a process and roundtrips its output + exit code',
    async () => {
      const p = createPtySession(SHELL, echoArgs('hi-roundtrip'), baseOpts)
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
    'kill() terminates a long-lived process',
    async () => {
      const p = createPtySession(SHELL, idleArgs(), baseOpts) // interactive shell, stays alive
      const exit = new Promise<number>((resolve) => p.onExit(({ exitCode }) => resolve(exitCode)))
      // give it a beat to actually start before killing
      await new Promise((r) => setTimeout(r, 200))
      p.kill()
      const code = await exit
      expect(typeof code).toBe('number')
      expect(p.killed).toBe(true)
    },
    15000,
  )
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
