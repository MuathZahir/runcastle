import type { WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * `run.cancel` over the wire. Cancel is the UI's only stop button, so "did that
 * land?" has to be answerable: it used to return `{ok:true}` for a run id this
 * server has never heard of — a typo, a stale tab, or a run from a previous
 * server process all reported a successful cancel with nothing cancelled.
 */
/** Runs until aborted, then throws — how a real workflow reports a cancel. */
const cancellableDef: WorkflowDef = {
  id: 'test-cancel-router',
  async run(ctx) {
    await new Promise<never>((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    return { status: 'succeeded', summary: 'unreachable' }
  },
}

describe('run router — cancel', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    workflowRegistry.set(cancellableDef.id, cancellableDef)
  })

  afterEach(() => {
    workflowRegistry.delete(cancellableDef.id)
  })

  it('rejects an unknown run id instead of reporting a successful cancel', async () => {
    await expect(caller.run.cancel({ runId: 'run_nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('cancels a live run', async () => {
    const { runId, done } = await startRun(ctx, featureId, cancellableDef.id)

    expect(await caller.run.cancel({ runId })).toEqual({ ok: true })
    await done

    expect(await caller.run.get({ runId })).toMatchObject({ status: 'cancelled' })
  })

  it('stays a no-op for a run that already finished', async () => {
    const { runId, done } = await startRun(ctx, featureId, cancellableDef.id)
    await caller.run.cancel({ runId })
    await done

    expect(await caller.run.cancel({ runId })).toEqual({ ok: true })
  })
})
