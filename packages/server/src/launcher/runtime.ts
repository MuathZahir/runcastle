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
 * - **Boot** injects the single boot handle: `index.ts#buildApp` calls
 *   `setRuntimeCtx({ db, config })`, so the hooks/MCP sub-apps and the tRPC app
 *   share ONE `bun:sqlite` connection (the second-connection era in
 *   docs/research/CORRECTIONS.md C2 is over).
 *
 * The lazy fallback below survives only for the degenerate case of a hook/MCP
 * request arriving before any injection (no `buildApp`, no test setup): it opens
 * the real `~/.runcastle/runcastle.db` via a dynamic import so vitest's node
 * runtime — which cannot load `bun:sqlite` — never touches it (the injected path
 * returns first).
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
  const [{ createDb }, { dbPath }, { loadConfig }] = await Promise.all([
    import('../db/client'),
    import('@runcastle/core/paths'),
    import('@runcastle/core/config-load'),
  ])
  const db = createDb(dbPath())
  current = { db, config: loadConfig() }
  return current
}
