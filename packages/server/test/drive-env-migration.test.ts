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
 * Retiring `driveEnv` (0023) removes a column that holds real values on the one
 * known install, and leaves behind provenance rows for a key that is no longer
 * a `PreparedKey` — those would fail the enum parse the findings listing makes.
 * So the migration has to clear both halves, on a database that already has rows.
 * There is deliberately no read-only shim: the re-prep IS the migration.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0023`. */
function preRemovalDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-drive-env-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0023') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('driveEnv removal migration (0023)', () => {
  it('drops the column and the stale finding rows, leaving every other finding', async () => {
    const db = await freshDb()
    runMigrations(db, preRemovalDir())

    db.run(
      sql.raw(
        "INSERT INTO projects (id, name, repo_path, main_branch, drive_env)" +
          " VALUES ('proj_1', 'P', '/repo', 'main', 'DATABASE_URL=postgres:///app_{{id}}')",
      ),
    )
    for (const key of ['driveEnv', 'driveSetupCommand']) {
      db.run(
        sql.raw(
          "INSERT INTO project_findings (project_id, key, source, established_at)" +
            ` VALUES ('proj_1', '${key}', 'prep', 1)`,
        ),
      )
    }

    runMigrations(db, DRIZZLE_DIR)

    // The project survives; the column it carried the value in does not.
    expect(db.all(sql.raw('SELECT id FROM projects'))).toEqual([{ id: 'proj_1' }])
    expect(() => db.all(sql.raw('SELECT drive_env FROM projects'))).toThrow()

    // A row for a key that is no longer prepared would fail the listing's parse.
    expect(db.all(sql.raw('SELECT key FROM project_findings'))).toEqual([
      { key: 'driveSetupCommand' },
    ])

    // Re-running the migrator over the same database is a no-op, not an error.
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
