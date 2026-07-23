import type { Feature, Project, Ticket, WorkflowCtx } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import type { BurnDeps, TicketOutcome } from '../src/workflows/ticket-burner'
import { burnRun } from '../src/workflows/ticket-burner'

/**
 * Workflow-level tests: the scheduler + summary logic driven through a FAKE
 * `executeTicketRun` (the sandcastle boundary). No real sandcastle runs. Covers
 * success, failure, merge-conflict, zero-commit (as a failed outcome), the
 * blocked-by-failed cascade, cycle detection, the auth precheck and abort.
 */

function ticket(seq: number, blockedBy: number[] = []): Ticket {
  return {
    id: `tkt_${seq}`,
    featureId: 'feat_1',
    seq,
    title: `Ticket ${seq}`,
    goal: 'g',
    context: 'c',
    acceptanceCriteria: ['a'],
    seams: ['s'],
    blockedBy,
    status: 'pending',
    commits: [],
  }
}

const project: Project = {
  id: 'proj_1',
  name: 'test',
  repoPath: '/repo',
  mainBranch: 'main',
}

const feature: Feature = {
  id: 'feat_1',
  projectId: 'proj_1',
  slug: 'demo',
  title: 'Demo',
  oneLiner: 'x',
  mapped: false,
  phase: 'implementation',
  branch: 'feature/demo',
  status: 'active',
  createdAt: 0,
}

interface Emitted {
  type: string
  message: string
  ticketId?: string
  data?: unknown
}
interface Patch {
  id: string
  patch: Partial<Pick<Ticket, 'status' | 'commits' | 'error'>>
}

function makeCtx(tickets: Ticket[], signal?: AbortSignal) {
  const events: Emitted[] = []
  const patches: Patch[] = []
  const ctx: WorkflowCtx = {
    project,
    feature,
    tickets,
    emitEvent: (e) => events.push(e),
    updateTicket: (id, patch) => {
      patches.push({ id, patch })
      const t = tickets.find((x) => x.id === id)
      if (t) Object.assign(t, patch)
    },
    resolveWaypoint: () => {},
    signal: signal ?? new AbortController().signal,
  }
  return { ctx, events, patches }
}

/** A fake boundary: canned outcome per seq; records the order of invocations. */
function fakeExecute(
  outcomes: Record<number, TicketOutcome>,
  calls: number[] = [],
): BurnDeps['executeTicketRun'] {
  return async (_ctx, t) => {
    calls.push(t.seq)
    const outcome = outcomes[t.seq]
    if (!outcome) throw new Error(`no fake outcome for seq ${t.seq}`)
    return outcome
  }
}

function deps(
  execute: BurnDeps['executeTicketRun'],
  over: Partial<Omit<BurnDeps, 'executeTicketRun'>> = {},
): BurnDeps {
  return {
    config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'noSandbox', mainBranch: 'main', burnConcurrency: 3 },
    hasAuthToken: true,
    concurrency: 1,
    executeTicketRun: execute,
    ...over,
  }
}

