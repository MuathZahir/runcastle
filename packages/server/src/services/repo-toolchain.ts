import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pure `.env` parsing and the repo-toolchain probe: what the doctor and the
 * worker sandbox setup need to know about a project's JS toolchain.
 */

/**
 * Parse `KEY=VALUE` lines into a record. Ignores blank lines and `#` comments,
 * tolerates a leading `export `, and strips one layer of matching surrounding
 * quotes from the value. First occurrence of `=` splits key from value.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = body.indexOf('=')
    if (eq === -1) continue
    const key = body.slice(0, eq).trim()
    if (key.length === 0) continue
    let value = body.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export const PACKAGE_MANAGERS = ['bun', 'pnpm', 'yarn', 'npm'] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

/** What the target repo's root reveals about its JS toolchain. */
export interface RepoToolchain {
  hasPackageJson: boolean
  /** `packageManager` field from package.json (corepack pin), e.g. `"pnpm@9.6.0"`. */
  packageManagerField?: string
  /** Which lockfiles exist at the repo root. */
  lockfiles: { bun: boolean; pnpm: boolean; yarn: boolean; npm: boolean }
}

/**
 * Pick the repo's package manager: the `packageManager` field wins (it is the
 * corepack pin — authoritative even when stray lockfiles exist), then lockfile
 * presence (bun → pnpm → yarn → npm), then npm as the neutral default for a
 * repo with a package.json but no other marker. `undefined` for non-JS repos.
 */
export function detectPackageManager(tc: RepoToolchain): PackageManager | undefined {
  const pinned = tc.packageManagerField?.split('@')[0]
  if (pinned && (PACKAGE_MANAGERS as readonly string[]).includes(pinned)) {
    return pinned as PackageManager
  }
  if (tc.lockfiles.bun) return 'bun'
  if (tc.lockfiles.pnpm) return 'pnpm'
  if (tc.lockfiles.yarn) return 'yarn'
  if (tc.lockfiles.npm) return 'npm'
  return tc.hasPackageJson ? 'npm' : undefined
}

/** Inspect the target repo root for its JS toolchain markers (IO). */
export function readRepoToolchain(repoPath: string): RepoToolchain {
  const pkgPath = join(repoPath, 'package.json')
  const hasPackageJson = existsSync(pkgPath)
  let packageManagerField: string | undefined
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { packageManager?: unknown }
      if (typeof pkg.packageManager === 'string') packageManagerField = pkg.packageManager
    } catch {
      // Unreadable package.json — fall back to lockfile detection alone.
    }
  }
  return {
    hasPackageJson,
    ...(packageManagerField !== undefined ? { packageManagerField } : {}),
    lockfiles: {
      bun: existsSync(join(repoPath, 'bun.lock')) || existsSync(join(repoPath, 'bun.lockb')),
      pnpm: existsSync(join(repoPath, 'pnpm-lock.yaml')),
      yarn: existsSync(join(repoPath, 'yarn.lock')),
      npm: existsSync(join(repoPath, 'package-lock.json')),
    },
  }
}
