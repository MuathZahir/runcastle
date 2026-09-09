import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTool } from '../../src/util/resolve-executable'

/**
 * A `bun` executable to spawn a fixture with, or `null` if none can be found.
 *
 * The suite itself runs under node (see `helpers/db.ts`), so any test that needs
 * the production runtime — Bun's `bun:sqlite`, its process tree, its HTTP server
 * — has to spawn a real bun child. Resolution order is `BUN_INSTALL` first (how
 * bun's own installer records where it put itself, and the one hint that
 * survives a PATH the test runner did not inherit), then a PATH scan.
 */
export function resolveBun(): string | null {
  const isWin = process.platform === 'win32'
  const bunInstall = process.env.BUN_INSTALL
  if (bunInstall) {
    const candidate = join(bunInstall, 'bin', isWin ? 'bun.exe' : 'bun')
    if (existsSync(candidate)) return candidate
  }
  // resolveTool hands back the bare name when it found nothing real.
  const resolved = resolveTool('bun', { exts: isWin ? ['.exe', ''] : [''] })
  return resolved === 'bun' ? null : resolved
}
