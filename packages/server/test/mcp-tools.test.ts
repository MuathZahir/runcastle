import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TicketInput, WaypointInput } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp, {
  resolveSession,
  toolCancelTicket,
  toolCompletePhase,
  toolEmitTickets,
  toolEmitWaypoints,
  toolEscalateToMap,
  toolGetFeatureContext,
  toolRecordEvent,
  toolResolveWaypoint,
  toolUpdateTicket,
} from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature, storeTickets } from '../src/services/tickets'
import { claim, getWaypoint, listByFeature as listWaypoints } from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

function ticket(title: string, blockedBy: number[] = []): TicketInput {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy }
}

function waypoint(title: string, blockedBy: (number | string)[] = []): WaypointInput {
  return { title, type: 'grilling', question: `q: ${title}`, blockedBy }
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
    const feature = seedFeature(ctx, project.id, { slug, phase: 'ideation' })
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

  it('update_ticket rewrites content; cancel_ticket cancels with a reason (ticket surgery)', () => {
    const out = toolEmitTickets(ctx, session, { tickets: [ticket('stale'), ticket('obsolete')] })
    const [staleId, obsoleteId] = out.ids

    const updated = toolUpdateTicket(ctx, session, { id: staleId, title: 'fresh', goal: 'g2' })
    expect(updated.ticket.title).toBe('fresh')
    expect(updated.ticket.goal).toBe('g2')

    const cancelled = toolCancelTicket(ctx, session, { id: obsoleteId, reason: 'decision changed' })
    expect(cancelled.ticket.status).toBe('cancelled')
    expect(cancelled.ticket.error).toBe('decision changed')

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('ticket.edited')
    expect(types).toContain('ticket.cancelled')
  })

  it('update_ticket/cancel_ticket refuse a ticket from another feature', () => {
    const otherFeature = seedFeature(ctx, seedProject(ctx, repoPath).id, { slug: 'other' })
    const [foreign] = storeTickets(ctx, otherFeature.id, [ticket('foreign')])

    expect(() => toolUpdateTicket(ctx, session, { id: foreign.id, title: 'x' })).toThrow(GateError)
    expect(() => toolCancelTicket(ctx, session, { id: foreign.id })).toThrow(GateError)
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
    const feat = seedFeature(ctx, project.id, { slug: 'burn-me', phase: 'tickets' })
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

describe('mcp mapped write path (ADR-0001 §13.3)', () => {
  let ctx: AppCtx
  let repoPath: string
  let featureId: string
  let slug: string
  let session: ReturnType<typeof createSessionRow>

  function mapPath(): string {
    return join(repoPath, 'docs', 'features', slug, 'map.md')
  }

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const project = seedProject(ctx, repoPath)
    slug = 'big-feature'
    const feature = seedFeature(ctx, project.id, { slug, phase: 'ideation' })
    featureId = feature.id
    session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: repoPath })
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('escalate_to_map flips mapped, scaffolds map.md from args, and emits an event', () => {
    const out = toolEscalateToMap(ctx, session, {
      destination: 'a fully offline-capable editor',
      notes: 'sync is out of scope for v1',
    })
    expect(out).toEqual({ ok: true })

    expect(getFeatureRow(ctx, featureId).mapped).toBe(true)

    expect(existsSync(mapPath())).toBe(true)
    const body = readFileSync(mapPath(), 'utf8')
    expect(body).toContain('## Destination')
    expect(body).toContain('a fully offline-capable editor')
    expect(body).toContain('## Notes')
    expect(body).toContain('sync is out of scope for v1')
    expect(body).toContain('## Not yet specified')
    expect(body).toContain('## Out of scope')

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('feature.escalated')
  })

  it('escalate_to_map a second time warns and makes no side effects', () => {
    toolEscalateToMap(ctx, session, { destination: 'first', notes: 'first notes' })
    const firstBody = readFileSync(mapPath(), 'utf8')
    const eventsAfterFirst = listAfter(ctx, featureId, 0).length

    const out = toolEscalateToMap(ctx, session, { destination: 'second', notes: 'second notes' })
    expect(out.ok).toBe(true)
    expect(out.warning).toMatch(/already mapped/i)

    // map.md untouched (first chart wins) and no new events
    expect(readFileSync(mapPath(), 'utf8')).toBe(firstBody)
    expect(readFileSync(mapPath(), 'utf8')).not.toContain('second')
    expect(listAfter(ctx, featureId, 0).length).toBe(eventsAfterFirst)
  })

  it('emit_waypoints validates + stores via the waypoint service and returns ids', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    const out = toolEmitWaypoints(ctx, session, {
      waypoints: [waypoint('root'), waypoint('leaf', [1])],
    })
    expect(out.stored).toBe(2)
    expect(out.ids).toHaveLength(2)

    const stored = listWaypoints(ctx, featureId)
    expect(stored.map((w) => w.title)).toEqual(['root', 'leaf'])
    expect(stored[1].blockedBy).toEqual([1]) // batch position 1 -> global seq 1
  })

  it('emit_waypoints refuses a feature that has not been escalated', () => {
    expect(() => toolEmitWaypoints(ctx, session, { waypoints: [waypoint('x')] })).toThrow(GateError)
  })

  it('emit_waypoints works from any session kind once mapped (qa can branch the map)', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    const qa = createSessionRow(ctx, { featureId, kind: 'qa', worktreePath: repoPath })
    const out = toolEmitWaypoints(ctx, qa, { waypoints: [waypoint('from-qa')] })
    expect(out.stored).toBe(1)
    expect(listWaypoints(ctx, featureId).map((w) => w.title)).toContain('from-qa')
  })

  it('resolve_waypoint flips machinery (status + cascade) and reports ok', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    toolEmitWaypoints(ctx, session, { waypoints: [waypoint('a'), waypoint('b', [1])] })
    const [a, b] = listWaypoints(ctx, featureId)

    const out = toolResolveWaypoint(ctx, session, {
      id: a.id,
      disposition: 'resolved',
      summary: 'answered a',
    })
    expect(out).toEqual({ ok: true })

    // a is terminal with its summary; resolving it freed b onto the frontier
    const done = getWaypoint(ctx, a.id)
    expect(done.status).toBe('resolved')
    expect(done.summary).toBe('answered a')
    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('waypoint.resolved')
    expect(types).toContain('waypoint.unblocked')
    expect(getWaypoint(ctx, b.id).status).toBe('open')
  })

  it('resolve_waypoint drops a waypoint (terminal, frees dependents like a resolve)', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    toolEmitWaypoints(ctx, session, { waypoints: [waypoint('a')] })
    const [a] = listWaypoints(ctx, featureId)
    toolResolveWaypoint(ctx, session, { id: a.id, disposition: 'dropped', summary: 'out of scope' })
    expect(getWaypoint(ctx, a.id).status).toBe('dropped')
  })

  it('get_feature_context surfaces the waypoint THIS session claimed as assignedWaypoint', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    toolEmitWaypoints(ctx, session, { waypoints: [waypoint('a'), waypoint('b')] })
    const [a] = listWaypoints(ctx, featureId)
    // simulate the server-side claim performed when this session was launched
    claim(ctx, a.id, session.id)

    const out = toolGetFeatureContext(ctx, session)
    expect(out.assignedWaypoint?.id).toBe(a.id)
    // a session with no claim (e.g. the ideation session) has none
    const other = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: repoPath })
    expect(toolGetFeatureContext(ctx, other).assignedWaypoint).toBeUndefined()
  })

  it('get_feature_context exposes waypoints + frontier only when mapped', () => {
    // unmapped: no map fields
    const before = toolGetFeatureContext(ctx, session)
    expect(before.waypoints).toBeUndefined()
    expect(before.frontier).toBeUndefined()

    toolEscalateToMap(ctx, session, { destination: 'dest' })
    toolEmitWaypoints(ctx, session, { waypoints: [waypoint('a'), waypoint('b', [1])] })

    const after = toolGetFeatureContext(ctx, session)
    expect(after.waypoints).toHaveLength(2)
    // only 'a' is unblocked → the sole frontier waypoint
    expect(after.frontier?.map((w) => w.title)).toEqual(['a'])
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
