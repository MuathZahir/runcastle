import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod'
import type { DiscoverySnapshot, RunStatus, Ticket, TicketInput, WaypointInput } from '@runcastle/core'
import { TicketInput as TicketInputSchema, newId } from '@runcastle/core'
import { runs, testNotes } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError, InvalidInputError, NotFoundError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp, {
  buildMcpServer,
  featureContext,
  resolveFeatureReader,
  resolveSession,
  toolCancelTicket,
  toolCompletePhase,
  toolEmitTickets,
  toolEmitWaypoints,
  toolEscalateToMap,
  toolGetFeatureContext,
  toolGetTicket,
  toolListTickets,
  toolReadFeatureDoc,
  toolRecordEvent,
  toolResolveWaypoint,
  toolUpdateTicket,
  toolsForAudience,
} from '../src/mcp/server'
import { emit, listAfter } from '../src/services/events'
import { getFeatureRow } from '../src/services/repo'
import { reportFinding } from '../src/services/review-findings'
import { writeDiscoverySnapshot } from '../src/services/model-discovery'
import { addNote } from '../src/services/test-notes'
import {
  cancelTicket,
  getTicket,
  listByFeature,
  storeTickets,
  updateTicket,
} from '../src/services/tickets'
import { claim, getWaypoint, listByFeature as listWaypoints } from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

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
    const feature = seedFeature(ctx, project.id, { slug, phase: 'planning' })
    featureId = feature.id
    session = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath })
    markSessionLive(ctx, session.id)
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  /**
   * A burn as the runner records one: the `runs` row plus the `run.started`
   * event naming the lanes it opened with. That event is what makes a ticket
   * claimed before the run has said anything else about it.
   */
  function startBurn(
    runId: string,
    lanes: Ticket[],
    run: { status: RunStatus; endedAt?: number },
  ): void {
    ctx.db
      .insert(runs)
      .values({
        id: runId,
        featureId,
        workflow: 'ticket-burner',
        status: run.status,
        startedAt: 20,
        endedAt: run.endedAt ?? null,
      })
      .run()
    emit(ctx, featureId, {
      type: 'run.started',
      message: 'run started (ticket-burner)',
      runId,
      data: { workflow: 'ticket-burner', ticketIds: lanes.map((lane) => lane.id) },
    })
  }

  it('emit_tickets validates + stores the batch and reports each ticket’s assigned seq', () => {
    const out = toolEmitTickets(ctx, session, {
      tickets: [ticket('one'), ticket('two', [1])],
    })
    expect(out.stored).toBe(2)
    // `seq` is assigned by the store and is the number blockedBy + the UI speak
    // in — returning bare ids made the emitter re-read the feature to learn it.
    expect(out.tickets).toEqual([
      { id: expect.any(String), seq: 1, title: 'one' },
      { id: expect.any(String), seq: 2, title: 'two' },
    ])

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

  it('emit_tickets carries each ticket kind through, defaulting to implementation', () => {
    // The registered tool hands its handler the PARSED batch, so parse here the
    // same way — that is what applies the `implementation` default for the
    // ticket that omits a kind.
    const batch = z.array(TicketInputSchema).parse([
      ticket('build it'),
      { ...ticket('verify it', [1]), kind: 'review' },
    ])
    toolEmitTickets(ctx, session, { tickets: batch })

    const stored = listByFeature(ctx, featureId)
    expect(stored.map((t) => [t.title, t.kind])).toEqual([
      ['build it', 'implementation'],
      ['verify it', 'review'],
    ])
  })

  it('emit_tickets refuses a Review-titled ticket that is not kind: review', () => {
    // The incident shape: a review-shaped ticket emitted with the `kind` field
    // dropped, defaulted to `implementation`, and containerized into a sandbox
    // with no app to drive. Caught at authoring time, while the session that
    // wrote it can still fix and re-emit.
    const batch = z
      .array(TicketInputSchema)
      .parse([ticket('build it'), ticket('Review: drive the flow end to end', [1])])

    expect(() => toolEmitTickets(ctx, session, { tickets: batch })).toThrow(GateError)
    expect(() => toolEmitTickets(ctx, session, { tickets: batch })).toThrow(
      /kind: "review".*retitle/s,
    )
    // the WHOLE batch is refused — nothing was stored, not even the good ticket
    expect(listByFeature(ctx, featureId)).toEqual([])
  })

  it('emit_tickets refuses the bare "Review " title form too, and never coerces the kind', () => {
    expect(() =>
      toolEmitTickets(ctx, session, { tickets: [ticket('review the integrated change')] }),
    ).toThrow(GateError)

    // Correctly kinded, the same title stores untouched: refusal is the only
    // move — the session stays the author of its own tickets.
    const out = toolEmitTickets(ctx, session, {
      tickets: [{ ...ticket('Review the integrated change'), kind: 'review' }],
    })
    expect(out.stored).toBe(1)
    expect(listByFeature(ctx, featureId).map((t) => t.kind)).toEqual(['review'])
  })

  it('emit_tickets leaves an ordinary title alone whatever its kind', () => {
    // Only the review-shaped TITLE is the heuristic's business: "Reviewer
    // dashboard" is not a review ticket, and a batch with no review ticket at
    // all is G3's business, not this check's.
    const out = toolEmitTickets(ctx, session, {
      tickets: [ticket('Reviewer dashboard'), ticket('previewing a draft')],
    })
    expect(out.stored).toBe(2)
  })

  it('emit_tickets rejects an out-of-range blockedBy position', () => {
    expect(() => toolEmitTickets(ctx, session, { tickets: [ticket('one'), ticket('two', [9])] })).toThrow(
      InvalidInputError,
    )
  })

  it('update_ticket rewrites content; cancel_ticket cancels with a reason (ticket surgery)', () => {
    const out = toolEmitTickets(ctx, session, { tickets: [ticket('stale'), ticket('obsolete')] })
    const [staleId, obsoleteId] = out.tickets.map((t) => t.id)

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

  it('emit_tickets stamps an annotated model and refuses one off the roster', () => {
    ctx.config = {
      ...ctx.config,
      models: [{ id: 'gpt-5.6-sol', runtime: 'codex', note: 'mechanical refactors' }],
    }
    const out = toolEmitTickets(ctx, session, {
      tickets: [{ ...ticket('refactor'), model: 'gpt-5.6-sol' }, ticket('design')],
    })
    expect(listByFeature(ctx, featureId).map((t) => t.model)).toEqual(['gpt-5.6-sol', undefined])
    expect(out.stored).toBe(2)

    expect(() =>
      toolEmitTickets(ctx, session, { tickets: [{ ...ticket('x'), model: 'gpt-9-imaginary' }] }),
    ).toThrow(InvalidInputError)
  })

  it('update_ticket reassigns and clears a ticket model, refusing an unknown id', () => {
    const out = toolEmitTickets(ctx, session, { tickets: [ticket('one')] })
    const [{ id }] = out.tickets

    expect(toolUpdateTicket(ctx, session, { id, model: 'gpt-5.6-sol' }).ticket.model).toBe(
      'gpt-5.6-sol',
    )
    expect(toolUpdateTicket(ctx, session, { id, model: '' }).ticket.model).toBeUndefined()
    expect(() => toolUpdateTicket(ctx, session, { id, model: 'gpt-9-imaginary' })).toThrow(
      InvalidInputError,
    )
  })

  it('get_feature_context offers only the annotated roster entries, empty when none', () => {
    // Nothing annotated: the emitting session is offered no candidates at all,
    // which is what keeps today's behaviour (never assign) the default.
    expect(toolGetFeatureContext(ctx, session).annotatedModels).toEqual([])

    ctx.config = {
      ...ctx.config,
      models: [
        // A curated entry the operator annotated in place…
        { id: 'claude-opus-5', runtime: 'claude-code', note: 'UI/UX taste' },
        // …one of their own, annotated…
        { id: 'my-proxy-model', runtime: 'codex', note: 'cheap bulk edits' },
        // …one they added but never described…
        { id: 'unlabelled-model', runtime: 'codex' },
        // …and one whose note they cleared to whitespace, which is no note at
        // all: a blank cell is how the operator takes a model back off the
        // per-ticket menu.
        { id: 'blanked-model', runtime: 'codex', note: '   ' },
      ],
    }
    expect(toolGetFeatureContext(ctx, session).annotatedModels).toEqual([
      { id: 'claude-opus-5', runtime: 'claude-code', note: 'UI/UX taste' },
      { id: 'my-proxy-model', runtime: 'codex', note: 'cheap bulk edits' },
    ])
  })

  it('offers and accepts an annotated discovered model but hides unannotated discovery', () => {
    const previousDataDir = process.env.RUNCASTLE_DATA_DIR
    const discoveryDir = mkdtempSync(join(tmpdir(), 'runcastle-mcp-discovery-'))
    process.env.RUNCASTLE_DATA_DIR = discoveryDir
    try {
      const snapshot: DiscoverySnapshot = {
        sources: {
          'claude-code': { status: 'never', models: [], newIds: [] },
          codex: {
            status: 'ok',
            models: [
              { id: 'gpt-next', runtime: 'codex' },
              { id: 'gpt-hidden', runtime: 'codex' },
            ],
            newIds: [],
          },
        },
      }
      writeDiscoverySnapshot(snapshot)
      ctx.config = {
        ...ctx.config,
        models: [{ id: 'gpt-next', runtime: 'codex', note: 'provider-discovered refactors' }],
      }

      expect(toolGetFeatureContext(ctx, session).annotatedModels).toEqual([
        { id: 'gpt-next', runtime: 'codex', note: 'provider-discovered refactors' },
      ])
      toolEmitTickets(ctx, session, {
        tickets: [{ ...ticket('use the new model'), model: 'gpt-next' }],
      })
      expect(listByFeature(ctx, featureId)[0].model).toBe('gpt-next')
    } finally {
      if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
      else process.env.RUNCASTLE_DATA_DIR = previousDataDir
      rmTemp(discoveryDir)
    }
  })

  /**
   * The width the tickets skill budgets against. The session states the
   * batch's critical path against this number, so serving it is what makes
   * that rule computable rather than guessed.
   */
  it('get_feature_context serves the project’s burn width', () => {
    expect(toolGetFeatureContext(ctx, session).burnConcurrency).toBe(ctx.config.burnConcurrency)

    ctx.config = { ...ctx.config, burnConcurrency: 6 }
    expect(toolGetFeatureContext(ctx, session).burnConcurrency).toBe(6)
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
    expect(out.phase).toBe('planning')
    expect(out.tickets).toHaveLength(1)
    const byPath = Object.fromEntries(out.docs.map((d) => [d.relPath, d.content]))
    expect(byPath['brief.md']).toContain('seed')
    expect(byPath['decisions.md']).toContain('D1')
  })

  /**
   * The state a chat used to have no channel to (decisions.md #7): how the last
   * burn went lives on the `runs` table, and what this lap's review found lives
   * in `review_findings` and in host scratch space outside the repo. One call
   * states all of it.
   */
  it('get_feature_context states the last burn, this lap’s review and the notes that still stand', () => {
    const [landed, broke, review] = storeTickets(ctx, featureId, [
      ticket('landed'),
      ticket('broke'),
      { ...ticket('review the lap'), kind: 'review' },
    ])
    startBurn('run_burn', [landed, broke, review], { status: 'failed', endedAt: 30 })
    updateTicket(ctx, landed.id, { status: 'done' })
    updateTicket(ctx, broke.id, { status: 'failed', error: 'container died\n  at burn.ts:1' })
    updateTicket(ctx, review.id, { status: 'done' })
    reportFinding(ctx, {
      featureId,
      reviewTicket: getTicket(ctx, review.id),
      input: {
        kind: 'defect',
        severity: 'high',
        title: 'Save loses edits',
        location: 'screen: editor',
        citation: 'spec.md: edits persist',
        detail: 'The old value returns.',
        reproStep: 'Edit the title, save, reload.',
      },
    })
    addNote(ctx, featureId, 'the empty state flashes')

    const out = toolGetFeatureContext(ctx, session)
    // Counted over the lanes that burn HELD — the fix ticket the finding just
    // minted is the next burn's work and counts for neither side. The review
    // pass is a lane like any other, so landing it lands a ticket.
    expect(out.latestRun).toEqual({
      status: 'failed',
      ticketsLanded: 2,
      ticketsFailed: 1,
      errorHeadlines: ['container died'],
    })
    expect(out.currentLapReview).toEqual([
      expect.objectContaining({ ticketId: review.id, seq: review.seq, status: 'done', lap: 1 }),
    ])
    expect(out.currentLapReview[0].digestPath).toContain('DIGEST.md')
    expect(out.findings.map((finding) => finding.title)).toEqual(['Save loses edits'])
    expect(out.testNotes.map((note) => note.text)).toEqual(['the empty state flashes'])
  })

  it('get_feature_context omits latestRun entirely on a feature that has never burned', () => {
    const out = toolGetFeatureContext(ctx, session)
    expect('latestRun' in out).toBe(false)
    expect(out.currentLapReview).toEqual([])
    expect(out.findings).toEqual([])
    expect(out.testNotes).toEqual([])
  })

  /**
   * Keyed on status, not on the lap number alone — the mistake `carriedWork`
   * documents. A note carried into this lap keeps the lap that captured it, so
   * asking only for this lap's would lose exactly the notes still owed.
   */
  it('get_feature_context keeps a note an earlier lap carried rather than answered', () => {
    const feature = seedFeature(ctx, getFeatureRow(ctx, featureId).projectId, {
      slug: 'second-lap',
      lap: 2,
    })
    const carried = addNote(ctx, feature.id, 'the contrast is still wrong')
    ctx.db
      .update(testNotes)
      .set({ lap: 1, status: 'carried' })
      .where(eq(testNotes.id, carried.id))
      .run()
    addNote(ctx, feature.id, 'this lap’s own note')

    const out = featureContext(ctx, { featureId: feature.id, sessionId: session.id })
    expect(out.testNotes.map((note) => note.text)).toEqual([
      'the contrast is still wrong',
      'this lap’s own note',
    ])
  })

  it('ticket surgery refuses a ticket the live burn holds and allows one it does not', () => {
    const [claimed, unclaimed] = storeTickets(ctx, featureId, [
      ticket('claimed'),
      ticket('next burn'),
    ])
    startBurn('run_active', [claimed], { status: 'running' })

    // The refusal names both the run and the ticket: a chat told only "refused"
    // cannot tell the human which burn to wait for.
    for (const edit of [
      () => toolUpdateTicket(ctx, session, { id: claimed.id, title: 'nope' }),
      () => toolCancelTicket(ctx, session, { id: claimed.id }),
    ]) {
      expect(edit).toThrow(GateError)
      expect(edit).toThrow(/run_active/)
      expect(edit).toThrow(new RegExp(`#${claimed.seq} claimed`))
    }
    // The point of the guard's narrowness: the chat still shapes the NEXT burn
    // while this one runs.
    expect(toolUpdateTicket(ctx, session, { id: unclaimed.id, title: 'edited' }).ticket.title).toBe(
      'edited',
    )
    expect(toolCancelTicket(ctx, session, { id: unclaimed.id }).ticket.status).toBe('cancelled')
  })

  /**
   * The docs allowlist (`packages/core/src/docs.ts`). What is worth pinning is
   * both halves at once: the payload must SHRINK, and nothing may become
   * unreachable — an index entry that the agent cannot cash in would be a
   * silent deletion wearing a filename.
   */
  it('get_feature_context inlines only the canonical docs, and indexes the rest with a reason', () => {
    const docsDir = join(repoPath, 'docs', 'features', slug)
    mkdirSync(join(docsDir, 'research'), { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# Brief\n\nseed', 'utf8')
    writeFileSync(join(docsDir, 'spec.md'), '# Spec\n\nthe build order', 'utf8')
    writeFileSync(join(docsDir, 'outcome.md'), `# Outcome\n\n${'postmortem '.repeat(400)}`, 'utf8')
    writeFileSync(join(docsDir, 'test-notes.md'), '# Test notes\n\nalready triaged', 'utf8')
    writeFileSync(join(docsDir, 'scratch.md'), '# Scratch\n\nsomething a session wrote', 'utf8')

    const out = toolGetFeatureContext(ctx, session)

    // Inlined: the canonical four only, in reading order (brief before spec).
    expect(out.docs.map((d) => d.relPath)).toEqual(['brief.md', 'spec.md'])
    // Indexed: everything else, addressed and measured, never inlined.
    const index = Object.fromEntries(out.moreDocs.map((d) => [d.relPath, d]))
    expect(Object.keys(index).sort()).toEqual(['outcome.md', 'scratch.md', 'test-notes.md'])
    expect(index['outcome.md'].bytes).toBeGreaterThan(1000)
    expect(index['outcome.md'].title).toBe('Outcome')
    // The two the contract withholds BY NAME say why; an ordinary uncanonical
    // doc is simply not canonical, which is not the same as discouraged.
    expect(index['outcome.md'].withheld).toMatch(/outcome/i)
    expect(index['test-notes.md'].withheld).toMatch(/triaged/i)
    expect(index['scratch.md'].withheld).toBeUndefined()

    // The 4.4 KB of postmortem is not in the payload at any depth…
    expect(JSON.stringify(out)).not.toContain('postmortem postmortem')
    // …and the payload itself says how to go and get it.
    expect(out.docsNote).toMatch(/read_feature_doc/)

    // The other half of the contract: the index cashes in.
    const fetched = toolReadFeatureDoc(ctx, { featureId, sessionId: session.id }, {
      relPath: 'outcome.md',
    })
    expect(fetched.content).toContain('postmortem')
    // …and only within the feature's own docs dir.
    expect(() =>
      toolReadFeatureDoc(ctx, { featureId }, { relPath: '../../../CONTEXT.md' }),
    ).toThrow(InvalidInputError)
  })

  /**
   * `outcome.md` IS the ticket digests re-concatenated (`services/outcome.ts`),
   * so a payload carrying both pays twice for one set of facts — the same rule
   * `get_work_record` already applies to the run-level aggregate (decision 7).
   */
  it('get_feature_context rows each ticket with its goal; get_ticket serves the rest', () => {
    const [stored] = storeTickets(ctx, featureId, [ticket('build it')])
    updateTicket(ctx, stored.id, { status: 'done', digest: 'what the burner actually did' })

    const [served] = toolGetFeatureContext(ctx, session).tickets
    expect(Object.keys(served)).toEqual([
      'id',
      'seq',
      'title',
      'status',
      'kind',
      'lap',
      'blockedBy',
      'seams',
      'goal',
    ])
    expect(served.goal).toBe('g')

    const full = toolGetTicket(ctx, { featureId, sessionId: session.id }, { seq: served.seq })
    expect(full.context).toBe('c')
    expect(full.acceptanceCriteria).toEqual(['a'])
    expect(full.digest).toBe('what the burner actually did')
  })

  it('get_ticket refuses a seq the feature does not have', () => {
    storeTickets(ctx, featureId, [ticket('only one')])
    expect(() => toolGetTicket(ctx, { featureId }, { seq: 2 })).toThrow(NotFoundError)
  })

  it('list_tickets indexes ids and seqs without the prose, and filters by status', () => {
    const out = toolEmitTickets(ctx, session, { tickets: [ticket('one'), ticket('two')] })
    cancelTicket(ctx, out.tickets[1].id, 'not needed')

    const all = toolListTickets(ctx, { featureId, sessionId: session.id }, {})
    expect(all.tickets.map((t) => [t.seq, t.title, t.status])).toEqual([
      [1, 'one', 'pending'],
      [2, 'two', 'cancelled'],
    ])
    // An index, not a payload: no goal/context/acceptanceCriteria in sight.
    expect(JSON.stringify(all)).not.toContain('"goal"')

    const pending = toolListTickets(ctx, { featureId }, { status: 'pending' })
    expect(pending.tickets.map((t) => t.title)).toEqual(['one'])
  })

  it('record_event drops a timeline note', () => {
    const out = toolRecordEvent(ctx, session, { type: 'decision.recorded', message: 'chose sqlite' })
    expect(out.ok).toBe(true)
    const ev = listAfter(ctx, featureId, 0).find((e) => e.type === 'decision.recorded')
    expect(ev?.message).toBe('chose sqlite')
  })

  it.each(['ideation', 'spec'] as const)('complete_phase(%s) records progress without moving state', (phase) => {
    // Nothing on disk in this fixture, so the derived hint points at the first
    // artifact still missing.
    expect(toolCompletePhase(ctx, session, { phase })).toEqual({
      ok: true,
      nextPhase: 'planning',
      nextStep: 'ideation',
    })
    expect(getFeatureRow(ctx, featureId).phase).toBe('planning')
  })

  it('complete_phase(tickets) remains wire-compatible and waits for Burn', () => {
    const out = toolCompletePhase(ctx, session, { phase: 'tickets' })
    expect(out.ok).toBe(true)
    expect(out.nextPhase).toBe('planning')
    expect(out.waitingOn).toBe('human burn')
    expect(getFeatureRow(ctx, featureId).phase).toBe('planning')
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
    const feature = seedFeature(ctx, project.id, { slug, phase: 'planning' })
    featureId = feature.id
    session = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath })
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

  it('emit_waypoints validates + stores via the waypoint service and reports assigned seqs', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    const out = toolEmitWaypoints(ctx, session, {
      waypoints: [waypoint('root'), waypoint('leaf', [1])],
    })
    expect(out.stored).toBe(2)
    expect(out.waypoints).toEqual([
      { id: expect.any(String), seq: 1, title: 'root' },
      { id: expect.any(String), seq: 2, title: 'leaf' },
    ])

    const stored = listWaypoints(ctx, featureId)
    expect(stored.map((w) => w.title)).toEqual(['root', 'leaf'])
    expect(stored[1].blockedBy).toEqual([1]) // batch position 1 -> global seq 1
  })

  it('emit_waypoints refuses a feature that has not been escalated', () => {
    expect(() => toolEmitWaypoints(ctx, session, { waypoints: [waypoint('x')] })).toThrow(GateError)
  })

  it('emit_waypoints works from any session kind once mapped (qa can branch the map)', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    const qa = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath })
    const out = toolEmitWaypoints(ctx, qa, { waypoints: [waypoint('from-qa')] })
    expect(out.stored).toBe(1)
    expect(listWaypoints(ctx, featureId).map((w) => w.title)).toContain('from-qa')
  })

  it('resolve_waypoint flips machinery (status + cascade) and reports what it freed', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    toolEmitWaypoints(ctx, session, { waypoints: [waypoint('a'), waypoint('b', [1])] })
    const [a, b] = listWaypoints(ctx, featureId)

    const out = toolResolveWaypoint(ctx, session, {
      id: a.id,
      disposition: 'resolved',
      summary: 'answered a',
    })
    // The service already worked out which dependents this frees (it emits an
    // event per dependent) and used to return none of it, so the session's next
    // move was a whole get_feature_context to find out what just happened.
    expect(out).toEqual({
      ok: true,
      unblocked: [{ id: b.id, seq: b.seq, title: 'b' }],
      frontierIds: [b.id],
    })

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

  it('get_feature_context surfaces the waypoint THIS session claimed as assignedWaypointId', () => {
    toolEscalateToMap(ctx, session, { destination: 'dest' })
    toolEmitWaypoints(ctx, session, { waypoints: [waypoint('a'), waypoint('b')] })
    const [a] = listWaypoints(ctx, featureId)
    // simulate the server-side claim performed when this session was launched
    claim(ctx, a.id, session.id)

    const out = toolGetFeatureContext(ctx, session)
    expect(out.assignedWaypointId).toBe(a.id)
    // a session with no claim (e.g. the ideation session) has none
    const other = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath })
    expect(toolGetFeatureContext(ctx, other).assignedWaypointId).toBeUndefined()
  })

  it('get_feature_context exposes waypoints + frontier ids only when mapped', () => {
    // unmapped: no map fields
    const before = toolGetFeatureContext(ctx, session)
    expect(before.waypoints).toBeUndefined()
    expect(before.frontierIds).toBeUndefined()

    toolEscalateToMap(ctx, session, { destination: 'dest' })
    toolEmitWaypoints(ctx, session, { waypoints: [waypoint('a'), waypoint('b', [1])] })

    const after = toolGetFeatureContext(ctx, session)
    expect(after.waypoints).toHaveLength(2)
    // only 'a' is unblocked → the sole frontier waypoint. Ids, not rows: the
    // rows are already above in `waypoints`, and serialising the same waypoint
    // two and three times over is what this payload used to do.
    const a = after.waypoints?.find((w) => w.title === 'a')
    expect(after.frontierIds).toEqual([a?.id])
    expect(JSON.stringify(after.frontierIds)).not.toContain('grilling')
  })
})

