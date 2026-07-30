import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project, SessionKind, WorkflowDef } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runs, tickets } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, lapKickoff, markSessionEnded } from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { advance, burn, rethink } from '../src/services/features'
import { featureDocsDir } from '../src/services/feature-docs'
import { checkGate } from '../src/services/gates'
import { getFeatureRow } from '../src/services/repo'
import { listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Rethink — the review → ideation loop that starts lap N+1 (ADR-0010 §1,
 * SPEC §15.2), plus the lap scoping it makes necessary on G3 and the Fix burn.
 *
 * Driven through the SERVICE, not the tRPC proc: `feature.rethink` launches a
 * terminal, and `launchSession` is B1 behaviour that needs a real worktree, so
 * the proc is not a unit-testable seam (the same reason `burn-from-review` and
 * `converge` test where they do).
 */

const stubBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run() {
    return { status: 'succeeded', summary: 'stub' }
  },
}

function ticketInput(title: string) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

/**
 * Backdate a ticket to an earlier lap. `storeTickets` stamps the feature's
 * CURRENT lap, so a feature seeded straight onto lap 2 has no other way to
 * carry the leftovers of a lap it never actually ran.
 */
function setTicketLap(ctx: AppCtx, ticketId: string, lap: number): void {
  ctx.db.update(tickets).set({ lap }).where(eq(tickets.id, ticketId)).run()
}

describe('rethink service — the lap N+1 transition', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('from review: increments the lap, returns to ideation, emits lap.started', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id

    const after = rethink(ctx, featureId)

    expect(after.lap).toBe(2)
    expect(after.phase).toBe('ideation')
    const row = getFeatureRow(ctx, featureId)
    expect(row.lap).toBe(2)
    expect(row.phase).toBe('ideation')

    const started = listAfter(ctx, featureId, 0).find((e) => e.type === 'lap.started')
    expect(started?.message).toBe('rethink — lap 2')
    expect(started?.data).toMatchObject({ from: 'review', to: 'ideation' })
  })

  it('laps accumulate — a second rethink from review lands on lap 3', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 2 }).id
    expect(rethink(ctx, featureId).lap).toBe(3)
  })

  it('refuses from any other phase, naming it, and changes nothing', () => {
    for (const phase of ['ideation', 'spec', 'tickets', 'implementation', 'shipped'] as const) {
      const featureId = seedFeature(ctx, seedProject(ctx).id, { slug: `f-${phase}`, phase }).id
      expect(() => rethink(ctx, featureId)).toThrow(GateError)
      expect(() => rethink(ctx, featureId)).toThrow(
        new RegExp(`review phase to rethink \\(currently ${phase}\\)`),
      )
      const row = getFeatureRow(ctx, featureId)
      expect(row.lap).toBe(1)
      expect(row.phase).toBe(phase)
    }
  })

  it('refuses while a run is active — and does NOT increment the lap', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
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

    expect(() => rethink(ctx, featureId)).toThrow(/run is burning/)
    expect(getFeatureRow(ctx, featureId).lap).toBe(1)
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
  })

  it('refuses while a non-ended session exists — and does NOT increment the lap', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: '/tmp/wt' })

    expect(() => rethink(ctx, featureId)).toThrow(/only one terminal per feature/)
    // The mutation must not have happened: the launch that follows a rethink
    // would be refused by the same guard, stranding a lap with no session.
    expect(getFeatureRow(ctx, featureId).lap).toBe(1)
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')

    markSessionEnded(ctx, session.id)
    expect(rethink(ctx, featureId).lap).toBe(2)
  })
})

