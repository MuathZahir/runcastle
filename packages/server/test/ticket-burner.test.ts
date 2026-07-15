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
  size: 'full',
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
    config: { serverPort: 4512, model: 'm', smokeModel: 's', sandbox: 'noSandbox', mainBranch: 'main' },
    hasAuthToken: true,
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

    const res = await burnRun(ctx, deps(execute, { config: { serverPort: 4512, model: 'm', smokeModel: 's', sandbox: 'docker', mainBranch: 'main' }, hasAuthToken: false }))

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
      deps(execute, { config: { serverPort: 4512, model: 'm', smokeModel: 's', sandbox: 'docker', mainBranch: 'main' }, hasAuthToken: true }),
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
