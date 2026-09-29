import { afterEach, describe, expect, it, vi } from 'vitest'
import { contain, createContainer, type Kernel32 } from '../src/pty/job-object'

/**
 * The Job Object bookkeeping, driven over a fake kernel32 so it runs on every OS.
 * The real FFI binding is exercised only by the win32 real-process suite
 * (`job-object-win32.test.ts`).
 */

const JOB = 101
const PROC = 202

type Step = 'createJob' | 'setKillOnClose' | 'openProcess' | 'assign'

interface FakeKernel32 extends Kernel32 {
  calls: string[]
  limitInfo: Uint8Array | null
  closed: number[]
  exited: boolean
}

function fakeKernel32(failAt?: Step): FakeKernel32 {
  const k: FakeKernel32 = {
    calls: [],
    limitInfo: null,
    closed: [],
    exited: false,
    createJob() {
      k.calls.push('createJob')
      return failAt === 'createJob' ? null : JOB
    },
    setKillOnClose(job, info) {
      k.calls.push(`setKillOnClose:${job}`)
      k.limitInfo = info
      return failAt !== 'setKillOnClose'
    },
    openProcess(pid) {
      k.calls.push(`openProcess:${pid}`)
      return failAt === 'openProcess' ? null : PROC
    },
    assign(job, proc) {
      k.calls.push(`assign:${job}:${proc}`)
      return failAt !== 'assign'
    },
    terminateJob(job) {
      k.calls.push(`terminateJob:${job}`)
      return true
    },
    closeHandle(h) {
      k.calls.push(`closeHandle:${h}`)
      k.closed.push(h)
      return true
    },
    isProcessExited(proc) {
      k.calls.push(`isProcessExited:${proc}`)
      return k.exited
    },
  }
  return k
}

afterEach(() => {
  vi.useRealTimers()
})

describe('contain(pid)', () => {
  it('puts the pid in a kill-on-close job whose limit info forbids breakaway', () => {
    const k = fakeKernel32()
    const log = vi.fn()
    const containment = createContainer(k, log)(4242)

    expect(containment?.pid).toBe(4242)
    expect(k.calls).toEqual(['createJob', `setKillOnClose:${JOB}`, 'openProcess:4242', `assign:${JOB}:${PROC}`])
    const info = k.limitInfo as Uint8Array
    expect(info.length).toBe(144)
    const view = new DataView(info.buffer, info.byteOffset, info.byteLength)
    // Exactly KILL_ON_JOB_CLOSE — no BREAKAWAY_OK (0x800), no SILENT_BREAKAWAY_OK (0x1000).
    expect(view.getUint32(16, true)).toBe(0x2000)
    // Every other byte is zero.
    expect([...info].filter((b, i) => b !== 0 && (i < 16 || i > 19))).toEqual([])
    // The handles stay open for the containment's life.
    expect(k.closed).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toMatch(/\[pty-teardown\] job: contained pid=4242/)
  })

  it.each<[Step, number[]]>([
    ['createJob', []],
    ['setKillOnClose', [JOB]],
    ['openProcess', [JOB]],
    ['assign', [PROC, JOB]],
  ])('returns null when %s fails, closing only the handles already opened', (step, closed) => {
    const k = fakeKernel32(step)
    const log = vi.fn()

    expect(createContainer(k, log)(4242)).toBeNull()
    expect(k.closed).toEqual(closed)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toMatch(new RegExp(`contain failed pid=4242 step=${step}`))
  })

  it('returns null, never throws, when a kernel32 call throws', () => {
    const k = fakeKernel32()
    k.openProcess = () => {
      throw new Error('boom')
    }
    const log = vi.fn()

    expect(createContainer(k, log)(4242)).toBeNull()
    expect(k.closed).toEqual([JOB])
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('returns null with one warning line when no kernel32 is available', () => {
    const log = vi.fn()
    expect(createContainer(null, log)(4242)).toBeNull()
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('is a harmless null under node (vitest) — bun:ffi is never loaded', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(contain(process.pid)).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('Containment.kill()', () => {
  it('terminates and closes the job, then resolves true once the root has exited', async () => {
    vi.useFakeTimers()
    const k = fakeKernel32()
    const containment = createContainer(k, () => {})(4242)
    k.calls.length = 0

    const result = containment?.kill()
    expect(k.calls.slice(0, 2)).toEqual([`terminateJob:${JOB}`, `closeHandle:${JOB}`])

    await vi.advanceTimersByTimeAsync(200)
    // Still alive: the process handle stays open while we wait.
    expect(k.closed).toEqual([JOB])
    k.exited = true
    await vi.advanceTimersByTimeAsync(50)

    await expect(result).resolves.toBe(true)
    expect(k.closed).toEqual([JOB, PROC])
  })

  it('resolves false when the root outlives the timeout, still closing its handle', async () => {
    vi.useFakeTimers()
    const k = fakeKernel32()
    const containment = createContainer(k, () => {})(4242)

    const result = containment?.kill({ timeoutMs: 300 })
    await vi.advanceTimersByTimeAsync(400)

    await expect(result).resolves.toBe(false)
    expect(k.closed).toEqual([JOB, PROC])
  })

  it('is idempotent: a second call resolves the first call’s result without re-killing', async () => {
    const k = fakeKernel32()
    k.exited = true
    const containment = createContainer(k, () => {})(4242)

    const first = containment?.kill()
    const second = containment?.kill()
    expect(second).toBe(first)
    await expect(second).resolves.toBe(true)
    expect(k.calls.filter((c) => c.startsWith('terminateJob'))).toHaveLength(1)
    expect(k.closed).toEqual([JOB, PROC])
  })

  it('never rejects, even when kernel32 throws during teardown', async () => {
    const k = fakeKernel32()
    const containment = createContainer(k, () => {})(4242)
    k.terminateJob = () => {
      throw new Error('boom')
    }
    k.closeHandle = () => {
      throw new Error('boom')
    }
    k.isProcessExited = () => true

    await expect(containment?.kill()).resolves.toBe(true)
  })
})