describe('G3 (tickets-approved) scopes to the current lap', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('a lap-1 done ticket does not satisfy G3 on lap 2 — a lap-2 ticket does', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [shipped] = storeTickets(ctx, featureId, [ticketInput('lap-1 work')])
    updateTicket(ctx, shipped.id, { status: 'done', commits: ['abc'] })

    rethink(ctx, featureId)
    const onLap2 = getFeatureRow(ctx, featureId)
    expect(checkGate(ctx, 'tickets-approved', onLap2)).toEqual({
      satisfied: false,
      reason: 'no tickets to burn',
    })

    storeTickets(ctx, featureId, [ticketInput('lap-2 work')])
    expect(checkGate(ctx, 'tickets-approved', getFeatureRow(ctx, featureId)).satisfied).toBe(true)
  })

  it('still counts lap-1 tickets while the feature is on lap 1 (unchanged)', () => {
    const feature = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets' })
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(false)
    storeTickets(ctx, feature.id, [ticketInput('one')])
    expect(checkGate(ctx, 'tickets-approved', feature).satisfied).toBe(true)
  })

  it('G4 stays cumulative — an earlier lap`s terminal tickets still count', () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review' }).id
    const [shipped] = storeTickets(ctx, featureId, [ticketInput('lap-1 work')])
    updateTicket(ctx, shipped.id, { status: 'done', commits: ['abc'] })
    rethink(ctx, featureId)

    expect(checkGate(ctx, 'all-tickets-terminal', getFeatureRow(ctx, featureId)).satisfied).toBe(
      true,
    )
  })
})

/**
 * G1/G2 scope to the current lap too (findings F4): lap 1's decisions.md and
 * spec.md never leave the disk, so a file-only check let a fresh lap cross both
 * gates on the previous lap's artifacts — advancing with no session at all and
 * dead-ending at `tickets` with nothing to burn.
 */
describe('G1/G2 (the doc gates) scope to the current lap', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx, tmpRepo())
  })

  function writeDoc(feature: Feature, name: string): void {
    const dir = featureDocsDir(project, feature)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), '# doc\n', 'utf8')
  }

  /** A session of this feature's CURRENT lap — the evidence the lap was worked. */
  function lapSession(feature: Feature, kind: SessionKind = 'revisit'): void {
    const s = createSessionRow(ctx, { featureId: feature.id, kind, worktreePath: '/tmp/wt' })
    markSessionEnded(ctx, s.id)
  }

  it('lap 1 is unchanged — the file alone satisfies both gates', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'lap1' })
    writeDoc(feature, 'decisions.md')
    writeDoc(feature, 'spec.md')

    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(true)
    expect(checkGate(ctx, 'spec-file-exists', feature).satisfied).toBe(true)
  })

  it('refuses both gates on lap 2 while only lap-1 artifacts exist, naming the lap', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'stale', lap: 2 })
    writeDoc(feature, 'decisions.md')
    writeDoc(feature, 'spec.md')

    const g1 = checkGate(ctx, 'decisions-file-exists', feature)
    expect(g1.satisfied).toBe(false)
    expect(g1.reason).toContain('decisions.md')
    expect(g1.reason).toContain('lap 2')

    const g2 = checkGate(ctx, 'spec-file-exists', feature)
    expect(g2.satisfied).toBe(false)
    expect(g2.reason).toContain('spec.md')
    expect(g2.reason).toContain('lap 2')
  })

  it('opens both gates once a session of the running lap has worked the feature', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'worked', lap: 2 })
    writeDoc(feature, 'decisions.md')
    writeDoc(feature, 'spec.md')
    lapSession(feature)

    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(true)
    expect(checkGate(ctx, 'spec-file-exists', feature).satisfied).toBe(true)
  })

  it('does not count an EARLIER lap`s session as this lap`s work', () => {
    const feature = seedFeature(ctx, project.id, { phase: 'review', slug: 'lap1-session' })
    writeDoc(feature, 'decisions.md')
    lapSession(feature) // a lap-1 session
    const onLap2 = rethink(ctx, feature.id)

    expect(checkGate(ctx, 'decisions-file-exists', onLap2).satisfied).toBe(false)
  })

  it('does not count a qa session — asking a question is not working the lap', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'asked', lap: 2 })
    writeDoc(feature, 'decisions.md')
    lapSession(feature, 'qa')

    expect(checkGate(ctx, 'decisions-file-exists', feature).satisfied).toBe(false)
  })

  it('still refuses when the doc is missing entirely (the file reason wins)', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'nodoc', lap: 2 })
    lapSession(feature)

    expect(checkGate(ctx, 'decisions-file-exists', feature).reason).toContain('ideation session')
  })

  it('features.advance refuses a lap-2 ideation feature with stale artifacts, with the gate`s message', () => {
    const feature = seedFeature(ctx, project.id, { slug: 'wedged', lap: 2, phase: 'ideation' })
    writeDoc(feature, 'decisions.md')

    expect(() => advance(ctx, feature.id)).toThrow(GateError)
    expect(() => advance(ctx, feature.id)).toThrow(/no lap 2 session has worked this feature yet/)
    expect(getFeatureRow(ctx, feature.id).phase).toBe('ideation')

    // …and crosses once this lap actually had its session.
    lapSession(feature)
    expect(advance(ctx, feature.id).phase).toBe('spec')
  })
})

