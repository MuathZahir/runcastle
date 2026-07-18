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
  cached = '0.0.0'
  return cached
}
