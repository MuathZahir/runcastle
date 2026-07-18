import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { ASSET_ENV, resolveAsset } from '../launcher/asset-paths'
import type { Db } from './types'

/**
 * Idempotent, driver-agnostic migrator. Applies the bundled SQL migrations in
 * `packages/server/drizzle/` (generated from the core schema via
 * `bun run db:generate`) through the drizzle `db.run(sql.raw(...))` API, which
 * works identically on the bun-sqlite boot driver and the sql.js test driver —
 * so the exact same code path gives a clean-machine boot its schema AND gives
 * `:memory:` tests theirs (SPEC §2, task acceptance bar: zero manual steps).
 *
 * We track applied files in a `__migrations` table rather than using drizzle's
 * driver-specific `migrate()` (which would force a `bun:sqlite` import into the
 * test path), so re-booting an existing db is a no-op.
 */

// Workspace source path; a published install vendors the SQL and points
// RUNCASTLE_MIGRATIONS_DIR at the vendored copy (issue #51).
const MIGRATIONS_DIR = resolveAsset(
  ASSET_ENV.migrations,
  join(import.meta.dirname, '..', '..', 'drizzle'),
)

const STATEMENT_BREAKPOINT = '--> statement-breakpoint'

export function runMigrations(db: Db, dir: string = MIGRATIONS_DIR): void {
  db.run(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS __migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )`,
    ),
  )

  const appliedRows = db.all(sql.raw('SELECT name FROM __migrations')) as { name: string }[]
  const applied = new Set(appliedRows.map((r) => r.name))

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const contents = readFileSync(join(dir, file), 'utf8')
    const statements = contents
      .split(STATEMENT_BREAKPOINT)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    db.transaction((tx) => {
      for (const statement of statements) {
        tx.run(sql.raw(statement))
      }
      tx.run(sql`INSERT INTO __migrations (name, applied_at) VALUES (${file}, ${Date.now()})`)
    })
  }
}
