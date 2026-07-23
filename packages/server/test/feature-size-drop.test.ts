import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextPhase } from '@runcastle/core'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { features, schema } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import { rowToFeature } from '../src/services/repo'
import type { Db } from '../src/db/types'

/**
 * The `size`/`collapsed` concept was removed (ticket 1). Migration 0008 drops
 * the `size` column; a feature row written under the legacy schema with
 * `size = 'collapsed'` must survive the drop, load cleanly, and advance
 * ideation → spec like every other feature (no collapsed skip remains).
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0008` (size still present). */
function preDropDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0008') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('feature size column drop (0008)', () => {
  it('a legacy size=collapsed row loads and advances ideation → spec', async () => {
    const db = await freshDb()

    // Bring the schema up to just before 0008 — the `size` column still exists.
    runMigrations(db, preDropDir())

    db.run(
      sql.raw(
        "INSERT INTO projects (id, name, repo_path, main_branch) VALUES ('proj_1', 'p', '/tmp/p', 'main')",
      ),
    )
    db.run(
      sql.raw(
        "INSERT INTO features (id, project_id, slug, title, one_liner, size, mapped, phase, branch, status, created_at)" +
          " VALUES ('feat_1', 'proj_1', 'legacy', 'Legacy', 'x', 'collapsed', 0, 'ideation', 'feature/legacy', 'active', 1)",
      ),
    )

    // Apply the remaining migrations (0008 drops `size`).
    runMigrations(db, DRIZZLE_DIR)

    const row = db.select().from(features).where(eq(features.id, 'feat_1')).get()
    expect(row).toBeTruthy()
    const feature = rowToFeature(row!)
    expect(feature.phase).toBe('ideation')
    // No collapsed skip: ideation advances to spec for every feature.
    expect(nextPhase(feature)).toBe('spec')
  })
})