describe('mcp chat write contract', () => {
  let ctx: AppCtx
  let repoPath: string
  let featureId: string
  let qa: ReturnType<typeof createSessionRow>

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const feature = seedFeature(ctx, seedProject(ctx, repoPath).id, { slug: 'q', phase: 'planning' })
    featureId = feature.id
    qa = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath })
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('allows ticket writes from chat', () => {
    const [existing] = storeTickets(ctx, featureId, [ticket('already here')])
    expect(toolEmitTickets(ctx, qa, { tickets: [ticket('new')] }).stored).toBe(1)
    expect(toolUpdateTicket(ctx, qa, { id: existing.id, title: 'changed' }).ticket.title).toBe('changed')
    expect(toolCancelTicket(ctx, qa, { id: existing.id }).ticket.status).toBe('cancelled')
    expect(listByFeature(ctx, featureId)).toHaveLength(2)
  })

  it('still reads, and still branches the map — "any session may branch the map"', () => {
    expect(toolGetFeatureContext(ctx, qa).feature.id).toBe(featureId)
    toolEscalateToMap(ctx, qa, { destination: 'dest' })
    expect(toolEmitWaypoints(ctx, qa, { waypoints: [waypoint('from-qa')] }).stored).toBe(1)
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
    const s1 = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: 'x' })
    const s2 = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: 'y' })
    markSessionLive(ctx, s1.id)
    markSessionLive(ctx, s2.id)

    expect(resolveSession(ctx, s1.id)?.id).toBe(s1.id) // header wins
    expect(resolveSession(ctx, undefined)?.id).toBe(s2.id) // fallback = most recent live
    expect(resolveSession(ctx, 'sess_missing')?.id).toBe(s2.id) // bad header -> fallback
  })

  /**
   * The mis-binding recorded at `docs/features/improve-workflow/outcome.md:255`.
   * A burner review agent carries ONLY `X-Runcastle-Run`, and the docstring
   * justified the session fallback with "at most one live ideation session
   * exists at a time" — which concurrent burns simply are not.
   */
  it('never falls back to a live session for a caller carrying a run header', () => {
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'f2' })
    const live = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: 'x',
    })
    markSessionLive(ctx, live.id)

    expect(resolveSession(ctx, undefined)?.id).toBe(live.id)
    expect(resolveSession(ctx, undefined, 'run_whatever')).toBeNull()
  })
})

