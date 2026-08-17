import { createHash } from 'node:crypto'

/**
 * The drive's environment contract: identity in, `.runcastle/drive.env` out.
 *
 * The split this file exists to enforce: the project's own setup script COMPUTES
 * everything a drive needs — ports, database names, redis indexes, compose
 * project names, URLs — and runcastle only INJECTS. There are exactly two things
 * a script cannot do for itself: know which drive it is serving, and set the
 * environment of a sibling process the server spawns (the dev pane). So the
 * server passes the identity in as plain `RUNCASTLE_*` variables, reads back the
 * `KEY=VALUE` file the script wrote, and overlays it verbatim. Nothing here
 * knows what a database or a service is, which is why any stack works.
 *
 * Caveat worth knowing rather than detecting: this sets process environment,
 * which wins over `.env` in dotenv, Prisma and Next by default — but a project
 * that calls `dotenv.config({ override: true })` will ignore it and quietly keep
 * using the shared database. There is no reliable way to detect that from here.
 */

/** Which drive the variables describe. */
export interface DriveIdentity {
  /** The feature slug (`add-billing`). */
  slug: string
  /** The git branch under the wheel (`feature/add-billing`). */
  branch: string
}

/**
 * Conservative cap for {@link identifierSafe}. Postgres truncates identifiers at
 * 63 bytes, and a script normally prefixes the value (`myapp_$RUNCASTLE_ID`) —
 * so this leaves room for one rather than spending the whole budget and silently
 * colliding two long branches at the 63rd byte.
 */
const MAX_ID_LENGTH = 40

/**
 * A slug reduced to something safe to use as a database/schema name: lowercase,
 * `[a-z0-9_]` only, never leading with a digit, and length-capped with a short
 * hash suffix so two truncated-to-identical branches stay distinct.
 */
export function identifierSafe(slug: string, max = MAX_ID_LENGTH): string {
  const cleaned = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const safe = cleaned === '' || /^[0-9]/.test(cleaned) ? `x_${cleaned}` : cleaned
  if (safe.length <= max) return safe
  // Truncation makes collisions possible, so the discriminator is not optional.
  const digest = createHash('sha1').update(slug).digest('hex').slice(0, 6)
  return `${safe.slice(0, max - digest.length - 1)}_${digest}`
}

/**
 * The identity every child process of a drive is handed. Server-passed rather
 * than derived from git inside the script, because the preparation dry run
 * drives under a synthetic slug on whatever branch is already checked out.
 */
export function driveIdentityEnv(identity: DriveIdentity): Record<string, string> {
  return {
    RUNCASTLE_SLUG: identity.slug,
    RUNCASTLE_BRANCH: identity.branch,
    RUNCASTLE_ID: identifierSafe(identity.slug),
  }
}

/**
 * Parse a `KEY=VALUE` env file — the setup script's half of the contract.
 *
 * Lenient about shape (blank lines, `#` comments, surrounding quotes, whitespace
 * around `=`) and strict about nothing, because a rejected line would fail a
 * drive over a stray comment. A line with no `=` or an empty key is dropped:
 * there is no sensible interpretation of it. Values are taken verbatim — the
 * script already computed them, and reinterpreting one here would break the
 * single property the file exists for.
 */
export function parseEnvFile(raw: string | undefined): Record<string, string> {
  const vars: Record<string, string> = {}
  if (!raw?.trim()) return vars

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '')
    if (key === '') continue

    vars[key] = unquote(trimmed.slice(eq + 1).trim())
  }
  return vars
}

/** Strip one layer of matching surrounding quotes, as an env file would. */
function unquote(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  if ((first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1)
  return value
}

/**
 * The environment a drive's child processes run with: everything inherited,
 * with the drive's overrides on top. Ours win — the whole point is to replace a
 * `DATABASE_URL` the shell already exports.
 */
export function driveProcessEnv(
  overrides: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, ...overrides }
}

/** One-line summary of what a drive overlaid, for the timeline. Names only. */
export function describeDriveEnv(keys: string[]): string {
  return `drive environment from .runcastle/drive.env: ${keys.join(', ')}`
}