describe('feature.rethink proc + the lap kickoff', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('is registered on the feature router and runs the service before launching anything', async () => {
    const caller = createCallerFactory(appRouter)(ctx)
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id

    // The service's phase guard rejects, so no session is ever launched — which
    // is what makes this callable without a real terminal (`launchSession` is B1
    // behaviour and would spawn one). The launching path itself is exercised by
    // the smoke, not here.
    await expect(caller.feature.rethink({ featureId })).rejects.toThrow(
      /review phase to rethink \(currently implementation\)/,
    )
    expect(getFeatureRow(ctx, featureId).lap).toBe(1)
  })

  it('lapKickoff names the lap and its review iteration', () => {
    expect(lapKickoff(2)).toContain('LAP 2 REVIEW ITERATION')
    expect(lapKickoff(7)).toContain('LAP 7 REVIEW ITERATION')
    expect(lapKickoff(2)).toContain('/runcastle:revisit')
  })

  it('lapKickoff points at the PREVIOUS lap`s notes and warns both sources may be absent', () => {
    const line = lapKickoff(3)
    expect(line).toContain('test-notes.md')
    expect(line).toContain('## Lap 2')
    expect(line).toContain('## Later laps')
    expect(line).toContain('MAY NOT EXIST YET')
  })

  it('lapKickoff drives the whole lap in one session: amend, emit, advance, hand to Burn', () => {
    const line = lapKickoff(2)
    expect(line).toContain('decisions.md')
    expect(line).toContain('spec.md')
    expect(line).toContain('emit_tickets')
    expect(line).toContain('complete_phase')
    expect(line).toContain('ideation → spec → tickets')
    expect(line).toContain('click Burn')
  })
})

describe('burn lap-scoping — Fix burns this lap, restart rescues any lap', () => {
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

  it('a review-phase burn is refused when the only pending ticket belongs to an earlier lap', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 2 }).id
    // A stale lap-1 ticket that never burned — it must not open the Fix path on lap 2.
    const [leftover] = storeTickets(ctx, featureId, [ticketInput('lap-1 leftover')])
    setTicketLap(ctx, leftover.id, 1)

    await expect(burn(ctx, featureId)).rejects.toThrow(/no pending tickets to burn/)
    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
  })

  it('a review-phase burn runs once the current lap has a pending ticket', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'review', lap: 2 }).id
    storeTickets(ctx, featureId, [ticketInput('lap-2 fix')])

    const { runId } = await burn(ctx, featureId)
    expect(runId).toMatch(/^run/)
    expect(getFeatureRow(ctx, featureId).phase).toBe('implementation')
  })

  it('restarting a dead burn still resets a failed ticket from an earlier lap', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation', lap: 2 }).id
    const [stale, current] = storeTickets(ctx, featureId, [
      ticketInput('lap-1 failure'),
      ticketInput('lap-2 work'),
    ])
    updateTicket(ctx, stale.id, { status: 'failed', error: 'boom' })
    setTicketLap(ctx, stale.id, 1)

    await burn(ctx, featureId)

    const byId = new Map(listByFeature(ctx, featureId).map((t) => [t.id, t]))
    expect(byId.get(stale.id)?.status).toBe('pending')
    expect(byId.get(current.id)?.status).toBe('pending')
  })
})
