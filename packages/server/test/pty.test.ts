import { describe, expect, it } from 'vitest'
import { createPtySession, installPtyStandIn } from '../src/pty/pty'
import { ptyRegistry, type ControlFrame } from '../src/pty/registry'
import { RingBuffer } from '../src/pty/ring-buffer'
import { usePipePty } from './helpers/pipe-pty'

/**
 * The layers above the backend: the ring buffer, and the registry's replay and
 * teardown, run against the pipe stand-in because vitest is on node. The shipped
 * terminal itself is tested from a real Bun process in `pty-bun.test.ts`.
 */

usePipePty()

const isWin = process.platform === 'win32'
const SHELL = isWin ? 'cmd.exe' : 'sh'
const echoArgs = (text: string): string[] => (isWin ? ['/c', 'echo', text] : ['-c', `echo ${text}`])
const idleArgs = (): string[] => (isWin ? ['/c', 'ping', '-n', '60', '127.0.0.1'] : ['-c', 'sleep 60'])
const baseOpts = { cwd: process.cwd(), env: process.env }

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** True while `pid` is still a live process (Windows-safe existence probe). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
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

describe('createPtySession outside Bun', () => {
  it('says what is wrong rather than failing somewhere deeper', () => {
    installPtyStandIn(null)
    try {
      expect(() => createPtySession(SHELL, [], baseOpts)).toThrow(/need Bun/)
    } finally {
      usePipePty()
    }
  })
})

describe('ptyRegistry replay', () => {
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

/**
 * Shutdown teardown: `killAllTrees` is what the SIGINT/SIGTERM handler awaits, so
 * a PTY that survives it is an orphan holding a port after the server is gone.
 * That the kill reaches the whole TREE (not just the shell) is asserted in
 * dev-pane.test.ts and pty-bun.test.ts; this covers the all-sessions sweep and the
 * entry bookkeeping.
 */
describe('ptyRegistry teardown', () => {
  it(
    'kills every live PTY and leaves no entry behind',
    async () => {
      const ids = [`sess_teardown_a_${Date.now()}`, `sess_teardown_b_${Date.now()}`]
      const entries = ids.map((sessionId) =>
        ptyRegistry().create({ sessionId, cmd: SHELL, args: idleArgs(), opts: baseOpts }),
      )
      await delay(400)
      for (const entry of entries) expect(pidAlive(entry.pty.pid)).toBe(true)

      await ptyRegistry().killAllTrees()
      await delay(400)

      for (const id of ids) expect(ptyRegistry().has(id)).toBe(false)
      for (const entry of entries) expect(pidAlive(entry.pty.pid)).toBe(false)
    },
    20000,
  )
})
