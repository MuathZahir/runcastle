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
 * The per-ticket `model` column (0028) lands on a table that already holds rows
 * on every existing install, so the guard that matters is that it applies to a
 * populated database and leaves those tickets unassigned — which is exactly the
 * default `resolveModel` chain they burned on.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0028`. */
function preModelDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-ticket-model-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0028') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('ticket model column migration (0028)', () => {
  it('adds nullable model to tickets and runs on a database that already has rows', async () => {
    const db = await freshDb()
    runMigrations(db, preModelDir())

    db.run(
      sql.raw(
        'INSERT INTO tickets (id, feature_id, seq, title, goal, context, acceptance_criteria, seams, blocked_by, lap, status, commits)' +
          " VALUES ('tkt_1', 'feat_1', 1, 'T', 'g', 'c', '[]', '[]', '[]', 1, 'done', '[]')",
      ),
    )

    runMigrations(db, DRIZZLE_DIR)

    expect(db.all(sql.raw('SELECT id, model FROM tickets'))).toEqual([
      { id: 'tkt_1', model: null },
    ])

    // Re-running the migrator over the same database is a no-op, not an error.
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
