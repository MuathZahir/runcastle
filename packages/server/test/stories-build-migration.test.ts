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
 * The review ticket's `stories_build` column (0048, stories decision 18) lands
 * on a table that already holds rows on every existing install, so it must
 * apply to a populated database and leave earlier passes with no record.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0048`. */
function preStoriesBuildDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-stories-build-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0048') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('ticket stories_build column migration (0048)', () => {
  it('adds a nullable stories_build to tickets and runs on a database that already has rows', async () => {
    const db = await freshDb()
    runMigrations(db, preStoriesBuildDir())

    db.run(
      sql.raw(
        'INSERT INTO tickets (id, feature_id, seq, title, goal, context, acceptance_criteria, seams, blocked_by, lap, status, commits, kind)' +
          " VALUES ('tkt_1', 'feat_1', 1, 'Review', 'g', 'c', '[]', '[]', '[]', 1, 'done', '[]', 'review')",
      ),
    )

    runMigrations(db, DRIZZLE_DIR)

    expect(db.all(sql.raw('SELECT id, stories_build FROM tickets'))).toEqual([
      { id: 'tkt_1', stories_build: null },
    ])
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
