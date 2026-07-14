import { RuncastleConfig } from '@runcastle/core'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { schema } from '../../src/db/schema'
import { runMigrations } from '../../src/db/migrate'
import type { AppCtx, Db } from '../../src/db/types'

/**
 * Build a fresh in-memory `AppCtx` for a test. Uses `drizzle-orm/sql-js` (WASM,
 * pure JS) rather than `bun:sqlite`, which vitest's node runtime cannot load —
 * both are sync sqlite drivers producing a value assignable to `Db`, so
 * services run unchanged. Reuses the exact boot migration path (`runMigrations`)
 * so `:memory:` gets the full schema (task item 9).
 */
export async function makeTestCtx(): Promise<AppCtx> {
  const SQL = await initSqlJs()
  const sqlite = new SQL.Database()
  const db = drizzle(sqlite, { schema }) as unknown as Db
  runMigrations(db)
  const config = RuncastleConfig.parse({})
  return { db, config }
}
