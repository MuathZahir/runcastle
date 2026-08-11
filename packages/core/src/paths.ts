import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Filesystem paths for runcastle's data dir (`~/.runcastle/`). These are the
 * only IO-adjacent bits of core, and they perform no IO themselves — they just
 * compute absolute paths via node:os + node:path (Windows-safe).
 *
 * Repo-relative paths (`featureDocsRel`) intentionally use forward slashes:
 * they are logical git/repo paths, not host filesystem paths.
 *
 * Everything below derives from {@link dataDir}, so redirecting that one
 * function relocates the db, config, env file, logs, session artifacts, talk
 * worktrees and caches together — which is exactly what `bun run dev` does to
 * keep a contributor's experiments off their real install (see
 * {@link devDataDir}). Every path is computed lazily inside its function (never
 * captured at module load), so setting the env var before the first *call* is
 * enough — module import order does not matter.
 */

/** Data dir a published `runcastle` install owns: `~/.runcastle/`. */
export function prodDataDir(): string {
  return join(homedir(), '.runcastle')
}

/**
 * Data dir `bun run dev` runs against: `~/.runcastle-dev/`. A separate tree —
 * own db, own config, own `.env`, own worktrees — so wiping projects or forcing
 * phases while testing can never touch the real install. `RUNCASTLE_DEV_DATA_DIR`
 * overrides the location (the dev tooling still refuses to point it at
 * {@link prodDataDir}).
 */
export function devDataDir(): string {
  const override = process.env.RUNCASTLE_DEV_DATA_DIR
  return override ? resolve(override) : join(homedir(), '.runcastle-dev')
}

/**
 * The active data dir. `RUNCASTLE_DATA_DIR` wins when set — `scripts/dev.ts`
 * sets it to {@link devDataDir} for the dev server; the published bin never
 * sets it, so a real install always lands on {@link prodDataDir}.
 */
export function dataDir(): string {
  const override = process.env.RUNCASTLE_DATA_DIR
  return override ? resolve(override) : prodDataDir()
}

/**
 * Compare two data-dir paths for identity, folding the case- and
 * slash-insensitivity Windows has and POSIX does not. Used by the dev tooling's
 * "never touch the real install" guard, where a false negative would be
 * destructive.
 */
export function sameDataDir(a: string, b: string): boolean {
  const canon = (p: string): string => {
    const abs = resolve(p).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? abs.toLowerCase().replace(/\//g, '\\') : abs
  }
  return canon(a) === canon(b)
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

/**
 * The anonymous install ID the boot update-check sends: `<dataDir>/install-id`.
 * Deliberately its own plain-text file rather than a `config.json` key — it is
 * not a setting, and it must survive a config reset. Deriving from
 * {@link dataDir} means a dev checkout counts separately from a real install.
 */
export function installIdPath(): string {
  return join(dataDir(), 'install-id')
}

export function logsDir(): string {
  return join(dataDir(), 'logs')
}

/** Launch artifacts for a Claude Code session: `~/.runcastle/sessions/<id>/`. */
export function sessionDir(id: string): string {
  return join(dataDir(), 'sessions', id)
}

/** Every talk worktree of one project: `~/.runcastle/worktrees/<projectId>/`. */
export function projectWorktreesDir(projectId: string): string {
  return join(dataDir(), 'worktrees', projectId)
}

/** Talk worktree for a feature: `~/.runcastle/worktrees/<projectId>/<slug>/`. */
export function worktreeDir(projectId: string, slug: string): string {
  return join(projectWorktreesDir(projectId), slug)
}

/**
 * The slug the project session's worktree occupies inside
 * {@link projectWorktreesDir} — it is not a feature, so it needs a name no
 * feature can take. Verified safe: feature slugs come from `slugify`, which
 * lowercases, collapses every non-alphanumeric run to a single `-` and trims
 * leading/trailing `-`, so a slug can never begin with an underscore (or
 * contain one at all).
 */
export const PROJECT_WORKTREE_SLUG = '__project'

/**
 * Shared package-manager cache for burner sandboxes:
 * `~/.runcastle/cache/<pm>`. Bind-mounted into every ticket's container at the
 * manager's cache/store path so per-ticket dependency installs after the first
 * are mostly cache hits instead of full downloads.
 */
export function burnCacheDir(pm: string): string {
  return join(dataDir(), 'cache', pm)
}

/**
 * Runcastle-owned build context for the generic AFK burner image
 * (`~/.runcastle/sandbox-build/`). The Enable-AFK card scaffolds a vetted
 * `.sandcastle/` here on demand and runs `sandcastle <runtime> build-image` in
 * it — so a fresh install can build the image without a hand-made config and
 * before any project exists (issue #50).
 */
export function sandboxBuildDir(): string {
  return join(dataDir(), 'sandbox-build')
}

/** Feature docs location relative to the TARGET repo (forward slashes). */
export function featureDocsRel(slug: string): string {
  return `docs/features/${slug}`
}