/**
 * The other half of the same fix: a run agent is not merely refused a session —
 * the feature READS resolve to the feature its OWN run is burning. A review
 * agent reviewing a branch legitimately wants that branch's context, and that
 * is the only feature it may ever have.
 */
describe('mcp run-scoped feature reads', () => {
  let ctx: AppCtx
  let repoPath: string
  let mine: string
  let theirs: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    const project = seedProject(ctx, repoPath)
    mine = seedFeature(ctx, project.id, { slug: 'under-review' }).id
    theirs = seedFeature(ctx, project.id, { slug: 'somebody-elses' }).id
    // The live human conversation the fallback used to hand review agents.
    const talk = createSessionRow(ctx, {
      featureId: theirs,
      kind: 'chat',
      worktreePath: repoPath,
    })
    markSessionLive(ctx, talk.id)
  })

  function startRun(featureId: string): string {
    const id = newId('run')
    ctx.db
      .insert(runs)
      .values({ id, featureId, workflow: 'ticket-burner', status: 'running', startedAt: 1 })
      .run()
    return id
  }

  it('binds a run caller to its OWN feature, never the live talk session’s', () => {
    storeTickets(ctx, mine, [ticket('the work under review')])
    const runId = startRun(mine)

    const reader = resolveFeatureReader(ctx, { runId })
    expect(reader.featureId).toBe(mine)
    // No session id: a run agent claims no waypoint, so it inherits nobody's.
    expect(reader.sessionId).toBeUndefined()
    expect(featureContext(ctx, reader).feature.slug).toBe('under-review')
  })

  it('refuses a caller whose run is over — a stale header binds to nothing', () => {
    const runId = startRun(mine)
    ctx.db.update(runs).set({ status: 'succeeded' }).where(eq(runs.id, runId)).run()
    expect(() => resolveFeatureReader(ctx, { runId })).toThrow(GateError)
  })
})

