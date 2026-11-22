import { trpcServer } from '@hono/trpc-server'
import { REVIEWS_BASE, type SessionRow } from '@runcastle/core'
import { dataDir, dbPath } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import {
  SERVE_HOSTNAME,
  SERVE_IDLE_TIMEOUT_SECONDS,
  ensureDataDir,
  loadConfig,
} from './config'
import { createDb } from './db/client'
import { runMigrations } from './db/migrate'
import { recountAllSessions } from './services/usage'
import type { AppCtx } from './db/types'
import { reconcileStaleSessions, wakeCutOffChats } from './launcher/reconcile'
import { holdUpgradeNotes } from './services/upgrade-note'
import { upgradeAutopilotFeatures } from './services/autopilot-upgrade'
import { runEpicNamingPassOnce } from './threads/epic-naming-pass'
import { followConfigFile, setRuntimeCtx } from './launcher/runtime'
import mcpApp from './mcp/server'
import { ptyRegistry } from './pty/registry'
import { terminalWebSocket, tryUpgradeTerminal } from './pty/ws'
import { serveDesignPass } from './routes/design-pass'
import hooksApp from './routes/hooks'
import reviewsApp from './routes/reviews'
import streamApp from './routes/stream'
import threadsApp from './routes/threads'
import designsApp from './routes/designs'
import { mountWebAppIfBuilt } from './routes/web'
import { detachCopyOnce, isDatabaseCopy } from './services/database-copy'
import { designServerStatus } from './services/design'
import { sweepFeatureWorktrees } from './services/feature-worktrees'
import { onDriveEnded, recoverCutOffDrives } from './services/git'
import { handBackDriveWorkers, handBackOrphanedDriveWorkers } from './workers/drive'
import { startModelDiscovery } from './services/model-discovery'
import { startNeedPush } from './services/need-push'
import { startNeedWatch } from './services/need-watch'
import { startQuietWatch } from './services/quiet-watch'
import { startOrchestratorNotifier } from './services/orchestrator-notify'
import { getUpdateInfo } from './services/update-check'
import { createShutdown } from './shutdown'
import { serverUrlFor } from './launcher/artifacts'
import { sweepLeftoverAgents } from './services/leftover-agents'
import { agentHost } from './threads/types'
import { resumeCaughtWorkers, resumeDriveReviewWaits, workerPreviews } from './workers/service'
import { startHourlySweep, sweepLeftovers } from './workers/sweep'
import { startContainerLeftovers } from './workers/container-leftovers'
import { appRouter } from './trpc/router'
import { runcastleVersion } from './version'
import { freezeStaleRuns } from './services/runs'

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

  // A long thread's log is megabytes of JSON, and the app may be read over a tunnel.
  // First, so it wraps the reply the rest of the chain makes. Never the live stream.
  app.use('/api/trpc/*', compress({ encoding: 'gzip', threshold: 16 * 1024 }))

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
  // Thread media (routes/threads.ts) — images sent with a thread's prompts.
  app.route('/api/threads', threadsApp)
  // Design pictures (routes/designs.ts) — the copies `show_design` keeps for the cards.
  app.route('/api/designs', designsApp)
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

  // A test drive boots on a copy of the live database, whose conversation ids,
  // running rounds and phone subscriptions all still point at the live install.
  // Cut them loose before anything below reconciles or wakes them
  // (drives-never-touch-real-conversations decision 1).
  const detached = detachCopyOnce(ctx, dbPath())
  if (detached) {
    console.log(
      `detached a copied database: ${detached.conversations} conversation(s), ${detached.runs} running run(s), ` +
        `${detached.tickets} burning ticket(s), ${detached.pushSubscriptions} phone subscription(s)`,
    )
  }

  const app = buildApp(ctx)

  // This context's config came from `~/.runcastle/config.json`, so let it follow
  // that file: a change made outside this process — hand-edited, or written by
  // another build — reaches sessions and launches without a restart, instead of
  // showing up in the settings UI (which re-reads the file) and nowhere else.
  followConfigFile(ctx)

  // Boot reconciliation: sessions left `launching`/`live` by a previous server
  // process are dead by definition (the PTY registry is in-memory) — end them
  // so the live-session guard recovers. Sessions with a PTY still alive in the registry (`bun --hot` reload) are skipped.
  const cutOffChats: SessionRow[] = []
  const reconciled = reconcileStaleSessions(ctx, cutOffChats)
  if (reconciled.length > 0) {
    console.log(`reconciled ${reconciled.length} stale session(s) from a previous server run`)
  }

  // Same recovery for run rows: a crashed server leaves them `running`, which
  // would wedge the branch-claiming launcher guard forever.
  const staleRuns = await freezeStaleRuns(ctx)
  if (staleRuns > 0) {
    console.log(`closed ${staleRuns} run(s) the previous server left running`)
  }

  // A drive the restart cut off comes back into its project's slot, so it is
  // named wherever it blocks and one Stop runs its stop script and returns the
  // checkout home. After both reconciliations: a review drive's round is dead by now.
  // On a copied database every recorded drive is the live install's, never this
  // server's leftover (decision 4).
  const cutOff = isDatabaseCopy() ? [] : await recoverCutOffDrives(ctx)
  if (cutOff.length > 0) {
    console.log(`recovered ${cutOff.length} drive(s) cut off by the restart — stop them to tidy up`)
  }

  // The one-time honest recount of every conversation's tokens
  // (honest-token-counts decision 4). Self-marking, so later boots find nothing
  // to do; not awaited, and it yields between conversations.
  void recountAllSessions(ctx)
    .then((r) => {
      if (r.recounted + r.collapsed > 0) {
        console.log(`token recount: ${r.recounted} conversation(s) recounted, ${r.collapsed} with no transcript left collapsed`)
      }
    })
    .catch(() => {})

  // Talk worktrees of shipped/archived features and of projects that are gone
  // (a full checkout each). After both reconciliations, so nothing still marked
  // live holds one; not awaited, so a slow disk never delays the listener.
  void sweepFeatureWorktrees(ctx).then((s) => {
    if (s.removed + s.orphanProjects + s.failed > 0) {
      console.log(
        `worktree sweep: removed ${s.removed} feature worktree(s) and ` +
          `${s.orphanProjects} orphaned project dir(s); kept ${s.kept} dirty, ${s.failed} failed`,
      )
    }
  })

  // The leftover sweep (runcastle-cleans-up-after-itself decision 6): whatever
  // this install owns on the host and no longer needs is removed; then once an
  // hour. A copied database's workers and projects are the live install's,
  // never this server's to sweep.
  let stopHourlySweep = (): void => {}
  if (!isDatabaseCopy()) {
    void sweepLeftovers(ctx).then((s) => {
      if (s.removed + s.failed > 0) console.log(`leftover sweep: removed ${s.removed} leftover(s), ${s.failed} failed`)
    })
    stopHourlySweep = startHourlySweep(ctx)
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

  // Agent processes an earlier run of this server never stopped are ended once
  // (stopping-a-session-kills-its-process decisions 5, 6). After the listen: only
  // one server holds the port, so anything still marked with its URL is a dead
  // run's. Not awaited; the server's own agents are its descendants and skipped.
  void sweepLeftoverAgents({ serverUrl: serverUrlFor(config), dataDir: dataDir(), selfPid: process.pid }).then(({ found, ended }) => {
    if (found === 0) return
    const survived = found - ended
    console.log(`leftover agents: ended ${ended} process(es) an earlier server run left running${survived ? `; ${survived} survived its stop` : ''}`)
  })

  // The phone's way to a feature's design server (routes/design-pass.ts), on its
  // own port so project code never shares runcastle's API origin.
  const designPass = serveDesignPass(
    config,
    (featureId) => {
      try {
        const status = designServerStatus(ctx, featureId)
        return status.running ? status.url : undefined
      } catch {
        return undefined
      }
    },
    // A worker's preview, by worker id (interactive-workers decision 15).
    workerPreviews(ctx),
  )

  // Provider failures are represented per source in the persisted snapshot;
  // an unforeseen service-level rejection is logged, never allowed to delay boot.
  startModelDiscovery(ctx)

  // Tell a feature's epic when the feature merges or a dependent of it could
  // not start (`autopilot-retires` decisions 2, 9).
  startOrchestratorNotifier(ctx)

  // Say when a feature starts needing the human: pings hang off this one event
  // (you-always-know-what-s-waiting decision 14). Seeded now, without emitting.
  startNeedWatch(ctx)
  // …and push each of those the human is pinged for to their phone (decision 12).
  startNeedPush(ctx)
  // …and say once when a project has features open, nothing running and nothing waiting on the human
  // (runcastle-says-when-nothing-is-running). A copied database's chats are the live install's, never this server's to flag.
  const quietWatch = isDatabaseCopy() ? undefined : startQuietWatch(ctx)

  // Chats and workers a restart cut off mid-turn carry on, now that the server listens for the woken agent (agents-are-woken-only-when-it-matters decision 24).
  // Then a worker it caught before its turn began gets its message again (a-worker-never-shows-working-with-nothing-running decision 9).
  // The upgrade step (sandboxes-are-removed decisions 3, 4) runs once per install: a worker still in a container is closed
  // before anything could wake it, then what the containers left is removed or named. Never on a copied database.
  const leftoversClosed = isDatabaseCopy() ? Promise.resolve() : startContainerLeftovers(ctx).closed
  void leftoversClosed
    .then(() => wakeCutOffChats(ctx, cutOffChats))
    .catch((err) => console.error('could not wake the chats a restart cut off', err))
    .then(() => resumeCaughtWorkers(ctx, new Set(cutOffChats.map((row) => row.id))))
    .catch((err) => console.error('could not resume the workers a restart caught before their turn', err))
  // …and every chat the usage limit holds gets its wake again, kept on its row (a-usage-limit-never-strands-work decision 5),
  // once the upgrade step has closed any worker still in a container. A copied database's chats are the live install's, never this server's to wake.
  if (!isDatabaseCopy()) {
    void leftoversClosed
      .then(() => agentHost(ctx).rearmLimitWakes())
      .catch((err) => console.error('could not arm the usage-limit wakes again', err))
  }
  // …a drive's workers are handed back when it stops; a restart already stopped every drive, so any left at work are handed back now.
  onDriveEnded((ended) => handBackDriveWorkers(ctx, ended))
  if (!isDatabaseCopy()) {
    void handBackOrphanedDriveWorkers(ctx).catch((err) => console.error('could not hand back the drive workers a restart cut off', err))
  }
  // …and each drive review left queued for the drive slot waits for it again: its re-ask died with the last server.
  // A copied database's reviews are the live install's, never this server's to start.
  if (!isDatabaseCopy()) {
    void resumeDriveReviewWaits(ctx, new Set(cutOffChats.map((row) => row.id))).catch((err) =>
      console.error('could not arm the drive reviews’ waits again', err),
    )
  }
  // …and each lead of a feature with unfinished tickets gets one held note, riding its next message (decision 20).
  void holdUpgradeNotes(ctx).catch((err) => console.error('could not hold the ticket upgrade notes', err))
  // Once per feature, the open features of epics that were on autopilot move off it (autopilot-retires
  // decision 13): "Everything" becomes "Result only", a question asked of the epic goes back to the lead's chat.
  // A copied database's features are the live install's.
  if (!isDatabaseCopy()) {
    void upgradeAutopilotFeatures(ctx).catch((err) => console.error('could not move the autopilot features off autopilot', err))
  }
  // Once per install, the orchestrator chats listed now get epic names (orchestrator-chats-become-epics
  // decision 13). Not awaited: one short model run per chat. A copied database's chats are the live install's.
  if (!isDatabaseCopy()) {
    void runEpicNamingPassOnce(ctx)
      .then((r) => {
        if (r.ran && r.named + r.skipped > 0) console.log(`epic naming pass: named ${r.named} chat(s), skipped ${r.skipped}`)
      })
      .catch((err) => console.error('epic naming pass failed', err))
  }

  // Check for a newer release here, at boot, rather than lazily on the first UI
  // page load: a server booted without anyone opening the app never checked at
  // all, and "booted a server" is the honest definition of an active install.
  // Fire-and-forget — the result is memoized for the banner's tRPC query, and
  // the `catch` keeps even an unforeseen rejection off the boot path. Whether it
  // also counts the install (the usage ping) is the `usageSignal` setting's.
  void getUpdateInfo(runcastleVersion(), { usageSignal: config.usageSignal }).catch(() => {})

  // Kill every live PTY on shutdown so no orphaned claude processes survive.
  // Registered once even across `bun --hot` reloads (which re-run `main`) to
  // avoid piling up signal listeners.
  const SHUTDOWN_KEY = Symbol.for('runcastle.shutdown.wired')
  const g = globalThis as typeof globalThis & { [SHUTDOWN_KEY]?: boolean }
  if (!g[SHUTDOWN_KEY]) {
    g[SHUTDOWN_KEY] = true
    const shutdown = createShutdown({
      // The PTYs, and every thread's ACP adapter process (ADR-0015).
      killAllTrees: async () => {
        // Threads stopping for shutdown are not a stop of the work: the quiet watch looks away first.
        quietWatch?.stop()
        stopHourlySweep()
        await Promise.all([ptyRegistry().killAllTrees(), agentHost(ctx).stopAll('shutdown')])
      },
      stop: () => {
        void designPass?.stop()
        return server.stop()
      },
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
