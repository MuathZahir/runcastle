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