describe('burnRun — scheduling and summary', () => {
  it('runs blocked tickets in dependency order and succeeds when all are done', async () => {
    const tickets = [ticket(1), ticket(2, [1])]
    const { ctx, events, patches } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute(
      { 1: { status: 'done', commits: ['a'] }, 2: { status: 'done', commits: ['b', 'c'] } },
      calls,
    )

    const res = await burnRun(ctx, deps(execute))

    expect(calls).toEqual([1, 2]) // 2 waits for 1
    expect(res).toEqual({ status: 'succeeded', summary: '2/2 tickets done' })
    expect(patches).toContainEqual({ id: 'tkt_1', patch: { status: 'burning' } })
    expect(patches).toContainEqual({ id: 'tkt_2', patch: { status: 'done', commits: ['b', 'c'] } })
    expect(events.map((e) => e.type)).toContain('ticket.done')
    expect(events.at(-1)).toMatchObject({ type: 'burn.summary', message: '2/2 tickets done' })
  })

  it('fails the run and reports X/Y when a ticket fails', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'failed', error: 'boom' } })

    const res = await burnRun(ctx, deps(execute))

    expect(res).toEqual({ status: 'failed', summary: '0/1 tickets done' })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ticket.failed', ticketId: 'tkt_1' }),
    )
  })

  it('surfaces a merge conflict as merge.conflict.needs-human and continues others', async () => {
    const tickets = [ticket(1), ticket(2)] // independent
    const { ctx, events, patches } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute(
      {
        1: {
          status: 'failed',
          error: 'merge conflict on feature/demo',
          event: { type: 'merge.conflict.needs-human', message: 'ticket 1: merge conflict' },
        },
        2: { status: 'done', commits: ['ok'] },
      },
      calls,
    )

    const res = await burnRun(ctx, deps(execute))

    expect(calls.sort()).toEqual([1, 2]) // ticket 2 not skipped
    expect(res).toEqual({ status: 'failed', summary: '1/2 tickets done' })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'merge.conflict.needs-human', ticketId: 'tkt_1' }),
    )
    expect(patches).toContainEqual({ id: 'tkt_2', patch: { status: 'done', commits: ['ok'] } })
  })

  it('handles a zero-commit outcome (agent made no commits) as a failure', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'failed', error: 'agent made no commits' } })

    const res = await burnRun(ctx, deps(execute))

    expect(res.status).toBe('failed')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'ticket.failed',
        data: { error: 'agent made no commits' },
      }),
    )
  })

  it('cascades: a ticket blocked by a failed ticket is marked failed, never run', async () => {
    const tickets = [ticket(1), ticket(2, [1]), ticket(3, [2])]
    const { ctx, events, patches } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({ 1: { status: 'failed', error: 'boom' } }, calls)

    const res = await burnRun(ctx, deps(execute))

    expect(calls).toEqual([1]) // 2 and 3 never executed
    expect(res).toEqual({ status: 'failed', summary: '0/3 tickets done' })
    expect(patches).toContainEqual({
      id: 'tkt_2',
      patch: { status: 'failed', error: 'blocked by failed ticket 1' },
    })
    expect(patches).toContainEqual({
      id: 'tkt_3',
      patch: { status: 'failed', error: 'blocked by failed ticket 2' },
    })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ticket.blocked', ticketId: 'tkt_2' }),
    )
  })

  it('runs independent tickets even when one fails', async () => {
    const tickets = [ticket(1), ticket(2), ticket(3, [2])]
    const { ctx } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute(
      { 1: { status: 'done', commits: ['x'] }, 2: { status: 'failed', error: 'boom' } },
      calls,
    )

    const res = await burnRun(ctx, deps(execute))

    expect(calls.sort()).toEqual([1, 2]) // 3 blocked by failed 2
    expect(res).toEqual({ status: 'failed', summary: '1/3 tickets done' })
  })

  it('fails the run on a dependency cycle without executing anything', async () => {
    const tickets = [ticket(1, [2]), ticket(2, [1])]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({}, calls)

    const res = await burnRun(ctx, deps(execute))

    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    expect(res.summary).toMatch(/cycle/i)
    expect(events).toContainEqual(expect.objectContaining({ type: 'burn.cycle' }))
  })

  it('fails fast with auth.missing when docker sandbox has no token', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({}, calls)

    const res = await burnRun(ctx, deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker', mainBranch: 'main' }, hasAuthToken: false }))

    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    expect(events).toContainEqual(expect.objectContaining({ type: 'auth.missing' }))
  })

  it('proceeds under docker when a token is present', async () => {
    const tickets = [ticket(1)]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })

    const res = await burnRun(
      ctx,
      deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker', mainBranch: 'main' }, hasAuthToken: true }),
    )

    expect(res).toEqual({ status: 'succeeded', summary: '1/1 tickets done' })
  })

  it('fails fast with auth.missing when podman sandbox has no token', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({}, calls)

    const res = await burnRun(ctx, deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'podman', mainBranch: 'main' }, hasAuthToken: false }))

    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    expect(events).toContainEqual(expect.objectContaining({ type: 'auth.missing' }))
  })

  it('proceeds under podman when a token is present', async () => {
    const tickets = [ticket(1)]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })

    const res = await burnRun(
      ctx,
      deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'podman', mainBranch: 'main' }, hasAuthToken: true }),
    )

    expect(res).toEqual({ status: 'succeeded', summary: '1/1 tickets done' })
  })

  it('propagates an abort so the runner can finalize the run as cancelled', async () => {
    const tickets = [ticket(1)]
    const controller = new AbortController()
    controller.abort()
    const { ctx } = makeCtx(tickets, controller.signal)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })

    await expect(burnRun(ctx, deps(execute))).rejects.toThrow()
  })
})

