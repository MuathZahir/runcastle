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
import { listByFeature } from '../src/services/review-findings'
import { RuncastleConfig } from '@runcastle/core'

/**
 * The carry and provenance columns (0037) land on a table that already holds
 * every finding any earlier lap reported, so the guard that matters is that the
 * migration applies to a populated database AND that those older rows — which
 * have no carry and no provenance to record — still parse through
 * `ReviewFinding`.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0037`. */
function preCarryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-finding-carry-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0037') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('finding carry and provenance columns migration (0037)', () => {
  it('adds three nullable columns and leaves an existing finding readable', async () => {
    const db = await freshDb()
    runMigrations(db, preCarryDir())

    db.run(
      sql.raw(
        'INSERT INTO review_findings (id, feature_id, lap, review_ticket_id, kind, severity,' +
          ' title, location, citation, detail, repro_step, status, created_at)' +
          " VALUES ('find_1', 'feat_1', 1, 'tkt_1', 'defect', 'high', 'the save drops the value'," +
          " 'a.ts:1', 'spec.md §save', 'it drops it', 'save and reload', 'open', 1)",
      ),
    )

    runMigrations(db, DRIZZLE_DIR)

    expect(listByFeature({ db, config: RuncastleConfig.parse({}) }, 'feat_1')).toEqual([
      expect.objectContaining({
        id: 'find_1',
        status: 'open',
        carriedLap: null,
        resolvedBy: null,
        resolutionNote: null,
      }),
    ])

    // Re-running the migrator over the same database is a no-op, not an error.
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
