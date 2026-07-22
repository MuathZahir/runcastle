import type { WorkflowDef } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { GateError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { retryTicket } from '../src/services/features'
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
    expect(ev?.data).toEqual({ retried: [a.seq], fresh: false })
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
