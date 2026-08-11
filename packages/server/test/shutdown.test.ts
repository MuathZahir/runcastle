import { describe, expect, it } from 'vitest'
import { createShutdown, SHUTDOWN_TIMEOUT_MS } from '../src/shutdown'

/**
 * The SIGINT/SIGTERM handler (`src/shutdown.ts`). Killing a PTY's process tree is
 * async — it shells out to `taskkill` on Windows — so the handler must AWAIT
 * teardown before exiting; the synchronous version it replaced could only signal
 * the direct children, leaving a burn's `claude` grandchild holding its lock
 * after the server was gone. It must also stay bounded (a hung `taskkill` must
 * not make Ctrl-C a no-op) and stay interruptible (a second Ctrl-C means now).
 */

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('createShutdown', () => {
  it('stops the server and exits only after tree teardown settles', async () => {
    const order: string[] = []
    let releaseTeardown = (): void => {}
    const teardown = new Promise<void>((resolve) => {
      releaseTeardown = resolve
    })

    const shutdown = createShutdown({
      killAllTrees: () => {
        order.push('kill')
        return teardown
      },
      stop: () => order.push('stop'),
      exit: () => order.push('exit'),
    })

    shutdown()
    await delay(20)
    expect(order).toEqual(['kill'])

    releaseTeardown()
    await delay(20)
    expect(order).toEqual(['kill', 'stop', 'exit'])
  })

  it('exits 0 once teardown is done', async () => {
    const codes: number[] = []
    const shutdown = createShutdown({
      killAllTrees: () => Promise.resolve(),
      stop: () => {},
      exit: (code) => codes.push(code),
    })

    shutdown()
    await delay(20)
    expect(codes).toEqual([0])
  })

  it('gives up on a teardown that never settles and exits anyway', async () => {
    const codes: number[] = []
    const shutdown = createShutdown(
      {
        killAllTrees: () => new Promise<void>(() => {}),
        stop: () => {},
        exit: (code) => codes.push(code),
      },
      20,
    )

    shutdown()
    await delay(10)
    expect(codes).toEqual([])
    await delay(60)
    expect(codes).toEqual([0])
  })

  it('force-exits non-zero on a second signal instead of waiting again', async () => {
    const codes: number[] = []
    let killCalls = 0
    const shutdown = createShutdown({
      killAllTrees: () => {
        killCalls++
        return new Promise<void>(() => {})
      },
      stop: () => {},
      exit: (code) => codes.push(code),
    })

    shutdown()
    await delay(10)
    shutdown()

    expect(codes).toEqual([1])
    expect(killCalls).toBe(1)
  })

  it('exits rather than hanging when teardown rejects', async () => {
    const codes: number[] = []
    const shutdown = createShutdown({
      killAllTrees: () => Promise.reject(new Error('taskkill blew up')),
      stop: () => {},
      exit: (code) => codes.push(code),
    })

    shutdown()
    await delay(20)
    expect(codes).toEqual([0])
  })

  it('bounds the default wait at something an operator will sit through', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(0)
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThanOrEqual(5000)
  })
})
