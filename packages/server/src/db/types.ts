import type { RuncastleConfig } from '@runcastle/core'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { Schema } from './schema'

/**
 * Driver-agnostic drizzle handle. Both the boot driver (`drizzle-orm/bun-sqlite`,
 * sync) and the test driver (`drizzle-orm/sql-js`, sync) produce a value
 * assignable to this type, so services accept exactly one `Db` shape and can be
 * exercised against an in-memory sql.js database under vitest (no `bun:sqlite`,
 * which vitest's node runtime cannot load).
 *
 * `TRunResult` is left as `unknown` — services never consume statement run
 * results, and the two drivers disagree on its concrete type.
 */
export type Db = BaseSQLiteDatabase<'sync', unknown, Schema>

/**
 * The dependency-injected context threaded through every service and the tRPC
 * resolvers. No module-global db singleton lives in services — the db handle is
 * always passed in, which is what lets tests point services at `:memory:`.
 *
 * Declared as a type alias (not an interface) so it carries an implicit index
 * signature and is assignable to `@hono/trpc-server`'s `Record<string, unknown>`
 * createContext return type.
 */
export type AppCtx = {
  db: Db
  config: RuncastleConfig
}
