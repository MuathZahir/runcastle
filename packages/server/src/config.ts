import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RuncastleConfig } from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import { dataDir, logsDir } from '@runcastle/core/paths'

/**
 * Server-side config surface. The actual parsing/merging lives in
 * `@runcastle/core` (`loadConfig`, IO-free except its lazy file read); the
 * server re-exports it and owns the one side effect core intentionally does not
 * do: creating the `~/.runcastle/` data directory tree at boot.
 */
export { loadConfig }
export type { RuncastleConfig }

/**
 * Interface `Bun.serve` binds to. Loopback only: runcastle is a local app
 * (CONTEXT decision #2) whose API is unauthenticated — binding `0.0.0.0` (Bun's
 * default) hands the whole LAN filesystem listing, doc reads, settings writes,
 * host git identity and process spawn. LAN serving, if ever wanted, is an
 * explicit opt-in that has to bring auth with it (audit decision #7).
 */
export const SERVE_HOSTNAME = '127.0.0.1'

/**
 * Seconds `Bun.serve` lets a connection sit idle before reaping it. Bun's
 * default is 10s, which kills every SSE stream (`routes/stream.ts`) and idle
 * terminal WebSocket about 13s in — the client reconnects, so it looks like a
 * flaky network rather than a config value. Must stay comfortably above the
 * stream's 25s heartbeat, which is the longest a healthy connection is silent.
 */
export const SERVE_IDLE_TIMEOUT_SECONDS = 120

/**
 * Ensure `~/.runcastle/` and its subdirectories exist so a clean-machine boot
 * has somewhere to put the db, logs, session artifacts and talk worktrees. Safe
 * to call repeatedly (recursive mkdir is a no-op when present).
 */
export function ensureDataDir(): void {
  const root = dataDir()
  mkdirSync(root, { recursive: true })
  mkdirSync(logsDir(), { recursive: true })
  mkdirSync(join(root, 'sessions'), { recursive: true })
  mkdirSync(join(root, 'worktrees'), { recursive: true })
}
