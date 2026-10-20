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
 * The story catalogue is gone (the-map-shows-every-page-and-its-states decision
 * 16), and with it the review ticket's `stories_build` column. 0048 added it and
 * has run on existing installs, so it stays; a later migration drops it.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding every file up to and including `0048`. */
function withStoriesBuildDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-stories-build-drop-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0049') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

function ticketColumns(db: Db): string[] {
  return db.all<{ name: string }>(sql.raw('PRAGMA table_info(tickets)')).map((c) => c.name)
}

describe('ticket stories_build column drop', () => {
  it('migrates a fresh database to head without the column', async () => {
    const db = await freshDb()
    runMigrations(db, DRIZZLE_DIR)

    expect(ticketColumns(db)).toContain('review_gate_run')
    expect(ticketColumns(db)).not.toContain('stories_build')
  })

  it('drops the column from a database that has rows and a recorded build', async () => {
    const db = await freshDb()
    runMigrations(db, withStoriesBuildDir())
    expect(ticketColumns(db)).toContain('stories_build')
    db.run(
      sql.raw(
        'INSERT INTO tickets (id, feature_id, seq, title, goal, context, acceptance_criteria, seams, blocked_by, lap, status, commits, kind, stories_build)' +
          " VALUES ('tkt_1', 'feat_1', 1, 'Review', 'g', 'c', '[]', '[]', '[]', 1, 'done', '[]', 'review', '{\"status\":\"none\"}')",
      ),
    )

    runMigrations(db, DRIZZLE_DIR)

    expect(ticketColumns(db)).not.toContain('stories_build')
    expect(db.all(sql.raw('SELECT id, kind FROM tickets'))).toEqual([{ id: 'tkt_1', kind: 'review' }])
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
