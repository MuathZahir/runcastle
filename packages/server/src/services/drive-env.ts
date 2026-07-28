import { createHash } from 'node:crypto'

/**
 * Per-drive environment overrides — the generic half of "a database per branch".
 *
 * The split this file exists to enforce: runcastle owns INJECTION, the project
 * owns CLONING. Handing a dev server a different `DATABASE_URL` is identical
 * across every stack, so we do it. Producing the thing that URL points at is
 * `CREATE DATABASE … TEMPLATE` on Postgres, a dump/restore on MySQL, a file copy
 * on SQLite, a branching API on Neon, and nothing at all on a hosted database
 * that will not grant CREATEDB — so that stays a {@link driveSetupCommand}
 * string the project supplies and preparation proposes. We never grow a driver
 * per vendor, and a database we have never heard of works the same as Postgres.
 *
 * Both halves see the same variables, which is what makes them compose: the
 * setup hook creates `myapp_add_billing` and the dev pane connects to it because
 * both rendered `{{id}}` from the same drive.
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
 * 63 bytes, and the rendered value is normally a database name with a prefix
 * (`myapp_{{id}}`) — so this leaves room for one rather than spending the whole
 * budget and silently colliding two long branches at the 63rd byte.
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

/** The `{{...}}` variables a drive exposes to hooks and to the dev pane. */
export function driveVars(identity: DriveIdentity): Record<string, string> {
  return {
    slug: identity.slug,
    branch: identity.branch,
    id: identifierSafe(identity.slug),
  }
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export interface RenderResult {
  value: string
  /** Placeholders that matched nothing — left literal, reported, never guessed. */
  unknown: string[]
}

/** Substitute `{{name}}` from `vars`, leaving unknown placeholders untouched. */
export function renderTemplate(value: string, vars: Record<string, string>): RenderResult {
  const unknown: string[] = []
  const out = value.replace(PLACEHOLDER_RE, (match, name: string) => {
    const replacement = vars[name]
    if (replacement === undefined) {
      if (!unknown.includes(name)) unknown.push(name)
      return match
    }
    return replacement
  })
  return { value: out, unknown }
}

export interface DriveEnv {
  /** Variables to overlay on the inherited environment. */
  vars: Record<string, string>
  /** Unknown `{{placeholders}}` across every line, for one warning event. */
  unknown: string[]
}

/**
 * Parse the project's `driveEnv` — one `KEY=VALUE` per line — rendering drive
 * variables into each value.
 *
 * Lenient about shape (blank lines, `#` comments, surrounding quotes, whitespace
 * around `=`) and strict about nothing, because this is a settings textarea and
 * a rejected line would fail a drive over a stray comment. A line with no `=`
 * or an empty key is dropped: there is no sensible interpretation of it.
 */
export function parseDriveEnv(
  raw: string | undefined,
  identity: DriveIdentity,
): DriveEnv {
  const vars: Record<string, string> = {}
  const unknown: string[] = []
  if (!raw?.trim()) return { vars, unknown }

  const substitutions = driveVars(identity)
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '')
    if (key === '') continue

    const rendered = renderTemplate(unquote(trimmed.slice(eq + 1).trim()), substitutions)
    vars[key] = rendered.value
    for (const name of rendered.unknown) if (!unknown.includes(name)) unknown.push(name)
  }
  return { vars, unknown }
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

/** One-line summary of what a drive overrode, for the timeline. */
export function describeDriveEnv(vars: Record<string, string>): string {
  const keys = Object.keys(vars)
  return `drive environment: ${keys.join(', ')}`
}
