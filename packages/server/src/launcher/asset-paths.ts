import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Runtime-asset resolution (issue #51, workstream G). A published `runcastle`
 * ships several things as *real files* that the server reads or spawns by path —
 * the drizzle migrations, the hook client (run by a separate `bun`), the PTY
 * sidecar host (run by system `node`), the skills pack, and the built SPA. In a
 * contributor checkout these live at their workspace source paths; in an
 * installed tarball they are vendored beside the bin and named by env var.
 *
 * One pattern, both layouts (SPEC / issue #51 decision point 3): each asset has
 * an env override that *wins when set and fails loudly if wrong*, and otherwise
 * falls back to the workspace path the caller passes. The bin points the env
 * vars at the vendored copies via {@link applyInstalledAssetEnv}; nothing else
 * hand-concatenates a new relative path.
 */

/** The env vars naming each vendored asset in a published install. */
export const ASSET_ENV = {
  /** Dir of `*.sql` drizzle migrations (read by `runMigrations`). */
  migrations: 'RUNCASTLE_MIGRATIONS_DIR',
  /** The `hook-client.ts` script, spawned by `bun` inside each session. */
  hookClient: 'RUNCASTLE_HOOK_CLIENT',
  /** The `pty-host.cjs` sidecar, spawned by system `node`. */
  ptyHost: 'RUNCASTLE_PTY_HOST',
  /** The `@runcastle/skills` root (has `packs/` + `burner/`). */
  skills: 'RUNCASTLE_SKILLS_DIR',
  /** The built web SPA (`apps/web/dist`). */
  webDist: 'RUNCASTLE_WEB_DIST',
} as const

/**
 * Resolve a runtime asset. `envVar` wins when set — validated so a bad override
 * throws here rather than failing later at launch — otherwise `fallback` (the
 * workspace source path) is returned untouched.
 */
export function resolveAsset(envVar: string, fallback: string): string {
  const override = process.env[envVar]
  if (override) {
    const abs = resolve(override)
    if (existsSync(abs)) return abs
    throw new Error(`${envVar}=${override} does not exist (resolved ${abs})`)
  }
  return fallback
}

/**
 * The vendored layout under a published package root: where each asset lands
 * relative to the package dir (the parent of `bin/`). Kept next to the copy list
 * the build script writes so the two never drift.
 */
export function vendoredAssetPaths(pkgRoot: string): Record<string, string> {
  return {
    [ASSET_ENV.skills]: join(pkgRoot, 'skills'),
    [ASSET_ENV.webDist]: join(pkgRoot, 'web'),
    [ASSET_ENV.migrations]: join(pkgRoot, 'drizzle'),
    [ASSET_ENV.hookClient]: join(pkgRoot, 'hook-client.ts'),
    [ASSET_ENV.ptyHost]: join(pkgRoot, 'pty-host.cjs'),
  }
}

/**
 * Point the asset env vars at the copies vendored under `pkgRoot`, but only for
 * assets that actually exist there and only when the var is unset. Called by the
 * bin at boot: in an installed tarball every asset is present so all vars get
 * set; in a contributor checkout (bin run from `src/bin/`) none exist beside the
 * bin, so nothing is set and the workspace fallbacks stay in effect.
 */
export function applyInstalledAssetEnv(pkgRoot: string): void {
  for (const [envVar, path] of Object.entries(vendoredAssetPaths(pkgRoot))) {
    if (process.env[envVar] === undefined && existsSync(path)) process.env[envVar] = path
  }
}
