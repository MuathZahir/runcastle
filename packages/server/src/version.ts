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
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
  cached = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  return cached
}
