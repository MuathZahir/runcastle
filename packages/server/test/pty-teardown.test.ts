import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { killProcessTree } from '../src/pty/kill-tree'
import type { PtySession } from '../src/pty/pty'
import { tearDownEntry, type PtyEntry } from '../src/pty/registry'
import { RingBuffer } from '../src/pty/ring-buffer'

/**
 * PTY teardown, the two layers that keep a drive stop bounded (preparation-bug):
 *
 *  1. `killProcessTree` settles on its own — the win32 branch owns its promise
 *     via listeners it attaches to a spawned `taskkill`, rather than handing
 *     settlement to `promisify(execFile)`, which under Bun on win32 never
 *     settled and hung every drive stop indefinitely.
 *  2. the registry's 5s deadline covers ALL of a per-entry teardown, so no step
 *     — present or future — can hold the caller past it.
 *
 * Both are runtime-independent claims, so this suite runs anywhere. What it does
 * NOT prove is the win32-under-Bun behaviour that motivated the fix; that needs
 * the production runtime, and lives in `dev-pane-stop-bun.test.ts`.
 */

/** The registry's own bound. Mirrored here so the assertions name what they test. */
const TEARDOWN_TIMEOUT_MS = 5000

/** A PTY that does whatever the test needs, recording what teardown asked of it. */
function fakeEntry(opts: {
  sessionId?: string
  killTree: () => Promise<void>
  kill?: () => void
  exited?: boolean
}): { entry: PtyEntry; calls: string[] } {
  const calls: string[] = []
  const pty: PtySession = {
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    write() {},
    resize() {},
    kill() {
      calls.push('kill')
      opts.kill?.()
    },
    killTree() {
      calls.push('killTree')
      return opts.killTree()
    },
    pid: 4242,
    killed: false,
  }
  return {
    entry: {
      sessionId: opts.sessionId ?? 'drive:test',
      pty,
      buffer: new RingBuffer(),
      sinks: new Set(),
      exited: opts.exited ?? false,
      exitCode: null,
    },
    calls,
  }
}

describe('killProcessTree', () => {
  it('resolves promptly for a pid that does not exist, and never rejects', async () => {
    const started = Date.now()
    // Settlement must come from the kill itself, not from any backstop timer: a
    // slow resolve here would mean the promise is back to being rescued rather
    // than settled, which is the exact failure this fix removes.
    await expect(killProcessTree(0x7ffffffe)).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(3000)
  }, 15000)

  it('resolves promptly for an already-dead process, and never rejects', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    const pid = await new Promise<number>((resolve) => {
      child.on('exit', () => resolve(child.pid ?? -1))
    })
    expect(pid).toBeGreaterThan(0)

    const started = Date.now()
    await expect(killProcessTree(pid)).resolves.toBeUndefined()
    expect(Date.now() - started).toBeLessThan(3000)
  }, 15000)
})

describe('tearDownEntry', () => {
  it('kills the tree before the PTY itself (the link taskkill /T walks)', async () => {
    const { entry, calls } = fakeEntry({ killTree: () => Promise.resolve() })
    await tearDownEntry(entry)
    expect(calls).toEqual(['killTree', 'kill'])
  })

  it('skips an already-exited entry rather than killing a possibly-reused pid', async () => {
    const { entry, calls } = fakeEntry({ exited: true, killTree: () => Promise.resolve() })
    await tearDownEntry(entry)
    expect(calls).toEqual([])
  })

  it('returns within the deadline even when killTree never settles', async () => {
    const { entry, calls } = fakeEntry({
      // The production hang, exactly: a tree-kill promise that never resolves.
      killTree: () => new Promise<void>(() => {}),
    })

    const started = Date.now()
    await tearDownEntry(entry)
    const elapsed = Date.now() - started

    expect(elapsed).toBeGreaterThanOrEqual(TEARDOWN_TIMEOUT_MS - 500)
    expect(elapsed).toBeLessThan(TEARDOWN_TIMEOUT_MS * 2)
    // The `pty.kill()` backstop is INSIDE the bound, so a fired deadline abandons
    // the rest of the body rather than running it afterwards unbounded — which is
    // what the old bound, which raced only the tree-kill, did.
    expect(calls).toEqual(['killTree'])
  }, 20000)

  it('never rejects, whatever the backend does', async () => {
    const { entry } = fakeEntry({
      killTree: () => Promise.reject(new Error('backend exploded')),
      kill: () => {
        throw new Error('already reaped')
      },
    })
    await expect(tearDownEntry(entry)).resolves.toBeUndefined()
  })
})
