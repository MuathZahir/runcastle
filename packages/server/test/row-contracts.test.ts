import type { Feature, Project, TicketInput, WaypointInput } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  events,
  features,
  projects,
  runs,
  sessions,
  testNotes,
  tickets,
  waypoints,
} from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { emit, listAfter } from '../src/services/events'
import { getFeatureFull } from '../src/services/features'
import { getProjectById, listRunsByFeature, listSessionsByFeature } from '../src/services/repo'
import { listByFeature as listNotes } from '../src/services/test-notes'
import { listByFeature as listTickets, storeTickets } from '../src/services/tickets'
import { listByFeature as listWaypoints, storeWaypoints } from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The row→wire contract, from the outside: a row that violates its core schema
 * has to stop at the service seam.
 *
 * Drizzle's `$type<Phase>()` is a compile-time cast over a plain TEXT column, so
 * nothing at runtime stops a bad value getting in — a newer server's enum
 * member, a hand-edited column, a botched migration. Downstream every reader
 * switches on the value exhaustively, which is how ONE bad phase blank-screened
 * the whole web app (findings F19). These tests corrupt a real column and assert
 * the read fails loudly, naming the field, instead of handing the lie onward.
 *
 * Corruption is written with raw drizzle updates (casting past the `$type`)
 * because that is exactly the hole being closed: if the cast were a constraint,
 * these rows could not exist.
 */

/** Assert `read` throws a ZodError whose issues name `field`. */
function expectRejectsField(read: () => unknown, field: string): void {
  let thrown: unknown
  try {
    read()
  } catch (e) {
    thrown = e
  }
  expect(thrown, `expected a ZodError naming ${field}`).toBeInstanceOf(ZodError)
  expect((thrown as ZodError).issues.map((i) => i.path.join('.'))).toContain(field)
}

function ticket(title: string): TicketInput {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

function waypoint(title: string): WaypointInput {
  return { title, type: 'grilling', question: `q: ${title}`, blockedBy: [] }
}

describe('row → wire contracts', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature

  beforeEach(async () => {
    ctx = await makeTestCtx()
    project = seedProject(ctx)
    feature = seedFeature(ctx, project.id)
  })

  it('rejects a corrupt phase on a features row — the F19 class', () => {
    ctx.db
      .update(features)
      .set({ phase: 'bulldozing' as Feature['phase'] })
      .where(eq(features.id, feature.id))
      .run()

    expectRejectsField(() => getFeatureFull(ctx, feature.id), 'phase')
  })

  it('rejects a non-numeric closedAt on a projects row', () => {
    ctx.db
      .update(projects)
      .set({ closedAt: 'yesterday' as unknown as number })
      .where(eq(projects.id, project.id))
      .run()

    // `listProjects` filters on the column, so a garbage value hides the row
    // from it entirely — read it the way the per-project lookup does.
    expectRejectsField(() => getProjectById(ctx, project.id), 'closedAt')
  })

  it('carries a project closedAt stamp onto the wire', () => {
    expect(getProjectById(ctx, project.id)?.closedAt).toBeUndefined()

    // `listProjects` hides closed projects, so read it the way a project-scoped
    // lookup does — the stamp is what tells the UI the project is closed.
    const closedAt = Date.now()
    ctx.db.update(projects).set({ closedAt }).where(eq(projects.id, project.id)).run()
    expect(getProjectById(ctx, project.id)?.closedAt).toBe(closedAt)
  })

  it('rejects a corrupt status on a runs row', () => {
    const id = newId('run')
    ctx.db
      .insert(runs)
      .values({
        id,
        featureId: feature.id,
        workflow: 'ticket-burner',
        status: 'exploded' as 'running',
        startedAt: Date.now(),
        endedAt: null,
        summary: null,
      })
      .run()

    expectRejectsField(() => listRunsByFeature(ctx, feature.id), 'status')
  })

  it('rejects a corrupt kind on a sessions row', () => {
    ctx.db
      .insert(sessions)
      .values({
        id: newId('sess'),
        featureId: feature.id,
        kind: 'seance' as 'ideation',
        ccSessionId: null,
        transcriptPath: null,
        status: 'live',
        worktreePath: '/tmp/wt',
      })
      .run()

    expectRejectsField(() => listSessionsByFeature(ctx, feature.id), 'kind')
  })

  it('rejects a non-numeric ts on an events row', () => {
    const event = emit(ctx, feature.id, { type: 'test.event', message: 'hello' })
    ctx.db
      .update(events)
      .set({ ts: 'yesterday' as unknown as number })
      .where(eq(events.id, event.id))
      .run()

    expectRejectsField(() => listAfter(ctx, feature.id), 'ts')
  })

  it('round-trips an event data payload unchanged', () => {
    const data = { commits: ['abc123'], nested: { ok: true, count: 2 }, note: null }
    emit(ctx, feature.id, { type: 'test.event', message: 'with payload', data })

    const [stored] = listAfter(ctx, feature.id)
    expect(stored.data).toEqual(data)
  })

  it('rejects a corrupt status on a tickets row', () => {
    const [stored] = storeTickets(ctx, feature.id, [ticket('a ticket')])
    ctx.db
      .update(tickets)
      .set({ status: 'exploded' as 'pending' })
      .where(eq(tickets.id, stored.id))
      .run()

    expectRejectsField(() => listTickets(ctx, feature.id), 'status')
  })

  it('rejects a corrupt status on a waypoints row', () => {
    const [stored] = storeWaypoints(ctx, feature.id, [waypoint('a waypoint')])
    ctx.db
      .update(waypoints)
      .set({ status: 'pondering' as 'open' })
      .where(eq(waypoints.id, stored.id))
      .run()

    expectRejectsField(() => listWaypoints(ctx, feature.id), 'status')
  })

  it('rejects a corrupt status on a test_notes row', () => {
    const id = newId('note')
    const now = Date.now()
    ctx.db
      .insert(testNotes)
      .values({
        id,
        featureId: feature.id,
        lap: 1,
        text: 'the button is off-centre',
        status: 'shelved' as 'open',
        ticketId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    expectRejectsField(() => listNotes(ctx, feature.id), 'status')
  })
})
