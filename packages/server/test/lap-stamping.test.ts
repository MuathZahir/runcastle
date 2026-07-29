import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/sql-js'
import { eq, sql } from 'drizzle-orm'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { events, features, schema, sessions } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { AppCtx, Db } from '../src/db/types'
import { NotFoundError } from '../src/errors'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { toolGetFeatureContext } from '../src/mcp/server'
import { emit, emitForSession, emitProject } from '../src/services/events'
import { listByFeature, storeTickets } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Lap stamping (ADR-0010 / SPEC §15.1). A feature carries a lap; every ticket,
 * session and event row is tagged with the lap it was created in. Per ADR-0010
 * decision 8 there is no `laps` table — these tags ARE the machinery, so what is
 * worth pinning is that each of the four write paths stamps the right value and
 * that earlier laps' rows keep theirs.
 *
 * The tags are deliberately absent from the `SessionRow` / `EventRow` wire
 * types, so the assertions below read them straight off the table.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0014` (pre-laps). */
function preLapsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-laps-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0014') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

function ticket(title: string) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

/** Move a feature onto a later lap the way `rethink` will, without the service. */
function setLap(ctx: AppCtx, featureId: string, lap: number): void {
  ctx.db.update(features).set({ lap }).where(eq(features.id, featureId)).run()
}

describe('migration 0014 — lap columns over an existing database', () => {
  it('adds all four columns to a populated db, backfilling every row to lap 1', async () => {
    const db = await freshDb()
    // Schema as it stood before laps existed: no `lap` anywhere.
    runMigrations(db, preLapsDir())

    db.run(
      sql.raw(
        "INSERT INTO features (id, project_id, slug, title, one_liner, mapped, phase, branch, status, created_at)" +
          " VALUES ('feat_1', 'proj_1', 'demo', 'Demo', 'x', 0, 'review', 'feature/demo', 'active', 1)",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO tickets (id, feature_id, seq, title, goal, context, acceptance_criteria, seams, blocked_by, status, commits)" +
          " VALUES ('tkt_1', 'feat_1', 1, 'T', 'g', 'c', '[]', '[]', '[]', 'done', '[]')",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO sessions (id, feature_id, kind, status, worktree_path)" +
          " VALUES ('sess_1', 'feat_1', 'ideation', 'ended', '/wt')",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO events (project_id, feature_id, ts, type, message)" +
          " VALUES ('proj_1', 'feat_1', 1, 'feature.created', 'f')",
      ),
    )

    // The migration under test, applied to a db that already has rows in it.
    runMigrations(db, DRIZZLE_DIR)

    for (const table of ['features', 'tickets', 'sessions', 'events']) {
      const rows = db.all(sql.raw(`SELECT lap FROM ${table}`)) as { lap: number }[]
      expect(rows, `${table} should have exactly one backfilled row`).toEqual([{ lap: 1 }])
    }
  })

  it('is a no-op the second time — re-running never resets a lap already moved on', async () => {
    const db = await freshDb()
    runMigrations(db, preLapsDir())
    db.run(
      sql.raw(
        "INSERT INTO features (id, project_id, slug, title, one_liner, mapped, phase, branch, status, created_at)" +
          " VALUES ('feat_1', 'proj_1', 'demo', 'Demo', 'x', 0, 'review', 'feature/demo', 'active', 1)",
      ),
    )
    runMigrations(db, DRIZZLE_DIR)

    // A rethink has since moved the feature onto lap 2.
    db.run(sql.raw("UPDATE features SET lap = 2 WHERE id = 'feat_1'"))

    // Booting again re-runs the migrator over the same db — 0014 is already
    // recorded in `__migrations`, so it must not fire (a second ALTER TABLE
    // would throw; a re-applied default would silently rewind the lap).
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()

    const rows = db.all(sql.raw('SELECT lap FROM features')) as { lap: number }[]
    expect(rows).toEqual([{ lap: 2 }])
  })
})

describe('lap stamping', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let featureId: string
  let slug: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    projectId = seedProject(ctx, repoPath).id
    slug = 'dark-mode'
    featureId = seedFeature(ctx, projectId, { slug }).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('stores tickets at the feature current lap, leaving earlier laps untouched', () => {
    const [first] = storeTickets(ctx, featureId, [ticket('lap one work')])
    expect(first.lap).toBe(1)

    setLap(ctx, featureId, 2)
    const [second] = storeTickets(ctx, featureId, [ticket('lap two work')])
    expect(second.lap).toBe(2)

    // The whole history, each row keeping the lap it was emitted in.
    expect(listByFeature(ctx, featureId).map((t) => [t.title, t.lap])).toEqual([
      ['lap one work', 1],
      ['lap two work', 2],
    ])
  })

  it('stamps a feature session with the feature lap and a prepare session with 1', () => {
    setLap(ctx, featureId, 3)
    const featureSession = createSessionRow(ctx, {
      featureId,
      kind: 'ideation',
      worktreePath: '/wt',
    })
    // A project-scoped prepare session has no feature to take a lap from.
    const prepare = createSessionRow(ctx, { projectId, kind: 'prepare', worktreePath: repoPath })

    const lapOf = (id: string) =>
      ctx.db.select({ lap: sessions.lap }).from(sessions).where(eq(sessions.id, id)).get()?.lap

    expect(lapOf(featureSession.id)).toBe(3)
    expect(lapOf(prepare.id)).toBe(1)
  })

  it('stamps feature events with the feature lap and project-level events with 1', () => {
    setLap(ctx, featureId, 2)
    const featureEvent = emit(ctx, featureId, { type: 'lap.started', message: 'lap 2' })
    const projectEvent = emitProject(ctx, projectId, {
      type: 'project.opened',
      message: 'opened',
    })

    const lapOf = (id: number) =>
      ctx.db.select({ lap: events.lap }).from(events).where(eq(events.id, id)).get()?.lap

    expect(lapOf(featureEvent.id)).toBe(2)
    expect(lapOf(projectEvent.id)).toBe(1)
  })

  it('keeps emit / emitProject / emitForSession signatures — the lookup is internal', () => {
    setLap(ctx, featureId, 4)
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: '/wt' })
    const viaSession = emitForSession(ctx, session, { type: 'session.live', message: 'live' })

    const lap = ctx.db
      .select({ lap: events.lap })
      .from(events)
      .where(eq(events.id, viaSession?.id ?? -1))
      .get()?.lap
    expect(lap).toBe(4)

    // …and a session with neither scope still drops the event rather than throwing.
    expect(
      emitForSession(ctx, { ...session, featureId: undefined }, { type: 'x', message: 'x' }),
    ).toBeNull()
  })

  /**
   * `insertEvent` runs on boot reconciliation and PTY teardown, where a throw is
   * a server that will not start. The lap lookup therefore falls back to 1
   * instead of throwing — it must add no failure mode of its own on top of the
   * project lookup that already guards these paths.
   */
  it('adds no new failure mode when the feature is gone', () => {
    ctx.db.delete(features).where(eq(features.id, featureId)).run()

    // The pre-existing contract, unchanged: the project lookup is what refuses.
    expect(() => emit(ctx, featureId, { type: 'x', message: 'x' })).toThrow(NotFoundError)
    // A project-level event never consults a feature at all, so it still lands.
    expect(emitProject(ctx, projectId, { type: 'x', message: 'x' })).toBeTruthy()
  })

  it('exposes the lap at the top level of get_feature_context', () => {
    mkdirSync(join(repoPath, 'docs', 'features', slug), { recursive: true })
    writeFileSync(join(repoPath, 'docs', 'features', slug, 'brief.md'), '# Brief\n', 'utf8')
    setLap(ctx, featureId, 2)
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: repoPath })
    markSessionLive(ctx, session.id)

    const out = toolGetFeatureContext(ctx, session)
    expect(out.lap).toBe(2)
    expect(out.feature.lap).toBe(2)
  })
})
