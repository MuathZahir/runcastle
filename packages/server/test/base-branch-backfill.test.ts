import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/db/migrate'
import { schema } from '../src/db/schema'
import type { Db } from '../src/db/types'

/**
 * Features cut before `base_branch` existed carry a null base, and every feature
 * path now reads that column and nothing else — so the rows have to be told, once,
 * what they forked from. `main_branch` is the only answer for them, and this is
 * the last migration that can still read it (decision 4).
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before the backfill. */
function preBackfillDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-base-backfill-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0031') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

function seedRow(db: Db, id: string, projectId: string, status: string): void {
  db.run(
    sql.raw(
      'INSERT INTO features (id, project_id, slug, title, one_liner, mapped, lap, phase, branch, status, created_at)' +
        ` VALUES ('${id}', '${projectId}', '${id}', 'T', 'o', 0, 1, 'ideation', 'feature/${id}', '${status}', 1)`,
    ),
  )
}

describe('base_branch backfill migration (0031)', () => {
  it('gives every non-draft feature its project main line, and leaves drafts null', async () => {
    const db = await freshDb()
    runMigrations(db, preBackfillDir())

    for (const [id, main] of [
      ['proj_1', 'main'],
      ['proj_2', 'develop'],
    ]) {
      db.run(
        sql.raw(
          'INSERT INTO projects (id, name, repo_path, main_branch)' +
            ` VALUES ('${id}', '${id}', '/repo/${id}', '${main}')`,
        ),
      )
    }
    seedRow(db, 'kept', 'proj_1', 'active')
    seedRow(db, 'legacy', 'proj_1', 'active')
    seedRow(db, 'on_develop', 'proj_2', 'active')
    seedRow(db, 'parked', 'proj_1', 'draft')
    seedRow(db, 'shipped', 'proj_1', 'merged')
    // A feature that already recorded a base must keep it, main line or not.
    db.run(sql.raw("UPDATE features SET base_branch = 'release' WHERE id = 'kept'"))

    runMigrations(db, DRIZZLE_DIR)

    expect(db.all(sql.raw('SELECT id, base_branch FROM features ORDER BY id'))).toEqual([
      { id: 'kept', base_branch: 'release' },
      { id: 'legacy', base_branch: 'main' },
      // Its own project's main line, not the first one the UPDATE happened to see.
      { id: 'on_develop', base_branch: 'develop' },
      { id: 'parked', base_branch: null },
      { id: 'shipped', base_branch: 'main' },
    ])

    // Re-running the migrator over the same database is a no-op, not an error.
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
