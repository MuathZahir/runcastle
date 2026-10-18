import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { schema } from './schema'
import type { Db } from './types'

/**
 * The boot-time drizzle client, backed by `bun:sqlite` (SPEC §2). This module
 * is the ONLY place that imports `bun:sqlite`, so it is imported solely by
 * `index.ts` (the bun entrypoint) — never by services or tests, which would
 * otherwise fail to load under vitest's node runtime. Tests build their own
 * sql.js-backed `Db` (see `test/helpers/db.ts`).
 *
 * WAL is enabled per the acceptance bar; foreign_keys on for integrity.
 * busy_timeout makes a write that meets another connection's lock wait for it
 * instead of failing at once with SQLITE_BUSY ("database is locked") — a
 * momentary lock (a checkpoint, a reader holding the WAL) used to drop a hook's
 * check-in on the floor.
 */
export const BUSY_TIMEOUT_MS = 5_000

export function createDb(path: string): Db {
  const sqlite = new Database(path, { create: true })
  sqlite.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`)
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  return drizzle({ client: sqlite, schema }) as unknown as Db
}
