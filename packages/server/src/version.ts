import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The running server version, read once from this package's `package.json`
 * (issue #51). When published as `runcastle` this is the installed version; in
 * the contributor checkout it's the workspace version. Used by the update check
 * to compare against npm's `latest` dist-tag. Uses `node:fs` (not a JSON import)
 * so it resolves identically under Bun, Vite, and the vitest/node suite.
 */
let cached: string | undefined

/**
 * What {@link runcastleVersion} reports when no manifest was readable — "we do
 * not know what is installed", not "version zero". Callers that compare versions
 * must treat it as unknown: comparing against it makes every published release
 * look newer, which is how a brand-new install got told it was out of date
 * (findings F7).
 */
export const UNKNOWN_VERSION = '0.0.0'

export function runcastleVersion(): string {
  if (cached) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  // Source layout: this file is `src/version.ts`, so the manifest is one up.
  // Bundled layout: the entry sits at the package root or under `bin/`, so try
  // the package dir itself too. First readable manifest wins.
  for (const pkgPath of [join(here, '..', 'package.json'), join(here, 'package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
      if (typeof pkg.version === 'string') {
        cached = pkg.version
        return cached
      }
    } catch {
      // try the next candidate
    }
  }
  cached = UNKNOWN_VERSION
  return cached
}
