import { readFileSync } from 'node:fs'
import { loadConfig } from '@runcastle/core/config-load'
import { configPath, dbPath } from '@runcastle/core/paths'
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

/**
 * The context whose `config` follows the config file, and the file bytes it was
 * last loaded from. Only boot arms this (see {@link followConfigFile}), so a
 * test's injected context is never overwritten by the real machine's config.
 */
let followed: { ctx: AppCtx; raw: string } | null = null

/** Inject the app context (boot wiring or tests). */
export function setRuntimeCtx(ctx: AppCtx): void {
  current = ctx
}

/** Drop the injected context (test teardown / isolation). */
export function clearRuntimeCtx(): void {
  current = null
  followed = null
}

/**
 * Keep `ctx.config` in step with `config.json` — armed by boot, for the one
 * context loaded FROM that file.
 *
 * The boot config is a snapshot, and `updateSettings` refreshes it only for the
 * writes this process itself served. Every other way the file changes — an
 * operator editing it, another build writing it — leaves the snapshot behind,
 * while the settings surface (`getSettings`) resolves every field from the file
 * on each read. That gap is visible: the roster UI shows a use-case note and the
 * session offered `annotatedModels` from `ctx.config` sees nothing, with nothing
 * short of a restart to reconcile them.
 */
export function followConfigFile(ctx: AppCtx): void {
  followed = { ctx, raw: readConfigFile() }
}

/** The config file's bytes; absent or unreadable is the same as empty. */
function readConfigFile(): string {
  try {
    return readFileSync(configPath(), 'utf8')
  } catch {
    return ''
  }
}

/**
 * Reload the followed context's config when the file's bytes changed. Cheap
 * enough for the per-request path it sits on: one small read, and a parse only
 * when the file actually moved.
 *
 * A file that no longer parses keeps the config already in hand — a config
 * half-written by an editor is not a reason to serve schema defaults — and the
 * bytes are remembered either way, so the next change is still seen.
 */
function syncFollowedConfig(): void {
  if (!followed) return
  const raw = readConfigFile()
  if (raw === followed.raw) return
  followed.raw = raw
  try {
    followed.ctx.config = loadConfig()
  } catch {
    /* keep the last good config */
  }
}

/**
 * Resolve the `AppCtx` for the hooks route + MCP server. Prefers an injected
 * context; otherwise lazily opens the real db (see module doc). Idempotent — the
 * lazily-built context is cached for subsequent requests.
 */
export async function getRuntimeCtx(): Promise<AppCtx> {
  if (current) {
    syncFollowedConfig()
    return current
  }
  // Dynamic import: keeps `bun:sqlite` (via db/client) out of the vitest graph.
  const { createDb } = await import('../db/client')
  const db = createDb(dbPath())
  current = { db, config: loadConfig() }
  return current
}
