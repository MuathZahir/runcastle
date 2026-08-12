/**
 * Update check (issue #51, workstream G). On boot the server asks for the
 * `latest` published version of `runcastle` and compares it to the running one.
 * When latest is newer the UI shows a dismissible banner naming the exact update
 * command — runcastle *notifies*, it never auto-installs.
 *
 * The same request is runcastle's usage signal: it goes to runcastle's own
 * endpoint carrying an anonymous install ID, so a boot counts as one active
 * install. That makes it a three-rung ladder, because the banner must survive
 * the ping failing:
 *
 *   1. `DO_NOT_TRACK` set  → skip the ping, ask npm directly.
 *   2. otherwise           → POST the ping, which answers `{ latest }`.
 *   3. ping failed         → one attempt at npm; then a silent "no update".
 *
 * IO-thin on purpose: `fetch` and the environment are injected so every rung is
 * unit-tested offline, and every failure path (offline, 5xx, garbage JSON)
 * degrades to "no update" so a stranger with no network still boots cleanly.
 */

import { UNKNOWN_VERSION } from '../version'
import { getInstallId } from './install-id'

/** Public package name + the command a user runs to update it. */
export const PACKAGE_NAME = 'runcastle'
export const UPDATE_COMMAND = `bun add -g ${PACKAGE_NAME}@latest`

/** runcastle's own endpoint: counts the install, answers with `latest`. */
export const PING_URL = 'https://ping.runcastle.dev/ping'

/** The fallback rung — npm's `latest` dist-tag, the pre-ping code path. */
const NPM_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`

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
 * The community `DO_NOT_TRACK` convention: any non-empty value other than `0`
 * opts out. Read from the passed environment at CALL time, never captured at
 * module load, so setting it before boot is always enough.
 */
function doNotTrack(env: Record<string, string | undefined>): boolean {
  const raw = env.DO_NOT_TRACK
  return raw !== undefined && raw !== '' && raw !== '0'
}

/** npm's `latest` dist-tag, or null on any failure. */
async function latestFromNpm(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(NPM_LATEST_URL)
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    return typeof body.version === 'string' ? body.version : null
  } catch {
    return null
  }
}

/**
 * Count this install and read back `latest`, or null on any failure. The body is
 * the entire usage signal — a random install ID, the running version, the OS
 * platform, and nothing else (documented in the README).
 */
async function latestFromPing(fetchImpl: typeof fetch, current: string): Promise<string | null> {
  try {
    const res = await fetchImpl(PING_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installId: getInstallId(),
        version: current,
        platform: process.platform,
      }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { latest?: unknown }
    return typeof body.latest === 'string' ? body.latest : null
  } catch {
    return null
  }
}

/**
 * Walk the ping → npm → silence ladder and decide whether an update is
 * available. Any failure resolves to a "no update" result — this must never
 * throw, so a boot-time call can't wedge the server on a flaky network.
 */
export async function checkForUpdate(opts: {
  current: string
  fetchImpl?: typeof fetch
  /** Environment to read `DO_NOT_TRACK` from (default `process.env`). */
  env?: Record<string, string | undefined>
}): Promise<UpdateInfo> {
  const { current } = opts
  const fetchImpl = opts.fetchImpl ?? fetch
  const env = opts.env ?? process.env
  // An unknown running version cannot be compared: every published release
  // outranks it, so the honest answer is "no update" rather than telling a
  // brand-new install it is on 0.0.0 and out of date (findings F7). No request
  // is made at all — there is nothing to ask about.
  if (current === UNKNOWN_VERSION) return NO_UPDATE(current)

  const latest = doNotTrack(env)
    ? await latestFromNpm(fetchImpl)
    : ((await latestFromPing(fetchImpl, current)) ?? (await latestFromNpm(fetchImpl)))
  if (!latest) return NO_UPDATE(current)

  return {
    current,
    latest,
    updateAvailable: compareSemver(latest, current) > 0,
    command: UPDATE_COMMAND,
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
