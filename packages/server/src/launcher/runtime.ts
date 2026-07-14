import type { AppCtx } from '../db/types'

/**
 * Runtime `AppCtx` holder for the two sub-apps that `index.ts` mounts WITHOUT a
 * DI context — the hooks receiver (`/api/hooks`) and the MCP server (`/mcp`).
 *
 * `index.ts` (owned by A1) mounts them as bare default-exported Hono apps
 * (`app.route('/api/hooks', hooksApp)`) so no `AppCtx` is threaded in the way it
 * is for tRPC (`createContext: () => ctx`). B1 must not edit `index.ts`, so:
 *
 * - **Tests** call `setRuntimeCtx(testCtx)` before hitting `app.fetch`, so the
 *   sub-apps use the same in-memory sql.js db the test seeded.
 * - **Boot** never injects, so the first hook/MCP request lazily opens the real
 *   `~/.runcastle/runcastle.db` (a second WAL connection to the same file the
 *   tRPC app uses). WAL keeps cross-connection reads coherent, so a ticket the
 *   MCP tool writes is visible to the polling UI's connection. The `bun:sqlite`
 *   client is pulled in via a dynamic import so vitest's node runtime — which
 *   cannot load `bun:sqlite` — never touches it (the injected path returns
 *   first).
 *
 * NOTE for a future integrator: if `index.ts#buildApp` ever calls
 * `setRuntimeCtx({ db, config })`, the lazy second connection disappears and the
 * whole app shares one handle. Recorded in docs/research/CORRECTIONS.md.
 */

let current: AppCtx | null = null

/** Inject the app context (boot wiring or tests). */
export function setRuntimeCtx(ctx: AppCtx): void {
  current = ctx
}

/** Drop the injected context (test teardown / isolation). */
export function clearRuntimeCtx(): void {
  current = null
}

/**
 * Resolve the `AppCtx` for the hooks route + MCP server. Prefers an injected
 * context; otherwise lazily opens the real db (see module doc). Idempotent — the
 * lazily-built context is cached for subsequent requests.
 */
export async function getRuntimeCtx(): Promise<AppCtx> {
  if (current) return current
  // Dynamic import: keeps `bun:sqlite` (via db/client) out of the vitest graph.
  const [{ createDb }, core] = await Promise.all([
    import('../db/client'),
    import('@runcastle/core'),
  ])
  const db = createDb(core.dbPath())
  current = { db, config: core.loadConfig() }
  return current
}
