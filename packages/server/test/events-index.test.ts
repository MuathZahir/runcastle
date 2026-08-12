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
 * The events table is what the UI polls every 1.5s, at two scopes — `listAfter`
 * (feature timeline) and `listByProject` (project timeline) — and it is
 * append-only: nothing prunes it, so an unindexed poll scans a table that only
 * grows. Both polls are `WHERE <scope> = ? AND id > ? ORDER BY id`, which the
 * (scope, id) indexes cover end to end.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0019`. */
function preIndexDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0019') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

/** Index names sqlite reports for the events table (skipping its own autoindexes). */
function eventIndexes(db: Db): string[] {
  const rows = db.all(
    sql.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'"),
  ) as { name: string }[]
  return rows.map((r) => r.name).filter((n) => !n.startsWith('sqlite_autoindex'))
}

describe('events polling indexes (0019)', () => {
  it('applies to a database that already holds events, and indexes both scopes', async () => {
    const db = await freshDb()

    // An existing install: schema up to just before the index migration, with
    // rows in it.
    runMigrations(db, preIndexDir())
    db.run(
      sql.raw(
        "INSERT INTO events (project_id, feature_id, lap, ts, type, message)" +
          " VALUES ('proj_1', 'feat_1', 1, 1, 'feature.created', 'f')",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO events (project_id, feature_id, lap, ts, type, message)" +
          " VALUES ('proj_1', NULL, 1, 2, 'project.opened', 'p')",
      ),
    )
    expect(eventIndexes(db)).toEqual([])

    runMigrations(db, DRIZZLE_DIR)

    expect(eventIndexes(db).sort()).toEqual([
      'events_feature_id_id_idx',
      'events_project_id_id_idx',
    ])
    // The rows survived — this migration only adds indexes.
    const count = db.all(sql.raw('SELECT COUNT(*) AS n FROM events')) as { n: number }[]
    expect(count[0].n).toBe(2)
  })

  it('re-running the migrator is a no-op (the index is created once)', async () => {
    const db = await freshDb()
    runMigrations(db, DRIZZLE_DIR)
    runMigrations(db, DRIZZLE_DIR)

    expect(eventIndexes(db)).toHaveLength(2)
  })

  it('plans both cursor polls through an index instead of a table scan', async () => {
    const db = await freshDb()
    runMigrations(db, DRIZZLE_DIR)

    const plan = (query: string): string =>
      (db.all(sql.raw(`EXPLAIN QUERY PLAN ${query}`)) as { detail: string }[])
        .map((r) => r.detail)
        .join(' | ')

    expect(
      plan("SELECT * FROM events WHERE feature_id = 'feat_1' AND id > 0 ORDER BY id"),
    ).toContain('events_feature_id_id_idx')
    expect(
      plan("SELECT * FROM events WHERE project_id = 'proj_1' AND id > 0 ORDER BY id"),
    ).toContain('events_project_id_id_idx')
  })
})
