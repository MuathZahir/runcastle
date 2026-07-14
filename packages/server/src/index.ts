import { trpcServer } from '@hono/trpc-server'
import { dbPath } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { ensureDataDir, loadConfig } from './config'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import type { AppCtx } from './db/types'
import { setRuntimeCtx } from './launcher/runtime'
import mcpApp from './mcp/server'
import { ptyRegistry } from './pty/registry'
import { terminalWebSocket, tryUpgradeTerminal } from './pty/ws'
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

  // Collapse the second db handle (docs/research/CORRECTIONS.md C2): the hooks
  // (`/api/hooks`) and MCP (`/mcp`) sub-apps resolve their `AppCtx` from
  // `launcher/runtime`, which otherwise lazily opens its own connection at boot.
  // Injecting the boot handle here makes one connection serve the whole app.
  // Tests that mount the sub-apps directly still inject their own ctx via
  // `setRuntimeCtx` — this is the same mechanism, called at boot.
  setRuntimeCtx(ctx)

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

  // Embedded-terminal WebSocket (UI-SPEC §5/§6, W1). The `/ws/terminal/:sessionId`
  // upgrade is attempted BEFORE Hono's fetch fallthrough; every other path is
  // handled by the Hono app unchanged. `buildApp` stays a pure Hono factory so
  // tests mount it without a socket — the WS lives only on this real listener.
  const server = Bun.serve({
    port: config.serverPort,
    fetch(req, srv) {
      if (tryUpgradeTerminal(req, srv)) return undefined
      return app.fetch(req, srv)
    },
    websocket: terminalWebSocket,
  })
  console.log(`runcastle server listening on http://localhost:${config.serverPort}`)

  // Kill every live PTY on shutdown so no orphaned claude processes survive.
  // Registered once even across `bun --hot` reloads (which re-run `main`) to
  // avoid piling up signal listeners.
  const SHUTDOWN_KEY = Symbol.for('runcastle.shutdown.wired')
  const g = globalThis as typeof globalThis & { [SHUTDOWN_KEY]?: boolean }
  if (!g[SHUTDOWN_KEY]) {
    g[SHUTDOWN_KEY] = true
    const shutdown = (): void => {
      ptyRegistry().killAll()
      server.stop()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }
}

if (import.meta.main) {
  void main()
}
