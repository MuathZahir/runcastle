import { trpcServer } from '@hono/trpc-server'
import { REVIEWS_BASE } from '@runcastle/core'
import { dataDir, dbPath } from '@runcastle/core/paths'
import { Hono } from 'hono'
import {
  SERVE_HOSTNAME,
  SERVE_IDLE_TIMEOUT_SECONDS,
  ensureDataDir,
  loadConfig,
} from './config'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import type { AppCtx } from './db/types'
import { reconcileStaleSessions } from './launcher/reconcile'
import { setRuntimeCtx } from './launcher/runtime'
import mcpApp from './mcp/server'
import { ptyRegistry } from './pty/registry'
import { terminalWebSocket, tryUpgradeTerminal } from './pty/ws'
import hooksApp from './routes/hooks'
import reviewsApp from './routes/reviews'
import streamApp from './routes/stream'
import { mountWebAppIfBuilt } from './routes/web'
import { getUpdateInfo } from './services/update-check'
import { createShutdown } from './shutdown'
import { appRouter } from './trpc/router'
import { runcastleVersion } from './version'
import { reconcileStaleRuns } from './workflows/reconcile-runs'

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

  // `dataDir` identifies WHICH tree this server is serving. A port alone does
  // not: dev (`~/.runcastle-dev/`) and an install (`~/.runcastle/`) both listen
  // on 4512, so the dev tool would otherwise mistake one for the other when
  // deciding whether a live server needs restarting after a db change.
  app.get('/health', (c) => c.json({ ok: true, dataDir: dataDir() }))

  // tRPC replies are UTF-8 but @hono/trpc-server omits the charset, so
  // CP1252-defaulting clients (Windows PowerShell 5.1 et al.) mis-decode
  // em-dashes and non-Latin text. The hooks/MCP sub-apps declare it themselves.
  app.use('/api/trpc/*', async (c, next) => {
    await next()
    if (c.res.headers.get('content-type') === 'application/json') {
      c.res.headers.set('content-type', 'application/json; charset=utf-8')
    }
  })

  app.use(
    '/api/trpc/*',
    trpcServer({
      router: appRouter,
      createContext: () => ctx,
    }),
  )

  app.route('/api/hooks', hooksApp)
  // Review artifacts (routes/reviews.ts) — the walkthrough video is media, so it
  // is served over plain HTTP with range requests rather than through tRPC. The
  // mount point comes from core because the URLs the service stamps onto notes
  // are built from it: a mount moved by hand here would 404 every thumbnail.
  app.route(REVIEWS_BASE, reviewsApp)
  // Live-update SSE (routes/stream.ts) — the push channel the UI listens on.
  app.route('/api/stream', streamApp)
  app.route('/mcp', mcpApp)

  // Production: serve the built SPA from this same origin (issue #38). No-op in
  // dev/tests where `apps/web/dist` is absent — Vite serves the SPA there.
  mountWebAppIfBuilt(app)

  return app
}

export async function startServer(): Promise<void> {
  const config = loadConfig()
  ensureDataDir()

  // Clean-machine boot: create ~/.runcastle/runcastle.db (WAL on) and apply the
  // bundled migrations — zero manual steps (task acceptance bar).
  const db = createDb(dbPath())
  runMigrations(db)

  const ctx: AppCtx = { db, config }
  const app = buildApp(ctx)

  // Boot reconciliation: sessions left `launching`/`live` by a previous server
  // process are dead by definition (the PTY registry is in-memory) — end them
  // and release their waypoint claims so the guard + frontier recover. Sessions
  // with a PTY still alive in the registry (`bun --hot` reload) are skipped.
  const reconciled = reconcileStaleSessions(ctx)
  if (reconciled.length > 0) {
    console.log(`reconciled ${reconciled.length} stale session(s) from a previous server run`)
  }

  // Same recovery for run rows: a crashed server leaves them `running`, which
  // would wedge the branch-claiming launcher guard forever.
  const staleRuns = await reconcileStaleRuns(ctx)
  if (staleRuns.length > 0) {
    console.log(`reconciled ${staleRuns.length} stale run(s) from a previous server run`)
  }

  // Embedded-terminal WebSocket (UI-SPEC §5/§6, W1). The `/ws/terminal/:sessionId`
  // upgrade is attempted BEFORE Hono's fetch fallthrough; every other path is
  // handled by the Hono app unchanged. `buildApp` stays a pure Hono factory so
  // tests mount it without a socket — the WS lives only on this real listener.
  const server = Bun.serve({
    port: config.serverPort,
    hostname: SERVE_HOSTNAME,
    idleTimeout: SERVE_IDLE_TIMEOUT_SECONDS,
    fetch(req, srv) {
      if (tryUpgradeTerminal(req, srv)) return undefined
      return app.fetch(req, srv)
    },
    websocket: terminalWebSocket,
  })
  // Print the data dir, not just the port: dev runs against `~/.runcastle-dev/`
  // and an install against `~/.runcastle/`, and "which tree am I looking at?" is
  // the first question when a project you expected is missing.
  console.log(
    `runcastle${process.env.RUNCASTLE_DEV ? ' [dev]' : ''} server listening on ` +
      `http://localhost:${config.serverPort} — data dir: ${dataDir()}`,
  )

  // Check for a newer release here, at boot, rather than lazily on the first UI
  // page load: a server booted without anyone opening the app never checked at
  // all, and "booted a server" is the honest definition of an active install.
  // Fire-and-forget — the result is memoized for the banner's tRPC query, and
  // the `catch` keeps even an unforeseen rejection off the boot path.
  void getUpdateInfo(runcastleVersion()).catch(() => {})

  // Kill every live PTY on shutdown so no orphaned claude processes survive.
  // Registered once even across `bun --hot` reloads (which re-run `main`) to
  // avoid piling up signal listeners.
  const SHUTDOWN_KEY = Symbol.for('runcastle.shutdown.wired')
  const g = globalThis as typeof globalThis & { [SHUTDOWN_KEY]?: boolean }
  if (!g[SHUTDOWN_KEY]) {
    g[SHUTDOWN_KEY] = true
    const shutdown = createShutdown({
      killAllTrees: () => ptyRegistry().killAllTrees(),
      stop: () => server.stop(),
      exit: (code) => process.exit(code),
    })
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }
}

// NB: no `if (import.meta.main) startServer()` here. `src/bin/runcastle.ts` is
// the sole boot entrypoint (it calls `startServer()` for the `serve` command).
// A self-invoke guard here is harmless in the split dev tree but doubly fatal in
// the published package: the prepack bundler inlines this module INTO the bundled
// `bin/runcastle.js`, so `import.meta.main` here becomes true (it's the bin, the
// real entry) and the guard fires a SECOND `startServer()` — the two race for the
// port and the second dies with Bun's "Failed to start server. Is port … in use?"
// while the first is still up. Dev/start scripts boot through the bin for parity.
