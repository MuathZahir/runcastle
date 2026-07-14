import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Filesystem paths for runcastle's data dir (`~/.runcastle/`). These are the
 * only IO-adjacent bits of core, and they perform no IO themselves — they just
 * compute absolute paths via node:os + node:path (Windows-safe).
 *
 * Repo-relative paths (`featureDocsRel`) intentionally use forward slashes:
 * they are logical git/repo paths, not host filesystem paths.
 */

export function dataDir(): string {
  return join(homedir(), '.runcastle')
}

export function dbPath(): string {
  return join(dataDir(), 'runcastle.db')
}

export function configPath(): string {
  return join(dataDir(), 'config.json')
}

export function envPath(): string {
  return join(dataDir(), '.env')
}

export function logsDir(): string {
  return join(dataDir(), 'logs')
}

/** Launch artifacts for a Claude Code session: `~/.runcastle/sessions/<id>/`. */
export function sessionDir(id: string): string {
  return join(dataDir(), 'sessions', id)
}

/** Talk worktree for a feature: `~/.runcastle/worktrees/<projectId>/<slug>/`. */
export function worktreeDir(projectId: string, slug: string): string {
  return join(dataDir(), 'worktrees', projectId, slug)
}

/** Feature docs location relative to the TARGET repo (forward slashes). */
export function featureDocsRel(slug: string): string {
  return `docs/features/${slug}`
}
