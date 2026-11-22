import { posix, win32 } from 'node:path'

/**
 * The path rules the pre-tool guards read paths by (workers-build-in-the-feature-s-folder
 * decision 11): Windows' — drive letters, either slash, any case — or POSIX. The host's
 * by default; a test passes `win32` to check the Windows forms on every platform.
 */
export type PathFlavor = 'win32' | 'posix'

/** The flavor of the machine runcastle runs on. */
export function hostFlavor(): PathFlavor {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

/** `node:path`'s functions for a flavor. */
export function pathApi(flavor: PathFlavor = hostFlavor()): typeof posix {
  return flavor === 'win32' ? win32 : posix
}

/** A path made absolute and, on Windows, folded to one case for comparing. */
function folded(p: string, flavor: PathFlavor): string {
  const abs = pathApi(flavor).resolve(p)
  return flavor === 'win32' ? abs.toLowerCase() : abs
}

/** Is `target` inside `dir`, or `dir` itself? Case-insensitive on Windows. */
export function within(dir: string, target: string, flavor: PathFlavor = hostFlavor()): boolean {
  const api = pathApi(flavor)
  const rel = api.relative(folded(dir, flavor), folded(target, flavor))
  return rel === '' || (!rel.startsWith('..') && !api.isAbsolute(rel))
}

/** Are `a` and `b` the same folder? Case-insensitive on Windows. */
export function samePath(a: string, b: string, flavor: PathFlavor = hostFlavor()): boolean {
  return folded(a, flavor) === folded(b, flavor)
}
