import type { AgentRuntime, Feature, Project, Ticket, WorkflowCtx } from '@runcastle/core'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { BurnDeps, TicketOutcome } from '../src/workflows/ticket-burner'
import {
  burnRun,
  registerTicketAbort,
  releaseTicketAbort,
  ticketStopReason,
} from '../src/workflows/ticket-burner'

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
    kind: 'implementation',
    passKind: 'review',
    status: 'pending',
    commits: [],
    reviewedCommit: null,
    completedAt: null,
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
  phase: 'building',
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
  patch: Partial<Pick<Ticket, 'status' | 'commits' | 'error' | 'digest' | 'reviewedCommit'>>
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

/** A promise the test resolves by hand, to sequence concurrent fake lanes. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
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
  it('stamps a completed review with the feature branch head', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'runcastle-review-head-'))
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: repoPath })
      git('init', '-b', 'feature/demo')
      git('config', 'user.email', 'test@runcastle.dev')
      git('config', 'user.name', 'Runcastle Test')
      writeFileSync(join(repoPath, 'README.md'), 'reviewed build')
      git('add', 'README.md')
      git('commit', '-m', 'reviewed build')
      const sha = git('rev-parse', 'HEAD').toString().trim()
      const tickets = [{ ...ticket(1), kind: 'review' as const }]
      const { ctx, patches } = makeCtx(tickets)
      ctx.project = { ...project, repoPath }

      await burnRun(ctx, deps(fakeExecute({ 1: { status: 'done', commits: [] } })))

      expect(patches).toContainEqual({
        id: 'tkt_1',
        patch: { status: 'done', commits: [], digest: undefined, reviewedCommit: sha },
      })
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

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
          return { ok: true, code: 0, stdout: '', stderr: '' }
        },
      }),
    )

    expect(probes).toEqual([
      {
        command: 'docker',
        args: [
          'run',
          '--rm',
          '--entrypoint',
          'sh',
          'sandcastle:test',
          '-c',
          'for c in codex; do command -v "$c" >/dev/null 2>&1 || echo "$c"; done',
        ],
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
          'claude is not installed in image sandcastle:runcastle-demo — the image predates the burner Dockerfile. Rebuild it from Settings → Burns (Rebuild image).',
      }),
    )
  })

  /**
   * The incident this feature exists for: a Java project's `mvn` setup command
   * in an image that has no JVM. It used to surface as an exit 127 the burner
   * RETRIED; now the run never starts a ticket container.
   */
  it('aborts naming the setup/verify toolchain the image lacks', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []
    const probes: Array<{ command: string; args: string[] }> = []

    const res = await burnRun(
      ctx,
      deps(fakeExecute({}, calls), {
        config: {
          serverPort: 4512,
          model: 'm',
          stepModels: {},
          sandbox: 'docker',
          sandboxImage: 'sandcastle:runcastle-demo',
          setupCommand: 'mvn -q -DskipTests install',
          verifyCommands: 'mvn -q test',
        },
        runtime: 'claude-code',
        exec: async (command, args) => {
          probes.push({ command, args })
          return { ok: true, code: 0, stdout: 'mvn\n', stderr: '' }
        },
      }),
    )

    expect(probes[0]?.args).toEqual([
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      'sandcastle:runcastle-demo',
      '-c',
      'for c in claude mvn; do command -v "$c" >/dev/null 2>&1 || echo "$c"; done',
    ])
    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'burn.image_runtime_missing',
        message:
          'mvn is not installed in image sandcastle:runcastle-demo — add it to .runcastle/sandbox/Dockerfile and rebuild.',
      }),
    )
  })

  /**
   * A project's own prepared columns are what the burn actually runs, so they
   * are what gets probed — the global config is only the fallback.
   */
  it('preflights the project’s own setup command over the global one', async () => {
    const tickets = [ticket(1)]
    const { ctx } = makeCtx(tickets)
    ctx.project = { ...project, setupCommand: 'gradle assemble' }
    const probes: Array<{ command: string; args: string[] }> = []

    await burnRun(
      ctx,
      deps(fakeExecute({ 1: { status: 'done', commits: ['a'] } }), {
        config: {
          serverPort: 4512,
          model: 'm',
          stepModels: {},
          sandbox: 'docker',
          sandboxImage: 'sandcastle:test',
          setupCommand: 'mvn install',
        },
        runtime: 'codex',
        exec: async (command, args) => {
          probes.push({ command, args })
          return { ok: true, code: 0, stdout: '', stderr: '' }
        },
      }),
    )

    expect(probes[0]?.args.at(-1)).toBe(
      'for c in codex gradle; do command -v "$c" >/dev/null 2>&1 || echo "$c"; done',
    )
  })

  /** The agent binary keeps its own wording: that one is fixed by a rebuild. */
  it('keeps the stale-image wording when the sweep reports the agent binary absent', async () => {
    const tickets = [ticket(1)]
    const { ctx, events } = makeCtx(tickets)
    const calls: number[] = []

    const res = await burnRun(
      ctx,
      deps(fakeExecute({}, calls), {
        config: {
          serverPort: 4512,
          model: 'm',
          stepModels: {},
          sandbox: 'docker',
          sandboxImage: 'sandcastle:runcastle-demo',
          setupCommand: 'mvn install',
        },
        runtime: 'claude-code',
        exec: async () => ({ ok: true, code: 0, stdout: 'claude\nmvn\n', stderr: '' }),
      }),
    )

    expect(calls).toEqual([])
    expect(res.status).toBe('failed')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'burn.image_runtime_missing',
        message:
          'claude is not installed in image sandcastle:runcastle-demo — the image predates the burner Dockerfile. Rebuild it from Settings → Burns (Rebuild image).',
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

/**
 * The halt (decisions 3–4): a failure that is a fact about the ACCOUNT — a
 * lapsed login, an exhausted plan, an image with no agent binary — ends the
 * run's scheduling instead of being rediscovered one container at a time. What
 * never started stays `pending` for the re-burn after the operator fixes it
 * (ADR-0006); what is burning on a healthy runtime still lands.
 */
describe('burnRun — a run-fatal failure halts the run', () => {
  const USAGE_LIMIT = 'Claude AI usage limit reached|1751500000'

  const usageLimit = (): TicketOutcome => ({
    status: 'failed',
    error: USAGE_LIMIT,
    runFatal: { runtime: 'claude-code' },
  })

  it('starts no further ticket, and leaves every unstarted one pending', async () => {
    const tickets = [ticket(1), ticket(2), ticket(3, [2])]
    const { ctx, patches } = makeCtx(tickets)
    const calls: number[] = []
    // Only ticket 1 has a canned outcome: the fake throws for anything else, so
    // a dispatch that should not happen fails the run loudly.
    const execute = fakeExecute({ 1: usageLimit() }, calls)

    const res = await burnRun(ctx, deps(execute))

    expect(calls).toEqual([1])
    expect(tickets[1]).toMatchObject({ status: 'pending' })
    expect(tickets[2]).toMatchObject({ status: 'pending' })
    // Not failed, not cancelled — nothing at all was written for them.
    expect(patches.filter((p) => p.id !== 'tkt_1')).toEqual([])
    expect(res.status).toBe('failed')
  })

  it('emits exactly one run.halted and names the cause in the run summary', async () => {
    const tickets = [ticket(1), ticket(2)]
    const { ctx, events } = makeCtx(tickets)

    const res = await burnRun(ctx, deps(fakeExecute({ 1: usageLimit() })))

    expect(events.filter((e) => e.type === 'run.halted')).toEqual([
      {
        type: 'run.halted',
        message: `run halted: ${USAGE_LIMIT}`,
        ticketId: 'tkt_1',
        data: { runtime: 'claude-code', ticketSeq: 1 },
      },
    ])
    // The failing ticket still keeps its own record of what killed it.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ticket.failed', ticketId: 'tkt_1' }),
    )
    expect(res).toEqual({
      status: 'failed',
      summary: `run halted at ticket 1: ${USAGE_LIMIT} — 0/2 tickets done`,
    })
  })

  it('never starts the review ticket, and appends no verification pass', async () => {
    const tickets = [ticket(1), { ...ticket(2, [1]), kind: 'review' as const }]
    const { ctx, events } = makeCtx(tickets)
    const stored: unknown[] = []
    ctx.listTickets = () => tickets
    ctx.storeTickets = (input) => {
      stored.push(...input)
      return []
    }
    const calls: number[] = []

    await burnRun(ctx, deps(fakeExecute({ 1: usageLimit() }, calls)))

    // Without the halt the review would start: its only blocker is terminal.
    expect(calls).toEqual([1])
    expect(tickets[1]).toMatchObject({ status: 'pending' })
    expect(stored).toEqual([])
    expect(events.map((e) => e.type)).not.toContain('ticket.verification_minted')
  })

  it('stops the in-flight lane on the failing runtime and lets the other runtime land', async () => {
    const tickets = [ticket(1), ticket(2), ticket(3)]
    const runtimeOf: Record<number, AgentRuntime> = { 1: 'codex', 2: 'codex', 3: 'claude-code' }
    const { ctx, patches } = makeCtx(tickets)
    const lapsedLogin = 'codex exited with code 1: not logged in'
    const allBurning = deferred()
    const doomedLaneStopped = deferred()
    let started = 0
    let healthyLaneAborted: boolean | undefined

    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      // What the real executor registers, and what a stop (or a halt) reaches
      // a burning lane through.
      const abort = registerTicketAbort(t.id)
      started += 1
      if (started === tickets.length) allBurning.resolve()
      try {
        await allBurning.promise
        if (t.seq === 1) {
          return { status: 'failed', error: lapsedLogin, runFatal: { runtime: 'codex' } }
        }
        if (t.seq === 2) {
          // Burns on until something aborts it — the halt is what does.
          await new Promise<void>((resolve) => {
            abort.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          doomedLaneStopped.resolve()
          return { status: 'failed', error: ticketStopReason(abort.signal.reason) }
        }
        await doomedLaneStopped.promise
        healthyLaneAborted = abort.signal.aborted
        return { status: 'done', commits: ['sha-3'] }
      } finally {
        releaseTicketAbort(t.id)
      }
    }

    const res = await burnRun(
      ctx,
      deps(execute, { concurrency: 3, ticketRuntime: (t) => runtimeOf[t.seq] }),
    )

    expect(patches).toContainEqual({
      id: 'tkt_2',
      patch: { status: 'failed', error: `stopped: run halted (${lapsedLogin})` },
    })
    // The claude lane knows nothing about a dead codex login: it finishes and
    // its work lands.
    expect(healthyLaneAborted).toBe(false)
    expect(patches).toContainEqual({
      id: 'tkt_3',
      patch: { status: 'done', commits: ['sha-3'], digest: undefined },
    })
    expect(res.summary).toBe(`run halted at ticket 1: ${lapsedLogin} — 1/3 tickets done`)
  })
})

/**
 * Reassignment mid-burn: the human changes a still-queued ticket's model (or
 * its body) while the run is live, and the lane launches on the fresh row —
 * executor and per-ticket auth precheck reading the same one. A launched lane
 * is committed to what it started with, and a ctx with no store seam schedules
 * exactly as it did before.
 */
describe('burnRun — the row a lane launches with', () => {
  /** A ctx whose store is a set of rows apart from the run-start snapshot. */
  function makeStoreCtx(snapshot: Ticket[]) {
    const store = snapshot.map((t) => ({ ...t }))
    const base = makeCtx(snapshot)
    base.ctx.listTickets = () => store
    return { ...base, store }
  }

  /**
   * What `ticket.edit` does to a row while the run is live. Replaces the row
   * rather than mutating it in place, the way a store that re-reads its rows
   * hands back a fresh object every time.
   */
  function edit(store: Ticket[], seq: number, patch: Partial<Ticket>): void {
    const at = store.findIndex((t) => t.seq === seq)
    if (at >= 0) store[at] = { ...store[at], ...patch }
  }

  it('launches a still-queued ticket on the model it was reassigned to mid-run', async () => {
    const { ctx, store } = makeStoreCtx([ticket(1), ticket(2)])
    const launched: { seq: number; model?: string }[] = []
    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      launched.push({ seq: t.seq, model: t.model })
      if (t.seq === 1) edit(store, 2, { model: 'gpt-5-codex' })
      return { status: 'done', commits: ['sha'] }
    }

    const res = await burnRun(ctx, deps(execute))

    expect(launched).toEqual([
      { seq: 1, model: undefined },
      { seq: 2, model: 'gpt-5-codex' },
    ])
    expect(res).toEqual({ status: 'succeeded', summary: '2/2 tickets done' })
  })

  it('launches a still-queued ticket with the body it was edited to', async () => {
    const { ctx, store } = makeStoreCtx([ticket(1), ticket(2)])
    const launched: Ticket[] = []
    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      launched.push(t)
      if (t.seq === 1) {
        edit(store, 2, {
          goal: 'the goal the human rewrote',
          context: 'the context the human rewrote',
          acceptanceCriteria: ['the criterion the human added'],
        })
      }
      return { status: 'done', commits: ['sha'] }
    }

    await burnRun(ctx, deps(execute))

    expect(launched[1]).toMatchObject({
      goal: 'the goal the human rewrote',
      context: 'the context the human rewrote',
      acceptanceCriteria: ['the criterion the human added'],
    })
  })

  it('prechecks the reassigned runtime rather than the one the run opened with', async () => {
    const { ctx, events, store } = makeStoreCtx([ticket(1), ticket(2)])
    const prechecked: (string | undefined)[] = []
    const calls: number[] = []
    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      calls.push(t.seq)
      if (t.seq === 1) edit(store, 2, { model: 'gpt-5-codex' })
      return { status: 'done', commits: ['sha'] }
    }

    const res = await burnRun(
      ctx,
      deps(execute, {
        config: { serverPort: 4512, model: 'm', stepModels: {}, sandbox: 'docker', mainBranch: 'main' },
        hasAuthToken: true,
        ticketAuthMissing: (t) => {
          prechecked.push(t.model)
          return t.model === 'gpt-5-codex' ? 'codex' : undefined
        },
      }),
    )

    // The precheck saw the same fresh row the executor would have — and refused
    // it, so ticket 2 never reached the executor at all.
    expect(prechecked).toEqual([undefined, 'gpt-5-codex'])
    expect(calls).toEqual([1])
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'auth.missing', message: expect.stringContaining('codex login') }),
    )
    expect(res.status).toBe('failed')
  })

  it('launches the snapshot row when the ctx has no store to re-read', async () => {
    const snapshot = [ticket(1), ticket(2)]
    const store = snapshot.map((t) => ({ ...t }))
    const { ctx } = makeCtx(snapshot) // no `listTickets`
    const launched: { seq: number; model?: string }[] = []
    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      launched.push({ seq: t.seq, model: t.model })
      if (t.seq === 1) edit(store, 2, { model: 'gpt-5-codex' })
      return { status: 'done', commits: ['sha'] }
    }

    const res = await burnRun(ctx, deps(execute))

    expect(launched).toEqual([
      { seq: 1, model: undefined },
      { seq: 2, model: undefined },
    ])
    expect(res).toEqual({ status: 'succeeded', summary: '2/2 tickets done' })
  })

  it('leaves a lane that already launched on the model it started with', async () => {
    const { ctx, store } = makeStoreCtx([ticket(1)])
    let modelAfterEdit: string | undefined = 'never read'
    const execute: BurnDeps['executeTicketRun'] = async (_c, t) => {
      edit(store, 1, { model: 'gpt-5-codex' })
      modelAfterEdit = t.model
      return { status: 'done', commits: ['sha'] }
    }

    const res = await burnRun(ctx, deps(execute))

    expect(modelAfterEdit).toBeUndefined()
    expect(res).toEqual({ status: 'succeeded', summary: '1/1 tickets done' })
  })
})