/**
 * Kind-filtered registration. The permission allowlist grants every tool to
 * every session and is right that an inert RULE costs nothing; a tool
 * DEFINITION is re-sent on every turn, so the same argument does not carry.
 */
describe('mcp tool registration by audience', () => {
  it('offers each kind only the tools its own runtime gates can let through', () => {
    const chat = toolsForAudience('chat')
    expect(chat).toContain('get_feature_context')
    expect(chat).toContain('list_tickets')
    expect(chat).toContain('emit_waypoints')
    for (const write of ['emit_tickets', 'complete_phase', 'update_ticket', 'cancel_ticket']) {
      expect(chat, write).toContain(write)
    }

    // A project session has no feature, so none of the feature surface.
    const project = toolsForAudience('project')
    expect(project).toEqual(
      expect.arrayContaining([
        'create_feature',
        'get_project_context',
        'read_adr',
        'get_work_record',
        'read_feature_brief',
      ]),
    )
    expect(project).not.toContain('get_feature_context')
    // …and the project's fetch-one stays the project's.
    expect(toolsForAudience('chat')).not.toContain('read_feature_brief')
    expect(toolsForAudience('run')).not.toContain('read_feature_brief')
    expect(project).not.toContain('emit_tickets')

    // Single-kind tools stay single-kind.
    expect(toolsForAudience('prepare')).toContain('dry_run_drive')
    expect(toolsForAudience('chat')).not.toContain('dry_run_drive')
    expect(toolsForAudience('drive-fix')).toContain('retry_drive')
    expect(toolsForAudience('chat')).not.toContain('retry_drive')

    // A run agent gets its review wires plus the reads bound to its feature.
    expect(toolsForAudience('run').sort()).toEqual([
      'get_feature_context',
      'get_ticket',
      'list_tickets',
      'read_feature_doc',
      'report_finding',
      'review_drive',
    ])
    expect(toolsForAudience('run')).not.toContain('add_test_note')
  })

  it('registers EVERYTHING for an audience it cannot identify', () => {
    // Failing closed would hand a live session a server with no tools and no
    // way to say so — worse than an over-long list, since every call-time guard
    // is still in place underneath.
    const all = toolsForAudience(undefined)
    expect(all).toContain('get_feature_context')
    expect(all).toContain('get_project_context')
    expect(all).toContain('review_drive')
    expect(all.length).toBeGreaterThan(toolsForAudience('chat').length)
  })

  it('builds a server for every audience without throwing', () => {
    for (const audience of ['chat', 'project', 'prepare', 'drive-fix', 'run'] as const) {
      expect(buildMcpServer(audience)).toBeDefined()
    }
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
