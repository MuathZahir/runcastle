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

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

function preStampDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-review-stamps-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < '0034') copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('review evidence stamp migration (0034)', () => {
  it('defaults existing tickets to a review pass with no fabricated stamps', async () => {
    const db = await freshDb()
    runMigrations(db, preStampDir())
    db.run(sql.raw(
      'INSERT INTO tickets (id, feature_id, seq, title, goal, context, acceptance_criteria, seams, blocked_by, kind, lap, status, commits)' +
      " VALUES ('tkt_1', 'feat_1', 1, 'T', 'g', 'c', '[]', '[]', '[]', 'review', 1, 'done', '[]')",
    ))

    runMigrations(db, DRIZZLE_DIR)

    expect(db.all(sql.raw('SELECT pass_kind, reviewed_commit, completed_at FROM tickets'))).toEqual([
      { pass_kind: 'review', reviewed_commit: null, completed_at: null },
    ])
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
