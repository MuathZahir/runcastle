import { isAbsolute, join, relative, sep } from 'node:path'
import { LOCAL_BUILD_PRERELEASE, compareSemver } from '../services/update-check'

/**
 * Pure helpers for the local-build installer (`scripts/install-local.ts` →
 * `bun run install:local`).
 *
 * They live under `src/dev/` for the same reason as the dev tool's argv parse
 * (`./args.ts`): typechecked with the server and unit-testable, where the script
 * itself builds, packs, and installs globally. Nothing in `src/dev/` is reachable
 * from the published entrypoints, so none of this ships to an install.
 */

/** What `bun run install:local [ref] [flags]` was asked to do. */
export interface InstallLocalOptions {
  /** The git ref to snapshot and build (default `main`). */
  ref: string
  /** `false` under `--no-install`: link the checkout's installed dependencies instead of `bun install`. */
  install: boolean
  /** `--check`: run typecheck + tests in the snapshot before packing. */
  check: boolean
  /** `--skip-running-check`: install even if something listens on the configured `serverPort`. */
  skipRunningCheck: boolean
}

/** A usage error: the script prints it with the usage line and exits 1. */
export class InstallLocalUsageError extends Error {}

export const INSTALL_LOCAL_USAGE = 'usage: bun run install:local [ref] [--no-install] [--check] [--skip-running-check]'

const FLAGS = new Set(['--no-install', '--check', '--skip-running-check'])

export function parseInstallLocalArgs(argv: string[]): InstallLocalOptions {
  const unknown = argv.filter((a) => a.startsWith('-') && !FLAGS.has(a))
  if (unknown.length > 0) throw new InstallLocalUsageError(`unknown flag: ${unknown.join(', ')}`)
  const refs = argv.filter((a) => !a.startsWith('-'))
  if (refs.length > 1) throw new InstallLocalUsageError(`expected at most one ref, got: ${refs.join(' ')}`)
  return {
    ref: refs[0] ?? 'main',
    install: !argv.includes('--no-install'),
    check: argv.includes('--check'),
    skipRunningCheck: argv.includes('--skip-running-check'),
  }
}

/**
 * Where a `--no-install` snapshot's copy of one of the checkout's dependency
 * links should point, given the link's resolved target. A workspace package
 * (inside the checkout, outside every `node_modules`) is rebased onto the
 * snapshot so the build compiles the ref's sources, not the checkout's; any
 * other target (an installed package) is reused where it is.
 */
export function snapshotLinkTarget(target: string, checkout: string, snapshot: string): string {
  const rel = relative(checkout, target)
  const insideCheckout = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  if (!insideCheckout || rel.split(sep).includes('node_modules')) return target
  return join(snapshot, rel)
}

/**
 * bun's global manifest: `$BUN_INSTALL_GLOBAL_DIR/package.json`, else
 * `$BUN_INSTALL/install/global/package.json`, `BUN_INSTALL` defaulting to `~/.bun`.
 */
export function bunGlobalManifestPath(env: Record<string, string | undefined>, home: string): string {
  const globalDir = env.BUN_INSTALL_GLOBAL_DIR || join(env.BUN_INSTALL || join(home, '.bun'), 'install', 'global')
  return join(globalDir, 'package.json')
}

/**
 * The spec the global manifest installs `runcastle` from (`^1.4.1`, a tarball
 * path, …), or null when it is not installed or the manifest is unreadable.
 *
 * `bun add -g <tarball>` over an existing `runcastle` entry, registry spec or
 * another tarball alike, fails with `DependencyLoop` (and can leave the key
 * duplicated), so the installer removes the entry first and restores this spec
 * if the add then fails.
 */
export function globalRuncastleSpec(manifestText: string | null): string | null {
  if (manifestText === null) return null
  try {
    const manifest = JSON.parse(manifestText) as { dependencies?: Record<string, unknown> }
    const spec = manifest.dependencies?.runcastle
    return typeof spec === 'string' && spec !== '' ? spec : null
  } catch {
    return null
  }
}

const RELEASE_TAG =/^v\d+\.\d+\.\d+(-[\w.]+)?$/

/**
 * The version a local build is stamped with: `<latest v* tag without v>-local.<short sha>`
 * (e.g. `1.4.1-local.ebc6eaab`), so `runcastle --version` and the doctor show it
 * is not a published build. Falls back to `0.0.0` when no release tag exists.
 */
export function localBuildVersion(tags: string[], shortSha: string): string {
  const latest = tags
    .filter((t) => RELEASE_TAG.test(t))
    .map((t) => t.slice(1))
    .reduce<string | null>((best, v) => (best === null || compareSemver(v, best) > 0 ? v : best), null)
  return `${latest ?? '0.0.0'}-${LOCAL_BUILD_PRERELEASE}.${shortSha}`
}
