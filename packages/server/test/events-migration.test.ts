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
 * Backfill guard for issue #44: rows written before the events table carried a
 * `project_id` must migrate. Feature events derive it from their feature;
 * project-level events (stored under the old design with `feature_id` = the
 * project id) get their project id lifted out and `feature_id` nulled.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0004`. */
function preFourDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0004') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('events project_id migration (0004)', () => {
  it('backfills feature and project-level rows, then nulls stale feature ids', async () => {
    const db = await freshDb()

    // Bring the schema up to just before 0004 (events still has NOT NULL
    // feature_id and no project_id column).
    runMigrations(db, preFourDir())

    db.run(
      sql.raw(
        "INSERT INTO projects (id, name, repo_path, main_branch) VALUES ('proj_1', 'p', '/tmp/p', 'main')",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO features (id, project_id, slug, title, one_liner, size, mapped, phase, branch, status, created_at)" +
          " VALUES ('feat_1', 'proj_1', 'demo', 'Demo', 'x', 'full', 0, 'ideation', 'feature/demo', 'active', 1)",
      ),
    )
    // A feature event and a legacy project-level event (feature_id = project id).
    db.run(
      sql.raw(
        "INSERT INTO events (feature_id, ts, type, message) VALUES ('feat_1', 1, 'feature.created', 'f')",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO events (feature_id, ts, type, message) VALUES ('proj_1', 2, 'project.opened', 'p')",
      ),
    )

    // Apply the remaining migrations (0004).
    runMigrations(db, DRIZZLE_DIR)

    const rows = db.all(
      sql.raw('SELECT type, project_id, feature_id FROM events ORDER BY id'),
    ) as { type: string; project_id: string | null; feature_id: string | null }[]

    expect(rows).toEqual([
      { type: 'feature.created', project_id: 'proj_1', feature_id: 'feat_1' },
      { type: 'project.opened', project_id: 'proj_1', feature_id: null },
    ])
  })
})