describe('burnRun — concurrency (M2)', () => {
  /** Execute that tracks concurrent in-flight count and completes on a timer. */
  function trackingExecute(log: Array<[string, number]>, onPeak: (n: number) => void) {
    let active = 0
    return async (_ctx: WorkflowCtx, t: Ticket): Promise<TicketOutcome> => {
      active += 1
      onPeak(active)
      log.push(['start', t.seq])
      await new Promise((r) => setTimeout(r, 10))
      log.push(['end', t.seq])
      active -= 1
      return { status: 'done', commits: [`c${t.seq}`] }
    }
  }

  it('burns independent tickets in parallel up to the width, never beyond it', async () => {
    const tickets = [ticket(1), ticket(2), ticket(3)]
    const { ctx } = makeCtx(tickets)
    const log: Array<[string, number]> = []
    let peak = 0
    const execute = trackingExecute(log, (n) => {
      peak = Math.max(peak, n)
    })

    const res = await burnRun(ctx, deps(execute, { concurrency: 2 }))

    expect(res).toEqual({ status: 'succeeded', summary: '3/3 tickets done' })
    expect(peak).toBe(2) // both slots used, cap respected
  })

  it('a dependent ticket waits for its blocker even with free slots', async () => {
    const tickets = [ticket(1), ticket(2), ticket(3, [1])]
    const { ctx } = makeCtx(tickets)
    const log: Array<[string, number]> = []
    const execute = trackingExecute(log, () => {})

    const res = await burnRun(ctx, deps(execute, { concurrency: 3 }))

    expect(res).toEqual({ status: 'succeeded', summary: '3/3 tickets done' })
    // ticket 3 must start strictly after its blocker (1) ended
    const end1 = log.findIndex(([k, s]) => k === 'end' && s === 1)
    const start3 = log.findIndex(([k, s]) => k === 'start' && s === 3)
    expect(end1).toBeGreaterThanOrEqual(0)
    expect(start3).toBeGreaterThan(end1)
  })

  it('cascade still fails dependents of a failed ticket at width > 1', async () => {
    const tickets = [ticket(1), ticket(2, [1]), ticket(3)]
    const { ctx, patches } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute(
      { 1: { status: 'failed', error: 'boom' }, 3: { status: 'done', commits: ['x'] } },
      calls,
    )

    const res = await burnRun(ctx, deps(execute, { concurrency: 3 }))

    expect(calls.sort()).toEqual([1, 3]) // 2 never executed
    expect(res).toEqual({ status: 'failed', summary: '1/3 tickets done' })
    expect(patches).toContainEqual({
      id: 'tkt_2',
      patch: { status: 'failed', error: 'blocked by failed ticket 1' },
    })
  })

  it('an abort with several tickets in flight drains them all and rejects once', async () => {
    const tickets = [ticket(1), ticket(2)]
    const controller = new AbortController()
    const { ctx } = makeCtx(tickets, controller.signal)
    let started = 0
    const execute = (c: WorkflowCtx, _t: Ticket): Promise<TicketOutcome> =>
      new Promise((_resolve, reject) => {
        started += 1
        if (started === 2) queueMicrotask(() => controller.abort())
        c.signal.addEventListener('abort', () => reject(new Error('run aborted')), { once: true })
      })

    await expect(burnRun(ctx, deps(execute, { concurrency: 2 }))).rejects.toThrow('run aborted')
    expect(started).toBe(2) // both were genuinely in flight when the abort hit
  })
})

describe('burnRun — cancelled tickets (revisit surgery)', () => {
  it('skips cancelled tickets, unblocks their dependents, and reports them in the summary', async () => {
    const cancelled: Ticket = { ...ticket(1), status: 'cancelled' }
    const tickets = [cancelled, ticket(2, [1]), ticket(3)]
    const { ctx, patches } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute(
      { 2: { status: 'done', commits: ['a'] }, 3: { status: 'done', commits: ['b'] } },
      calls,
    )

    const res = await burnRun(ctx, deps(execute))

    expect(calls.sort()).toEqual([2, 3]) // 1 never executed; 2 was NOT cascaded-failed
    expect(res).toEqual({ status: 'succeeded', summary: '2/2 tickets done (1 cancelled)' })
    expect(patches.map((p) => p.id)).not.toContain('tkt_1') // cancelled row untouched
  })

  it('does not trip the cycle guard on edges through cancelled tickets', async () => {
    // 1 ⇄ 2 would be a cycle, but 2 is cancelled — only burnable tickets count.
    const two: Ticket = { ...ticket(2, [1]), status: 'cancelled' }
    const tickets = [ticket(1, [2]), two]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })

    const res = await burnRun(ctx, deps(execute))

    expect(res).toEqual({ status: 'succeeded', summary: '1/1 tickets done (1 cancelled)' })
  })

  it('previously-done tickets still count toward success on a re-burn', async () => {
    // A restarted run: 1 already done, 2 reset to pending, 3 cancelled.
    const doneTicket: Ticket = { ...ticket(1), status: 'done', commits: ['old'] }
    const cancelledTicket: Ticket = { ...ticket(3), status: 'cancelled' }
    const tickets = [doneTicket, ticket(2, [1]), cancelledTicket]
    const { ctx } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({ 2: { status: 'done', commits: ['new'] } }, calls)

    const res = await burnRun(ctx, deps(execute))

    expect(calls).toEqual([2]) // only the pending ticket burns
    expect(res).toEqual({ status: 'succeeded', summary: '2/2 tickets done (1 cancelled)' })
  })
})
