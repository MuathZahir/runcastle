import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { schema } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { Db } from '../src/db/types'

/**
 * Phases and laps leave the schema (tickets-and-review-are-tools-not-phases
 * decisions 2, 6 and 11): 0052 drops every phase and lap column, and the ready
 * declaration's what-to-test. Existing rows lose only those columns, and a
 * finding a lap had carried is open again, since only the agent resolves one.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding every file strictly before `0052`. */
function withPhasesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-phase-lap-drop-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0052') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

function columns(db: Db, table: string): string[] {
  return db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`)).map((c) => c.name)
}

function row(db: Db, query: string): Record<string, unknown> {
  return db.all<Record<string, unknown>>(sql.raw(query))[0]
}

function seed(db: Db): void {
  for (const statement of [
    'INSERT INTO features (id, project_id, slug, title, one_liner, phase, lap, tickets_ready_lap, branch, status, created_at, waiting_reason)' +
      " VALUES ('feat_1', 'proj_1', 'grain', 'Grain', 'make it visible', 'review', 3, 3, 'feature/grain', 'active', 10, 'ready to test')",
    'INSERT INTO tickets (id, feature_id, seq, title, goal, context, acceptance_criteria, seams, blocked_by, status, commits, lap)' +
      " VALUES ('tkt_1', 'feat_1', 1, 'Grain', 'show it', 'ctx', '[\"visible\"]', '[]', '[]', 'done', '[\"abc\"]', 2)",
    "INSERT INTO sessions (id, feature_id, kind, status, worktree_path, lap) VALUES ('ses_1', 'feat_1', 'chat', 'ended', '/w', 2)",
    'INSERT INTO review_findings (id, feature_id, lap, review_ticket_id, kind, severity, title, location, citation, detail, repro_step, status, carried_lap, created_at)' +
      " VALUES ('find_1', 'feat_1', 2, 'tkt_1', 'defect', 'high', 'drops it', 'a.ts:1', 'spec', 'detail', 'save', 'carried', 3, 20)",
    'INSERT INTO review_findings (id, feature_id, lap, review_ticket_id, kind, severity, title, location, citation, detail, repro_step, status, created_at)' +
      " VALUES ('find_2', 'feat_1', 2, 'tkt_1', 'defect', 'low', 'typo', 'b.ts:1', 'spec', 'detail', 'read', 'dismissed', 21)",
    "INSERT INTO test_notes (id, feature_id, lap, text, status, carried_lap, created_at, updated_at) VALUES ('note_1', 'feat_1', 2, 'too faint', 'open', 3, 30, 31)",
    "INSERT INTO events (project_id, feature_id, lap, ts, type, message) VALUES ('proj_1', 'feat_1', 2, 40, 'ticket.done', 'landed')",
    "INSERT INTO ready_declarations (id, feature_id, run_id, scenario, what_to_test, created_at) VALUES ('rdy_1', 'feat_1', 'run_1', 'review/grain', 'the grain', 50)",
  ]) {
    db.run(sql.raw(statement))
  }
}

describe('phase and lap columns drop (0052)', () => {
  it('drops every phase and lap column and the ready declaration what-to-test', async () => {
    const db = await freshDb()
    runMigrations(db, DRIZZLE_DIR)

    for (const gone of ['phase', 'lap', 'tickets_ready_lap']) expect(columns(db, 'features')).not.toContain(gone)
    for (const table of ['tickets', 'sessions', 'events']) expect(columns(db, table)).not.toContain('lap')
    for (const table of ['review_findings', 'test_notes']) {
      expect(columns(db, table)).not.toContain('lap')
      expect(columns(db, table)).not.toContain('carried_lap')
    }
    expect(columns(db, 'ready_declarations')).not.toContain('what_to_test')
  })

  it('keeps every other column of an existing row', async () => {
    const db = await freshDb()
    runMigrations(db, withPhasesDir())
    seed(db)

    runMigrations(db, DRIZZLE_DIR)

    expect(row(db, "SELECT * FROM features WHERE id = 'feat_1'")).toEqual(
      expect.objectContaining({
        slug: 'grain',
        title: 'Grain',
        one_liner: 'make it visible',
        branch: 'feature/grain',
        status: 'active',
        created_at: 10,
        waiting_reason: 'ready to test',
      }),
    )
    expect(row(db, "SELECT * FROM tickets WHERE id = 'tkt_1'")).toEqual(
      expect.objectContaining({ seq: 1, title: 'Grain', status: 'done', commits: '["abc"]' }),
    )
    expect(row(db, "SELECT * FROM sessions WHERE id = 'ses_1'")).toEqual(
      expect.objectContaining({ feature_id: 'feat_1', kind: 'chat', worktree_path: '/w' }),
    )
    expect(row(db, "SELECT * FROM test_notes WHERE id = 'note_1'")).toEqual(
      expect.objectContaining({ text: 'too faint', status: 'open', created_at: 30 }),
    )
    expect(row(db, "SELECT * FROM events WHERE feature_id = 'feat_1'")).toEqual(
      expect.objectContaining({ ts: 40, type: 'ticket.done', message: 'landed' }),
    )
    expect(row(db, "SELECT * FROM ready_declarations WHERE id = 'rdy_1'")).toEqual(
      expect.objectContaining({ run_id: 'run_1', scenario: 'review/grain', created_at: 50 }),
    )
    expect(row(db, "SELECT * FROM review_findings WHERE id = 'find_2'")).toEqual(
      expect.objectContaining({ title: 'typo', status: 'dismissed', repro_step: 'read' }),
    )
  })

  it('reopens a finding a lap had carried', async () => {
    const db = await freshDb()
    runMigrations(db, withPhasesDir())
    seed(db)

    runMigrations(db, DRIZZLE_DIR)

    expect(row(db, "SELECT status FROM review_findings WHERE id = 'find_1'")).toEqual({ status: 'open' })
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
