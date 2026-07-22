import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowDef } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { GateError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { retryTicket } from '../src/services/features'
import { findPreservedTicketBranch, listTicketAttemptBranches } from '../src/services/git'
import { getTicket, listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import {
  buildRetryNotes,
  classifyTicketRunError,
  delayUnlessAborted,
  retryDelayMs,
  stopTicketRun,
} from '../src/workflows/ticket-burner'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Burn robustness (attempt chaining): the transient-error classifier and retry
 * prompt notes that drive in-run auto-retry, plus the per-ticket manual retry
 * service (`retryTicket`) behind `trpc ticket.retry`.
 */

describe('classifyTicketRunError', () => {
  it.each([
    'claude-code exited with code 1:\n',
    'claude-code exited with code 137:\nkilled',
    'AgentIdleTimeoutError: agent produced no output for 600s',
    'API Error: Connection closed mid-response',
    'fetch failed: ECONNRESET',
    'read ETIMEDOUT',
    'overloaded_error: Overloaded',
    'rate limit exceeded, try again later',
    'HTTP 529 too many requests',
    'internal server error',
    'Session capture failed: no space left on device',
  ])('retryable: %s', (msg) => {
    expect(classifyTicketRunError(new Error(msg))).toBe('retryable')
  })

  it.each([
    'claude-code exited with code 1:\nInvalid API key',
    'authentication_error: unauthorized',
    'Your credit balance is too low',
    'run `claude setup-token` — OAuth token missing',
    'there is an issue with the selected model',
    'resumeSession "abc" not found under /home',
    'fatal: some completely unknown git explosion',
  ])('fatal: %s', (msg) => {
    expect(classifyTicketRunError(new Error(msg))).toBe('fatal')
  })

  it('defaults unknown throws to fatal (never blind-retry)', () => {
    expect(classifyTicketRunError('weird')).toBe('fatal')
    expect(classifyTicketRunError(undefined)).toBe('fatal')
  })
})

describe('retryDelayMs', () => {
  it('backs off 5s → 10s → 20s and caps at 30s', () => {
    expect(retryDelayMs(1)).toBe(5_000)
    expect(retryDelayMs(2)).toBe(10_000)
    expect(retryDelayMs(3)).toBe(20_000)
    expect(retryDelayMs(4)).toBe(30_000)
    expect(retryDelayMs(9)).toBe(30_000)
  })
})

describe('buildRetryNotes', () => {
  it('tells the resumed agent about preserved commits and how to continue', () => {
    const notes = buildRetryNotes({ error: 'claude-code exited with code 1:', commitCount: 3 })
    expect(notes).toContain('3 commit(s)')
    expect(notes).toContain('git log')
    expect(notes).toContain('claude-code exited with code 1:')
    expect(notes).toMatch(/do NOT revert/i)
  })

  it('covers the nothing-committed case', () => {
    const notes = buildRetryNotes({ commitCount: 0 })
    expect(notes).toContain('starting clean')
    expect(notes).not.toContain('are already on your branch')
  })
})

describe('delayUnlessAborted', () => {
  it('resolves early (never rejects) when the signal aborts mid-wait', async () => {
    const controller = new AbortController()
    const p = delayUnlessAborted(60_000, controller.signal)
    controller.abort(new Error('stop'))
    await expect(p).resolves.toBeUndefined()
  })

  it('resolves immediately on an already-aborted signal', async () => {
    await expect(delayUnlessAborted(60_000, AbortSignal.abort())).resolves.toBeUndefined()
  })
})

describe('stopTicketRun', () => {
  it('returns false when the ticket has no live agent', () => {
    expect(stopTicketRun('tkt_nope')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fallback branch lookup — real git fixtures
// ---------------------------------------------------------------------------

const tmpDirs: string[] = []
afterAll(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // best-effort — Windows can hold git locks briefly
    }
  }
})

/** git init -b main + local identity + one seed commit + feature/demo branch. */
async function initRepoWithFeature(): Promise<{ dir: string; g: SimpleGit }> {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-robust-'))
  tmpDirs.push(dir)
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  await g.checkoutLocalBranch('feature/demo')
  return { dir, g }
}

/** Commit one file on a new branch off feature/demo, then return to feature/demo. */
async function seedAttemptBranch(
  dir: string,
  g: SimpleGit,
  branch: string,
  file: string,
  committerDate: string,
): Promise<void> {
  await g.checkoutLocalBranch(branch)
  writeFileSync(join(dir, file), `${file}\n`)
  await g.add([file])
  // simple-git refuses GIT_EDITOR in a custom child env (allowUnsafeEditor),
  // so strip editor vars from the inherited environment before pinning dates.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.includes('EDITOR')) env[k] = v
  }
  await g
    .env({ ...env, GIT_COMMITTER_DATE: committerDate, GIT_AUTHOR_DATE: committerDate })
    .commit(`ticket(2): ${file}`)
  await g.checkout('feature/demo')
}

describe('findPreservedTicketBranch (fallback for pre-attemptBranch burns)', () => {
  it('finds the newest unmerged attempt branch by the deterministic prefix', async () => {
    const { dir, g } = await initRepoWithFeature()
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/2-old1', 'old.txt', '2026-07-01T00:00:00Z')
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/2-new1', 'new.txt', '2026-07-20T00:00:00Z')
    // Same tip as feature/demo — nothing preserved, never a candidate.
    await g.branch(['runcastle/ticket/demo/2-empt', 'feature/demo'])
    // Different seq — different ticket, out of scope.
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/3-oth1', 'other.txt', '2026-07-21T00:00:00Z')

    const found = await findPreservedTicketBranch(dir, 'feature/demo', 'demo', 2)
    expect(found?.branch).toBe('runcastle/ticket/demo/2-new1')
    expect(found?.commits).toHaveLength(1)
  })

  it('returns undefined when no attempt branch holds unmerged work', async () => {
    const { dir, g } = await initRepoWithFeature()
    await g.branch(['runcastle/ticket/demo/2-empt', 'feature/demo'])
    expect(await findPreservedTicketBranch(dir, 'feature/demo', 'demo', 2)).toBeUndefined()
  })

  it('is best-effort on a non-repo path', async () => {
    expect(await findPreservedTicketBranch(join(tmpdir(), 'nope-not-a-repo'), 'f', 'demo', 2)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// retryTicket — the manual per-ticket retry service
// ---------------------------------------------------------------------------

const stubBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run() {
    return { status: 'succeeded', summary: 'stub' }
  },
}

function ticketInput(title: string, blockedBy: number[] = []) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy }
}

describe('retryTicket', () => {
  let ctx: AppCtx
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  it('resets ONLY the target (and starts a run), leaving other failed tickets failed', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [target, other] = storeTickets(ctx, featureId, [
      ticketInput('target'),
      ticketInput('other-failed'),
    ])
    updateTicket(ctx, target.id, { status: 'failed', error: 'stream died' })
    updateTicket(ctx, other.id, { status: 'failed', error: 'agent made no commits' })

    const { runId, retried } = await retryTicket(ctx, target.id)
    expect(runId).toMatch(/^run/)
    expect(retried).toEqual([target.seq])

    const after = Object.fromEntries(listByFeature(ctx, featureId).map((t) => [t.title, t]))
    expect(after['target'].status).toBe('pending')
    expect(after['target'].error).toBeUndefined()
    expect(after['other-failed'].status).toBe('failed')
  })

  it('pulls failed blockers along transitively (retrying a dependent alone is pointless)', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [root, mid, leaf, unrelated] = storeTickets(ctx, featureId, [
      ticketInput('root'),
      ticketInput('mid', [1]),
      ticketInput('leaf', [2]),
      ticketInput('unrelated'),
    ])
    for (const t of [root, mid, leaf, unrelated]) {
      updateTicket(ctx, t.id, { status: 'failed', error: 'x' })
    }

    const { retried } = await retryTicket(ctx, leaf.id)
    expect(retried).toEqual([root.seq, mid.seq, leaf.seq])

    const after = Object.fromEntries(listByFeature(ctx, featureId).map((t) => [t.title, t]))
    expect(after['root'].status).toBe('pending')
    expect(after['mid'].status).toBe('pending')
    expect(after['leaf'].status).toBe('pending')
    expect(after['unrelated'].status).toBe('failed')
  })

  it('keeps attemptBranch on a plain retry (resume) and clears it on fresh', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, {
      status: 'failed',
      error: 'stream died',
      attemptBranch: 'runcastle/ticket/demo/1-abc',
    })
    expect(getTicket(ctx, a.id).attemptBranch).toBe('runcastle/ticket/demo/1-abc')

    await retryTicket(ctx, a.id)
    expect(getTicket(ctx, a.id).attemptBranch).toBe('runcastle/ticket/demo/1-abc')

    updateTicket(ctx, a.id, { status: 'failed', error: 'stream died again' })
    await retryTicket(ctx, a.id, { fresh: true })
    const after = getTicket(ctx, a.id)
    expect(after.status).toBe('pending')
    expect(after.attemptBranch).toBeUndefined()
  })

  it('emits a ticket.retry event naming the retried seqs', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, { status: 'failed', error: 'x' })

    await retryTicket(ctx, a.id)
    const ev = listAfter(ctx, featureId, 0).find((e) => e.type === 'ticket.retry')
    expect(ev?.data).toEqual({
      retried: [a.seq],
      fresh: false,
      resumedFrom: null,
      preservedCommits: 0,
    })
  })

  it('adopts an orphaned attempt branch when the ticket has no recorded pointer', async () => {
    const { dir, g } = await initRepoWithFeature()
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/1-orph', 'work.txt', '2026-07-21T00:00:00Z')
    const featureId = seedFeature(ctx, seedProject(ctx, dir).id, {
      phase: 'implementation',
      slug: 'demo',
    }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, { status: 'failed', error: 'died before attemptBranch existed' })

    const res = await retryTicket(ctx, a.id)
    expect(res.resumedFrom).toBe('runcastle/ticket/demo/1-orph')
    expect(res.preservedCommits).toBe(1)
    expect(getTicket(ctx, a.id).attemptBranch).toBe('runcastle/ticket/demo/1-orph')
  })

  it('fresh discards every attempt branch of the ticket, orphans included', async () => {
    const { dir, g } = await initRepoWithFeature()
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/1-one1', 'one.txt', '2026-07-19T00:00:00Z')
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/1-two1', 'two.txt', '2026-07-20T00:00:00Z')
    const featureId = seedFeature(ctx, seedProject(ctx, dir).id, {
      phase: 'implementation',
      slug: 'demo',
    }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, {
      status: 'failed',
      error: 'x',
      attemptBranch: 'runcastle/ticket/demo/1-two1',
    })

    const res = await retryTicket(ctx, a.id, { fresh: true })
    expect(res.resumedFrom).toBeNull()
    expect(getTicket(ctx, a.id).attemptBranch).toBeUndefined()
    expect(await listTicketAttemptBranches(dir, 'demo', 1)).toEqual([])
  })

  it('refuses a ticket that is not failed', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    await expect(retryTicket(ctx, a.id)).rejects.toThrow(GateError)
    await expect(retryTicket(ctx, a.id)).rejects.toThrow(/only failed tickets/)
  })

  it('refuses while a run is live for the feature', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, { status: 'failed', error: 'x' })
    ctx.db
      .insert(runs)
      .values({
        id: newId('run'),
        featureId,
        workflow: 'ticket-burner',
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        summary: null,
      })
      .run()

    await expect(retryTicket(ctx, a.id)).rejects.toThrow(/run is live/)
  })
})
