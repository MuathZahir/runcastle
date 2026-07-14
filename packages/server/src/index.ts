import { trpcServer } from '@hono/trpc-server'
import { dbPath } from '@runcastle/core'
import { Hono } from 'hono'
import { ensureDataDir, loadConfig } from './config'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import type { AppCtx } from './db/types'
import mcpApp from './mcp/server'
import hooksApp from './routes/hooks'
import { appRouter } from './trpc/router'

/**
 * Server boot (SPEC §3, owner A1). `buildApp` is a pure function of the DI
 * context so tests can mount the full app over an in-memory db without binding
 * a port; `main` performs the boot side effects (data dir, db, migrate, serve).
 * The `Bun.serve` call is guarded by `import.meta.main`, so importing this
 * module (e.g. `buildApp` in a test) never listens on 4512.
 */
export function buildApp(ctx: AppCtx): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true }))

  app.use(
    '/api/trpc/*',
    trpcServer({
      router: appRouter,
      createContext: () => ctx,
    }),
  )

  app.route('/api/hooks', hooksApp)
  app.route('/mcp', mcpApp)

  return app
}

async function main(): Promise<void> {
  const config = loadConfig()
  ensureDataDir()

  // Clean-machine boot: create ~/.runcastle/runcastle.db (WAL on) and apply the
  // bundled migrations — zero manual steps (task acceptance bar).
  const db = createDb(dbPath())
  runMigrations(db)

  const app = buildApp({ db, config })
  Bun.serve({ port: config.serverPort, fetch: app.fetch })
  console.log(`runcastle server listening on http://localhost:${config.serverPort}`)
}

if (import.meta.main) {
  void main()
}
