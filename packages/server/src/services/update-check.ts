/**
 * Update check (issue #51, workstream G). On boot the server asks npm for the
 * `latest` dist-tag of the published `runcastle` package and compares it to the
 * running version. When latest is newer the UI shows a dismissible banner naming
 * the exact update command — runcastle *notifies*, it never auto-installs.
 *
 * IO-thin on purpose: `fetch` is injected so the version compare + banner wiring
 * are unit-tested offline, and every failure path (offline, 404, garbage JSON)
 * degrades to "no update" so a stranger with no network still boots cleanly.
 */

/** Public package name + the command a user runs to update it. */
export const PACKAGE_NAME = 'runcastle'
export const UPDATE_COMMAND = `bun add -g ${PACKAGE_NAME}@latest`

export interface UpdateInfo {
  /** The running server's version. */
  current: string
  /** npm's `latest` dist-tag, or null if the registry couldn't be reached. */
  latest: string | null
  /** True iff a strictly-newer version is published. */
  updateAvailable: boolean
  /** The exact command to run — surfaced verbatim in the banner. */
  command: string
}

/** Split a semver into numeric release parts + dot-separated prerelease ids. */
function parse(version: string): { release: number[]; pre: string[] } {
  const cleaned = version.trim().replace(/^v/, '')
  const [core = '', pre = ''] = cleaned.split('-', 2)
  const release = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
  return { release, pre: pre ? pre.split('.') : [] }
}

/**
 * Semver compare: negative if `a < b`, positive if `a > b`, 0 if equal.
 * Numeric release parts compare numerically (so 0.2 < 0.10), and a prerelease
 * ranks below its release (1.0.0-beta < 1.0.0), matching the semver spec's
 * precedence rules closely enough for an "is there a newer stable?" check.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.release.length, pb.release.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa.release[i] ?? 0) - (pb.release[i] ?? 0)
    if (diff !== 0) return diff
  }
  // Equal release: no prerelease outranks any prerelease.
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1
  const preLen = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < preLen; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = Number(x)
    const ny = Number(y)
    const bothNumeric = !Number.isNaN(nx) && !Number.isNaN(ny)
    const cmp = bothNumeric ? nx - ny : x < y ? -1 : x > y ? 1 : 0
    if (cmp !== 0) return cmp
  }
  return 0
}

const NO_UPDATE = (current: string): UpdateInfo => ({
  current,
  latest: null,
  updateAvailable: false,
  command: UPDATE_COMMAND,
})

/**
 * Fetch npm's `latest` version and decide whether an update is available.
 * Any failure resolves to a "no update" result — this must never throw, so a
 * boot-time call can't wedge the server on a flaky network.
 */
export async function checkForUpdate(opts: {
  current: string
  fetchImpl?: typeof fetch
}): Promise<UpdateInfo> {
  const { current } = opts
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`)
    if (!res.ok) return NO_UPDATE(current)
    const body = (await res.json()) as { version?: unknown }
    const latest = typeof body.version === 'string' ? body.version : null
    if (!latest) return NO_UPDATE(current)
    return {
      current,
      latest,
      updateAvailable: compareSemver(latest, current) > 0,
      command: UPDATE_COMMAND,
    }
  } catch {
    return NO_UPDATE(current)
  }
}

// One real answer per server process: the banner query is fetched on page load,
// so a per-process cache keeps repeated loads/tabs from hammering the registry.
// A failed check isn't cached, so a transient outage re-checks on the next load.
let cache: UpdateInfo | undefined

/** Memoized {@link checkForUpdate} for the boot/router path. */
export async function getUpdateInfo(current: string, fetchImpl?: typeof fetch): Promise<UpdateInfo> {
  if (cache) return cache
  const info = await checkForUpdate({ current, fetchImpl })
  if (info.latest !== null) cache = info
  return info
}

/** Test hook — drop the memoized result between cases. */
export function resetUpdateCache(): void {
  cache = undefined
}
