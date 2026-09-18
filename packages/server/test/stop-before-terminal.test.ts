import type { Feature, Project, Ticket, TicketPatch, WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { getRunRow } from '../src/services/repo'
import {
  createKillRegistry,
  killRegistry,
  type KillRegistryDeps,
} from '../src/workflows/kill-registry'
import { workflowRegistry } from '../src/workflows/registry'
import { cancelRun, startRun } from '../src/workflows/runner'
import type { TicketOutcome } from '../src/workflows/ticket-burner'
import { burnTickets, registerTicketAbort, releaseTicketAbort, stopTicketRun } from '../src/workflows/ticket-burner'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Terminal state waits for the kill (spec: "no way for 'stopped' to precede
 * death").
 *
 * The order a stop runs in is abort, then kill, then wait — but the abort is
 * itself enough to reject the sandcastle run, so the failure continuation that
 * writes the ticket row (or the run row) is off and running while the container
 * is still being removed. That continuation is a different async path from the
 * mutation's, so nothing about the stop resolving late kept it back: the row
 * could read stopped seconds before the agent died, which is the whole lie this
 * feature exists to remove.
 *
 * Both cases here are the reviewer's repro step: hold `killAndWait` pending
 * after the abort, and read the row before releasing it.
 */

/** A registry whose container refuses to vanish until `letItDie()` is called. */
function withHeldContainer(): {
  registry: ReturnType<typeof createKillRegistry>
  letItDie: () => void
} {
  let alive = true
  const deps: KillRegistryDeps = {
    runDocker: async (args) => (args[0] === 'inspect' ? alive : true),
    killTree: async () => {},
  }
  return { registry: createKillRegistry(deps), letItDie: () => (alive = false) }
}

/** The process-wide registry both stop paths reach for, swappable per case. */
const REGISTRY_KEY = Symbol.for('runcastle.kill.registry')
type GlobalWithRegistry = typeof globalThis & { [REGISTRY_KEY]?: unknown }

/** Yield the microtask queue, so every continuation the abort woke has run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('a stopped ticket does not read terminal before its agent is dead', () => {
  const project: Project = { id: 'proj_1', name: 'test', repoPath: '/repo' }
  const feature: Feature = {
    id: 'feat_1',
    projectId: 'proj_1',
    slug: 'demo',
    title: 'Demo',
    oneLiner: 'x',
    mapped: false,
    phase: 'building',
    branch: 'feature/demo',
    baseBranch: 'main',
    status: 'active',
    createdAt: 0,
  }
  const ticket: Ticket = {
    id: 'tkt_1',
    featureId: feature.id,
    seq: 1,
    title: 'Ticket 1',
    goal: 'g',
    context: 'c',
    acceptanceCriteria: ['a'],
    seams: ['s'],
    blockedBy: [],
    kind: 'implementation',
    status: 'pending',
    commits: [],
  }
  const realRegistry = (globalThis as GlobalWithRegistry)[REGISTRY_KEY]

  afterEach(() => {
    releaseTicketAbort(ticket.id)
    ;(globalThis as GlobalWithRegistry)[REGISTRY_KEY] = realRegistry
  })

  it('writes the failed row only once the container is confirmed gone', async () => {
    const held = withHeldContainer()
    ;(globalThis as GlobalWithRegistry)[REGISTRY_KEY] = held.registry

    // Every status the scheduler wrote, in order — the row's whole history, so
    // the assertion is about WHEN it moved and not just where it ended up.
    const written: string[] = []
    const ctx: WorkflowCtx = {
      runId: 'run_1',
      project,
      feature,
      tickets: [ticket],
      emitEvent: () => {},
      updateTicket: (_id, patch: TicketPatch) => {
        if (patch.status) written.push(patch.status)
      },
      resolveWaypoint: () => {},
      signal: new AbortController().signal,
    }

    // The lane as the burner registers it, and an executor that fails the way
    // `burnTicket`'s catch does when the ticket's own abort fires.
    const execute = (_c: WorkflowCtx, t: Ticket): Promise<TicketOutcome> => {
      const controller = registerTicketAbort(t.id)
      killRegistry().registerContainer(t.id, 'runcastle-run_1-t1', { runId: 'run_1' })
      return new Promise<TicketOutcome>((resolve) => {
        controller.signal.addEventListener(
          'abort',
          () => resolve({ status: 'failed', error: 'stopped by user' }),
          { once: true },
        )
      })
    }

    const run = burnTickets(ctx, [ticket], execute, 1)
    await flush()
    expect(written).toEqual(['burning'])

    const stop = stopTicketRun(ticket.id)
    await flush()
    // The repro: the abort has already produced the failed outcome, and the
    // kill has not confirmed anything yet. The row must still say burning.
    expect(written).toEqual(['burning'])

    held.letItDie()
    await expect(stop).resolves.toEqual({ stopped: true, confirmed: true })
    await run
    expect(written).toEqual(['burning', 'failed'])
  })
})

describe('a cancelled run does not read terminal before its agents are dead', () => {
  const cancellableDef: WorkflowDef = {
    id: 'test-cancellable',
    run: (ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
  }

  let ctx: AppCtx
  let featureId: string
  const realRegistry = (globalThis as GlobalWithRegistry)[REGISTRY_KEY]

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'building' }).id
    workflowRegistry.set(cancellableDef.id, cancellableDef)
  })

  afterEach(() => {
    workflowRegistry.delete(cancellableDef.id)
    ;(globalThis as GlobalWithRegistry)[REGISTRY_KEY] = realRegistry
  })

  it('writes the cancelled row only once every lane of the run is gone', async () => {
    const held = withHeldContainer()
    ;(globalThis as GlobalWithRegistry)[REGISTRY_KEY] = held.registry

    const { runId, done } = await startRun(ctx, featureId, cancellableDef.id)
    killRegistry().registerContainer('tkt_lane', `runcastle-${runId}-t1`, { runId })

    const cancel = cancelRun(runId)
    await flush()
    // The repro, at the run seam: the abort has already rejected the workflow.
    expect(getRunRow(ctx, runId).status).toBe('running')

    held.letItDie()
    await expect(cancel).resolves.toEqual({ confirmed: true })
    await done
    expect(getRunRow(ctx, runId).status).toBe('cancelled')
  })
})
