import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Feature, Project, SessionKind, TicketInput } from '@runcastle/core'
import { newId, RuncastleConfig } from '@runcastle/core'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { runMigrations } from '../src/db/migrate'
import {
  events,
  features,
  projects,
  runs,
  schema,
  sessions,
  testNotes,
  tickets,
} from '../src/db/schema'
import type { AppCtx, Db } from '../src/db/types'
import { emit, listAfter } from '../src/services/events'
import { getFeatureFull } from '../src/services/features'
import {
  getFeatureRow,
  getProjectById,
  listRunsByFeature,
  listSessionsByFeature,
} from '../src/services/repo'
import { listByFeature as listNotes } from '../src/services/test-notes'
import { listByFeature as listTickets, storeTickets } from '../src/services/tickets'
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
        kind: 'seance' as SessionKind,
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

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
const RETIRE_MAPPED_MIGRATION = '0042_retire_mapped_ideation.sql'

/** A copy of the migrations folder stopped just before `migration`. */
function migrationsBefore(migration: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-pre-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < migration) copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

/**
 * Retiring mapped ideation (ADR-0012) drops the `waypoints` table and
 * `features.mapped` and shrinks `SessionKind`, so a DB written while maps
 * existed has to come out of the migration with every row still readable.
 */
describe('row contracts across the mapped-ideation retirement', () => {
  it('migrates a mapped feature, its waypoints and its sessions into rows that parse', async () => {
    const SQL = await initSqlJs()
    const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
    runMigrations(db, migrationsBefore(RETIRE_MAPPED_MIGRATION))
    const seed = [
      `INSERT INTO projects (id, name, repo_path) VALUES ('proj_1', 'demo', '/tmp/demo')`,
      `INSERT INTO features (id, project_id, slug, title, one_liner, mapped, phase, branch, status, created_at)
         VALUES ('feat_1', 'proj_1', 'mapped', 'Mapped', 'a mapped feature', 1, 'planning', 'feature/mapped', 'active', 1)`,
      `INSERT INTO waypoints (id, feature_id, seq, title, type, question, blocked_by, status)
         VALUES ('wp_1', 'feat_1', 1, 'Which store?', 'grilling', 'q', '[]', 'resolved')`,
      ...(['waypoint', 'converge', 'chat'] as const).map(
        (kind, i) =>
          `INSERT INTO sessions (id, feature_id, kind, status, worktree_path, created_at)
             VALUES ('sess_${i}', 'feat_1', '${kind}', 'ended', '/tmp/wt', ${i + 1})`,
      ),
      `INSERT INTO events (id, project_id, feature_id, ts, type, message, data)
         VALUES (1, 'proj_1', 'feat_1', 1, 'waypoint.resolved', 'Which store? resolved', '{"waypointId":"wp_1"}')`,
      `INSERT INTO events (id, project_id, feature_id, ts, type, message)
         VALUES (2, 'proj_1', 'feat_1', 2, 'feature.escalated', 'escalated to a map')`,
    ]
    for (const statement of seed) db.run(sql.raw(statement))
    const eventsBefore = db.all(sql.raw('SELECT * FROM events ORDER BY id'))

    runMigrations(db, DRIZZLE_DIR)
    const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }

    const tables = db.all<{ name: string }>(sql.raw(`SELECT name FROM sqlite_master WHERE type = 'table'`))
    expect(tables.map((t) => t.name)).not.toContain('waypoints')
    const featureColumns = db.all<{ name: string }>(sql.raw('PRAGMA table_info(features)'))
    expect(featureColumns.map((c) => c.name)).not.toContain('mapped')

    expect(getFeatureRow(ctx, 'feat_1')).not.toHaveProperty('mapped')
    expect(getProjectById(ctx, 'proj_1')?.name).toBe('demo')
    expect(listSessionsByFeature(ctx, 'feat_1').map((s) => [s.id, s.kind])).toEqual([
      ['sess_0', 'chat'],
      ['sess_1', 'chat'],
      ['sess_2', 'chat'],
    ])
    expect(db.all(sql.raw('SELECT * FROM events ORDER BY id'))).toEqual(eventsBefore)
    expect(listAfter(ctx, 'feat_1').map((e) => e.type)).toEqual(['waypoint.resolved', 'feature.escalated'])
  })
})
