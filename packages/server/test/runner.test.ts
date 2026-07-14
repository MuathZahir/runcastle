import type { WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { getRunRow } from '../src/services/repo'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

const successDef: WorkflowDef = {
  id: 'test-success',
  async run() {
    return { status: 'succeeded', summary: 'ok' }
  },
}

const throwDef: WorkflowDef = {
  id: 'test-throw',
  async run() {
    throw new Error('boom')
  },
}

describe('workflow runner', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    workflowRegistry.set(successDef.id, successDef)
    workflowRegistry.set(throwDef.id, throwDef)
  })

  afterEach(() => {
    workflowRegistry.delete(successDef.id)
    workflowRegistry.delete(throwDef.id)
  })

  it('finalizes a succeeded run and emits run.started + run.finished', async () => {
    const { runId, done } = await startRun(ctx, featureId, 'test-success')
    await done

    const run = getRunRow(ctx, runId)
    expect(run.status).toBe('succeeded')
    expect(run.summary).toBe('ok')
    expect(run.endedAt).toBeGreaterThan(0)

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('run.started')
    expect(types).toContain('run.finished')
  })

  it('marks a throwing run failed and finalizes it', async () => {
    const { runId, done } = await startRun(ctx, featureId, 'test-throw')
    await done

    const run = getRunRow(ctx, runId)
    expect(run.status).toBe('failed')
    expect(run.summary).toContain('boom')
    expect(run.endedAt).toBeGreaterThan(0)

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('run.finished')
  })

  it('rejects an unregistered workflow id', async () => {
    await expect(startRun(ctx, featureId, 'nope')).rejects.toThrow(/not registered/)
  })
})
