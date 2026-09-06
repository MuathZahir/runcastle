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
 * `sessions.ended_at` (0034) lands on a table that already holds every
 * conversation an install has ever had. Those rows ended before anything
 * recorded endings, so the column must arrive null on them rather than
 * backfilled from `created_at` — the substitution this column exists to stop.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0034`. */
function preEndedAtDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-session-ended-at-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0034') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('session ended_at column migration (0034)', () => {
  it('adds nullable ended_at to sessions and leaves already-ended rows without an ending', async () => {
    const db = await freshDb()
    runMigrations(db, preEndedAtDir())

    db.run(
      sql.raw(
        'INSERT INTO sessions (id, feature_id, lap, kind, status, awaiting_input, worktree_path, created_at)' +
          " VALUES ('sess_1', 'feat_1', 1, 'ideation', 'ended', 0, 'C:\\wt', 1000)",
      ),
    )

    runMigrations(db, DRIZZLE_DIR)

    expect(db.all(sql.raw('SELECT id, created_at, ended_at FROM sessions'))).toEqual([
      { id: 'sess_1', created_at: 1000, ended_at: null },
    ])

    // Re-running the migrator over the same database is a no-op, not an error.
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
