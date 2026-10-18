import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import {
  SESSION_READY_TIMEOUT_MS,
  armSessionReadyWatchdog,
  createSessionRow,
} from '../src/launcher/sessions'
import { ptyRegistry } from '../src/pty/registry'
import type { PtyEntry } from '../src/pty/registry'
import { listAfter } from '../src/services/events'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('the session-ready watchdog', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    vi.useFakeTimers()
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { slug: 'entry-tags' }).id
    vi.spyOn(ptyRegistry(), 'get').mockReturnValue({ exited: false } as unknown as PtyEntry)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function arm(): void {
    armSessionReadyWatchdog(ctx, createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt/entry-tags' }))
  }

  it('warns when a live terminal has not reported ready in time', () => {
    arm()
    vi.advanceTimersByTime(SESSION_READY_TIMEOUT_MS)

    expect(listAfter(ctx, featureId, 0).map((e) => e.type)).toContain('session.not_ready')
  })

  /**
   * REGRESSION (lap 3 review): the warning's write hit a locked database inside
   * the bare timer, the throw went uncaught, and it killed the server.
   */
  it('logs a failed write instead of throwing out of its timer', () => {
    arm()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(ctx.db, 'insert').mockImplementation(() => {
      throw new Error('database is locked')
    })

    expect(() => vi.advanceTimersByTime(SESSION_READY_TIMEOUT_MS)).not.toThrow()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('session-ready watchdog failed'), expect.any(Error))
  })
})
