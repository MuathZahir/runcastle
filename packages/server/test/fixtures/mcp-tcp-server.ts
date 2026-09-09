/**
 * A production-wired runcastle server on a real TCP socket, for the large-batch
 * `/mcp` regression test (`test/mcp-large-batch.test.ts`).
 *
 * This exists as a spawned **bun** process because the layer under test is the
 * one vitest cannot host: the suite runs under node (see `test/helpers/db.ts`),
 * so `Bun.serve` — a prime suspect for the large-payload stall — is not even a
 * global there. Every other MCP test mounts the Hono app in-process via
 * `app.fetch`, which never touches a socket, a `Content-Length`, or Bun's
 * request-body reader.
 *
 * Boot contract:
 *   argv[2]   absolute path for the sqlite file to create
 *   stdout    ONE json line: { port, featureId, sessionId, repoPath }
 *   stdin     "shutdown\n" → close the listener and exit 0
 *
 * The db is a real `bun:sqlite` file rather than the suite's in-memory sql.js
 * handle, so the node-side test can reopen the same bytes to read the tickets
 * back. Journal mode is DELETE, not the production WAL: sql.js cannot read a
 * `-wal` sidecar, and the journal is orthogonal to the HTTP layer under test.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { RuncastleConfig } from '@runcastle/core'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { SERVE_HOSTNAME, SERVE_IDLE_TIMEOUT_SECONDS } from '../../src/config'
import { runMigrations } from '../../src/db/migrate'
import { schema } from '../../src/db/schema'
import type { AppCtx, Db } from '../../src/db/types'
import { buildApp } from '../../src/index'
import { createSessionRow, markSessionLive } from '../../src/launcher/sessions'
import { seedFeature, seedProject } from '../helpers/fixtures'

const dbFile = process.argv[2]
if (!dbFile) throw new Error('usage: mcp-tcp-server.ts <db-file>')

const sqlite = new Database(dbFile, { create: true })
sqlite.exec('PRAGMA journal_mode = DELETE;')
sqlite.exec('PRAGMA foreign_keys = ON;')
const db = drizzle({ client: sqlite, schema }) as unknown as Db
runMigrations(db)

const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }
const repoPath = mkdtempSync(join(tmpdir(), 'runcastle-tcp-'))
const project = seedProject(ctx, repoPath)
const feature = seedFeature(ctx, project.id, { slug: 'large-batch', phase: 'ideation' })
const session = createSessionRow(ctx, {
  featureId: feature.id,
  kind: 'ideation',
  worktreePath: repoPath,
})
markSessionLive(ctx, session.id)

// The production listen options (`src/index.ts#startServer`), minus the terminal
// WebSocket upgrade, which no MCP request goes through. `port: 0` takes an
// ephemeral port so concurrent test files never collide.
const server = Bun.serve({
  port: 0,
  hostname: SERVE_HOSTNAME,
  idleTimeout: SERVE_IDLE_TIMEOUT_SECONDS,
  fetch: buildApp(ctx).fetch,
})

console.log(
  JSON.stringify({
    port: server.port,
    featureId: feature.id,
    sessionId: session.id,
    repoPath,
  }),
)

for await (const chunk of console) {
  if (chunk.trim() === 'shutdown') break
}
await server.stop(true)
sqlite.close()
process.exit(0)
