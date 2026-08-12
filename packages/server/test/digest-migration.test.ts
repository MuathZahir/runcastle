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
 * The `digest` columns (0019) land on tables that already hold rows on every
 * existing install — so the guard that matters is that the migration applies to
 * a populated database rather than only to a fresh one.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0019`. */
function preDigestDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-digest-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0019') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('digest columns migration (0019)', () => {
  it('adds nullable digest to tickets and runs on a database that already has rows', async () => {
    const db = await freshDb()
    runMigrations(db, preDigestDir())

    db.run(
      sql.raw(
        "INSERT INTO tickets (id, feature_id, seq, title, goal, context, acceptance_criteria, seams, blocked_by, lap, status, commits)" +
          " VALUES ('tkt_1', 'feat_1', 1, 'T', 'g', 'c', '[]', '[]', '[]', 1, 'done', '[\"abc\"]')",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO runs (id, feature_id, workflow, status, started_at)" +
          " VALUES ('run_1', 'feat_1', 'ticket-burner', 'succeeded', 1)",
      ),
    )

    runMigrations(db, DRIZZLE_DIR)

    // The pre-existing rows survive, with no digest recorded for either.
    expect(db.all(sql.raw('SELECT id, digest FROM tickets'))).toEqual([
      { id: 'tkt_1', digest: null },
    ])
    expect(db.all(sql.raw('SELECT id, digest FROM runs'))).toEqual([{ id: 'run_1', digest: null }])

    // Re-running the migrator over the same database is a no-op, not an error.
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
