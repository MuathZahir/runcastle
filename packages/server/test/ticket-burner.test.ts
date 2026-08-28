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
  patch: Partial<Pick<Ticket, 'status' | 'commits' | 'error' | 'digest'>>
}

function makeCtx(tickets: Ticket[], signal?: AbortSignal) {
  const events: Emitted[] = []
  const patches: Patch[] = []
  const ctx: WorkflowCtx = {
    runId: 'run_1',
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
    config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'noSandbox', burnConcurrency: 3 },
    runtime: 'claude-code',
    hasAuthToken: true,
    exec: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }),
    concurrency: 1,
    executeTicketRun: execute,
    ...over,
  }
}

describe('burnRun — scheduling and summary', () => {
  it('probes the container image runtime before proceeding with a docker burn', async () => {
    const tickets = [ticket(1), ticket(2)]
    const { ctx } = makeCtx(tickets)
    const calls: number[] = []
    const probes: Array<{ command: string; args: string[] }> = []
    const execute = fakeExecute(
      { 1: { status: 'done', commits: ['a'] }, 2: { status: 'done', commits: ['b'] } },
      calls,
    )

    const res = await burnRun(
      ctx,
      deps(execute, {
        config: {
          serverPort: 4512,
          model: 'm',
          stepModels: {},
          sandbox: 'docker',
          sandboxImage: 'sandcastle:test',
        },
        runtime: 'codex',
        exec: async (command, args) => {
          probes.push({ command, args })
          return { ok: true, code: 0, stdout: 'codex 1.0', stderr: '' }
        },
      }),
    )

    expect(probes).toEqual([
      {
        command: 'docker',
        args: ['run', '--rm', '--entrypoint', 'codex', 'sandcastle:test', '--version'],
      },
    ])
    expect(calls).toEqual([1, 2])
    expect(res.status).toBe('succeeded')
  })

  it('aborts before creating a sandbox when the image lacks the runtime binary', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({}, calls)

    const res = await burnRun(
      ctx,
      deps(execute, {
        config: {
          serverPort: 4512,
          model: 'm',
          stepModels: {},
          sandbox: 'podman',
          sandboxImage: 'sandcastle:runcastle-demo',
        },
        runtime: 'claude-code',
        exec: async () => ({ ok: true, code: 127, stdout: '', stderr: 'claude: not found' }),
      }),
    )

    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'burn.image_runtime_missing',
        message:
          'claude is not installed in image sandcastle:runcastle-demo — the image predates the burner Dockerfile. Rebuild it from Settings → AFK burns (Rebuild image).',
      }),
    )
  })

  it('never probes the image for noSandbox burns', async () => {
    const tickets = [ticket(1)]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })
    let probes = 0

    const res = await burnRun(
      ctx,
      deps(execute, {
        runtime: 'codex',
        exec: async () => {
          probes += 1
          return { ok: true, code: 0, stdout: '', stderr: '' }
        },
      }),
    )

    expect(probes).toBe(0)
    expect(res.status).toBe('succeeded')
  })

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

  it('stores the digest of a done ticket and emits no digest.missing', async () => {
    const tickets = [ticket(1)]
    const { ctx, events, patches } = makeCtx(tickets)
    const digest = 'Did the thing.\n\nSurprise: the seam was already half-built.'
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'], digest } })

    await burnRun(ctx, deps(execute))

    expect(patches).toContainEqual({
      id: 'tkt_1',
      patch: { status: 'done', commits: ['a'], digest },
    })
    expect(events.map((e) => e.type)).not.toContain('digest.missing')
  })

  it('lands a done ticket with no digest and flags the gap with digest.missing', async () => {
    const tickets = [ticket(1)]
    const { ctx, events, patches } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })

    const res = await burnRun(ctx, deps(execute))

    expect(res).toEqual({ status: 'succeeded', summary: '1/1 tickets done' })
    expect(patches).toContainEqual({
      id: 'tkt_1',
      patch: { status: 'done', commits: ['a'], digest: undefined },
    })
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'digest.missing', ticketId: 'tkt_1' }),
    )
  })

  it('carries this run’s harvested digests as one seq-ordered aggregate', async () => {
    const tickets = [ticket(1), ticket(2, [1])]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({
      1: { status: 'done', commits: ['a'], digest: 'Wired the first seam.' },
      2: { status: 'done', commits: ['b'], digest: 'Wired the second seam.' },
    })

    const res = await burnRun(ctx, deps(execute))

    expect(res.summary).toBe('2/2 tickets done')
    expect(res.digest).toBe(
      '## ticket 1 — Ticket 1\n\nWired the first seam.\n\n' +
        '## ticket 2 — Ticket 2\n\nWired the second seam.',
    )
  })

  it('keeps the digests of the tickets that landed when the run partially fails', async () => {
    const tickets = [ticket(1), ticket(2)]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({
      1: { status: 'done', commits: ['a'], digest: 'Landed this one.' },
      2: { status: 'failed', error: 'boom' },
    })

    const res = await burnRun(ctx, deps(execute))

    expect(res.status).toBe('failed')
    expect(res.digest).toBe('## ticket 1 — Ticket 1\n\nLanded this one.')
  })

  it('composes no aggregate when the run harvested no digest at all', async () => {
    const tickets = [ticket(1)]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })

    expect((await burnRun(ctx, deps(execute))).digest).toBeUndefined()
  })

  it('never stores a digest for a failed ticket', async () => {
    const tickets = [ticket(1)]
    const { ctx, events, patches } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'failed', error: 'boom' } })

    await burnRun(ctx, deps(execute))

    expect(patches.every((p) => p.patch.digest === undefined)).toBe(true)
    expect(events.map((e) => e.type)).not.toContain('digest.missing')
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

    const res = await burnRun(ctx, deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker' }, hasAuthToken: false }))

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
      deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker' }, hasAuthToken: true }),
    )

    expect(res).toEqual({ status: 'succeeded', summary: '1/1 tickets done' })
  })

  it('fails fast with auth.missing when podman sandbox has no token', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({}, calls)

    const res = await burnRun(ctx, deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'podman' }, hasAuthToken: false }))

    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    expect(events).toContainEqual(expect.objectContaining({ type: 'auth.missing' }))
  })

  /**
   * A Codex burn's credential is the operator's own `codex login`, borrowed
   * into the container — so "ready" is a login, and the hint that aborts a run
   * must send them to `codex login`, never to an API key they need not mint.
   */
  it('sends an unauthed codex run to `codex login`, and never names an API key', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({}, calls)

    const res = await burnRun(
      ctx,
      deps(execute, {
        config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker', mainBranch: 'main' },
        runtime: 'codex',
        hasAuthToken: false,
      }),
    )

    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    const missing = events.find((e) => e.type === 'auth.missing')
    expect(missing?.message).toContain('codex login')
    expect(missing?.message).not.toContain('CODEX_API_KEY')
  })

  /**
   * The cross-runtime gap: a Codex-assigned ticket inside a Claude run passed
   * the run-level check (the Claude token is there) and only discovered it had
   * no Codex credentials after building a container.
   */
  it('fails a ticket whose OWN runtime is unauthed, without touching the rest', async () => {
    const tickets = [ticket(1), ticket(2)]
    const { ctx, events, patches } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({ 2: { status: 'done', commits: ['a'] } }, calls)

    const res = await burnRun(
      ctx,
      deps(execute, {
        config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker', mainBranch: 'main' },
        hasAuthToken: true,
        ticketAuthMissing: (t) => (t.seq === 1 ? 'codex' : undefined),
      }),
    )

    // Ticket 1 never reached the executor; ticket 2 burned as usual.
    expect(calls).toEqual([2])
    expect(res.status).toBe('failed')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'auth.missing', message: expect.stringContaining('codex login') }),
    )
    const failed = patches.find((p) => p.patch.status === 'failed')
    expect(failed?.patch.error).toContain('codex login')
  })

  it('leaves every ticket alone when each one’s own runtime is authed', async () => {
    const tickets = [ticket(1)]
    const { ctx } = makeCtx(tickets)
    const calls: number[] = []
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } }, calls)

    const res = await burnRun(
      ctx,
      deps(execute, {
        config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker', mainBranch: 'main' },
        ticketAuthMissing: () => undefined,
      }),
    )

    expect(calls).toEqual([1])
    expect(res).toEqual({ status: 'succeeded', summary: '1/1 tickets done' })
  })

  it('proceeds under podman when a token is present', async () => {
    const tickets = [ticket(1)]
    const { ctx } = makeCtx(tickets)
    const execute = fakeExecute({ 1: { status: 'done', commits: ['a'] } })

    const res = await burnRun(
      ctx,
      deps(execute, { config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'podman' }, hasAuthToken: true }),
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

/**
 * The fix wave (decision 1): a review reports its defects as it finds them, each
 * one minting a fix ticket into the store, and the run those tickets were born
 * into burns them itself rather than leaving them for a human to start.
 */
describe('burnRun — fix tickets minted while the run is live', () => {
  const reviewTicket = (seq: number, blockedBy: number[] = []): Ticket => ({
    ...ticket(seq, blockedBy),
    kind: 'review',
  })

  const fixTicket = (seq: number, findingId: string, reviewSeq: number): Ticket => ({
    ...ticket(seq, [reviewSeq]),
    kind: 'implementation',
    originFindingId: findingId,
  })

  /** A ctx whose store the review can mint into, plus the finding mirror. */
  function makeFixCtx(tickets: Ticket[]) {
    const base = makeCtx(tickets)
    const findings: { id: string; progress: string; reason?: string }[] = []
    base.ctx.listTickets = () => tickets
    base.ctx.updateFinding = (id, progress, reason) => {
      findings.push({ id, progress, ...(reason ? { reason } : {}) })
    }
    return { ...base, findings }
  }

  it('admits them once the review is terminal and burns them in the same run', async () => {
    const tickets = [ticket(1), reviewTicket(2, [1])]
    const { ctx, events } = makeFixCtx(tickets)
    const calls: number[] = []
    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      calls.push(t.seq)
      if (t.kind !== 'review') return { status: 'done', commits: ['sha'] }
      // What `report_finding` does while the review is still burning.
      tickets.push(fixTicket(3, 'find_a', 2), fixTicket(4, 'find_b', 2))
      return { status: 'done', commits: [] }
    }

    const res = await burnRun(ctx, deps(execute))

    expect(calls).toEqual([1, 2, 3, 4])
    // The denominator counts what the run ended up burning, not what it opened
    // with — and it finalizes once, after the fix wave is terminal too.
    expect(res).toEqual({ status: 'succeeded', summary: '4/4 tickets done' })
    expect(events.filter((e) => e.type === 'burn.summary')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'burn.admitted')).toMatchObject([
      { data: { seqs: [3, 4] } },
    ])
  })

  it('leaves the run alone when the review minted nothing', async () => {
    const tickets = [ticket(1), reviewTicket(2, [1])]
    const { ctx, events, findings } = makeFixCtx(tickets)
    const execute = fakeExecute({
      1: { status: 'done', commits: ['a'] },
      2: { status: 'done', commits: [] },
    })

    const res = await burnRun(ctx, deps(execute))

    expect(res).toEqual({ status: 'succeeded', summary: '2/2 tickets done' })
    expect(events.map((e) => e.type)).not.toContain('burn.admitted')
    expect(findings).toEqual([]) // no ticket here came from a finding
  })

  it('fails one fix ticket without touching its siblings, and marks each finding', async () => {
    const tickets = [reviewTicket(1)]
    const { ctx, findings } = makeFixCtx(tickets)
    const calls: number[] = []
    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      calls.push(t.seq)
      if (t.kind === 'review') {
        tickets.push(fixTicket(2, 'find_a', 1), fixTicket(3, 'find_b', 1))
        return { status: 'done', commits: [] }
      }
      return t.seq === 2
        ? { status: 'failed', error: 'the repro still reproduces' }
        : { status: 'done', commits: ['sha'] }
    }

    const res = await burnRun(ctx, deps(execute))

    // A fix ticket is blocked by the review, which is done — a sibling that
    // fails is not its blocker, so the cascade never reaches it.
    expect(calls).toEqual([1, 2, 3])
    expect(tickets[2]).toMatchObject({ status: 'done' })
    expect(res).toEqual({ status: 'failed', summary: '2/3 tickets done' })
    expect(findings).toEqual([
      { id: 'find_a', progress: 'fixing' },
      { id: 'find_a', progress: 'failed', reason: 'the repro still reproduces' },
      { id: 'find_b', progress: 'fixing' },
      { id: 'find_b', progress: 'fixed' },
    ])
  })
})
