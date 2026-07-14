import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TicketInput } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp, {
  resolveSession,
  toolCompletePhase,
  toolEmitTickets,
  toolGetFeatureContext,
  toolRecordEvent,
} from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature, storeTickets } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

function ticket(title: string, blockedBy: number[] = []): TicketInput {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy }
}

describe('mcp tools', () => {
  let ctx: AppCtx
  let repoPath: string
  let featureId: string
  let slug: string
  let session: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const project = seedProject(ctx, repoPath)
    slug = 'dark-mode'
    const feature = seedFeature(ctx, project.id, { slug, phase: 'ideation', size: 'full' })
    featureId = feature.id
    session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: repoPath })
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('emit_tickets validates + stores the batch and reports ids', () => {
    const out = toolEmitTickets(ctx, session, {
      tickets: [ticket('one'), ticket('two', [1])],
    })
    expect(out.stored).toBe(2)
    expect(out.ids).toHaveLength(2)

    const stored = listByFeature(ctx, featureId)
    expect(stored.map((t) => t.title)).toEqual(['one', 'two'])
    expect(stored[1].blockedBy).toEqual([1]) // batch position 1 -> global seq 1

    // exactly ONE store event for the UI timeline (the tool no longer double-logs
    // a redundant `tickets.emitted` alongside the service's `tickets.stored`)
    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('tickets.stored')
    expect(types.filter((t) => t === 'tickets.stored' || t === 'tickets.emitted')).toEqual([
      'tickets.stored',
    ])
  })

  it('emit_tickets rejects an out-of-range blockedBy position', () => {
    expect(() => toolEmitTickets(ctx, session, { tickets: [ticket('one'), ticket('two', [9])] })).toThrow(
      InvalidInputError,
    )
  })

  it('get_feature_context returns the feature, phase, docs contents and tickets', () => {
    const docsDir = join(repoPath, 'docs', 'features', slug)
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# Brief\n\nseed', 'utf8')
    writeFileSync(join(docsDir, 'decisions.md'), '# Decisions\n\nD1', 'utf8')
    toolEmitTickets(ctx, session, { tickets: [ticket('one')] })

    const out = toolGetFeatureContext(ctx, session)
    expect(out.feature.id).toBe(featureId)
    expect(out.phase).toBe('ideation')
    expect(out.tickets).toHaveLength(1)
    const byPath = Object.fromEntries(out.docs.map((d) => [d.relPath, d.content]))
    expect(byPath['brief.md']).toContain('seed')
    expect(byPath['decisions.md']).toContain('D1')
  })

  it('record_event drops a timeline note', () => {
    const out = toolRecordEvent(ctx, session, { type: 'decision.recorded', message: 'chose sqlite' })
    expect(out.ok).toBe(true)
    const ev = listAfter(ctx, featureId, 0).find((e) => e.type === 'decision.recorded')
    expect(ev?.message).toBe('chose sqlite')
  })

  it('complete_phase advances past a satisfied gate', () => {
    // G1 (ideation -> spec) needs decisions.md on disk
    const docsDir = join(repoPath, 'docs', 'features', slug)
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'decisions.md'), '# Decisions', 'utf8')

    const out = toolCompletePhase(ctx, session, { phase: 'ideation' })
    expect(out).toEqual({ ok: true, nextPhase: 'spec' })
  })

  it('complete_phase reports { ok: false, reason } when the gate is unsatisfied', () => {
    const out = toolCompletePhase(ctx, session, { phase: 'ideation' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/decisions/i)
  })

  it('complete_phase(tickets) records completion but does NOT cross G3 — parks at tickets for the human Burn', () => {
    // G3 (tickets → implementation) is the human Burn gate: only feature.burn
    // may cross it (CONTEXT.md two-click covenant). complete_phase must park.
    const project = seedProject(ctx, repoPath)
    const feat = seedFeature(ctx, project.id, { slug: 'burn-me', phase: 'tickets', size: 'full' })
    const s = createSessionRow(ctx, { featureId: feat.id, kind: 'ideation', worktreePath: repoPath })
    storeTickets(ctx, feat.id, [ticket('only')])

    const out = toolCompletePhase(ctx, s, { phase: 'tickets' })
    expect(out).toEqual({ ok: true, nextPhase: 'implementation', waitingOn: 'human burn' })

    // the feature stays at `tickets` — the run has NOT started
    expect(getFeatureRow(ctx, feat.id).phase).toBe('tickets')

    // an "awaiting burn" note lands on the timeline
    const types = listAfter(ctx, feat.id, 0).map((e) => e.type)
    expect(types).toContain('tickets.awaiting_burn')
  })
})

describe('mcp session resolution', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    seedFeature(ctx, project.id, { slug: 'f1' })
  })

  it('prefers the header session id, falling back to the most recent live session', () => {
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'f2' })
    const s1 = createSessionRow(ctx, { featureId: feature.id, kind: 'ideation', worktreePath: 'x' })
    const s2 = createSessionRow(ctx, { featureId: feature.id, kind: 'qa', worktreePath: 'y' })
    markSessionLive(ctx, s1.id)
    markSessionLive(ctx, s2.id)

    expect(resolveSession(ctx, s1.id)?.id).toBe(s1.id) // header wins
    expect(resolveSession(ctx, undefined)?.id).toBe(s2.id) // fallback = most recent live
    expect(resolveSession(ctx, 'sess_missing')?.id).toBe(s2.id) // bad header -> fallback
  })
})

describe('mcp http endpoint', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
    setRuntimeCtx(ctx)
  })
  afterEach(() => clearRuntimeCtx())

  it('is mounted at /mcp and initializes (no longer 501)', async () => {
    const app = new Hono()
    app.route('/mcp', mcpApp)
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.serverInfo.name).toBe('runcastle')
  })
})
