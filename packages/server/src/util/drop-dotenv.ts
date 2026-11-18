import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_ENV_FILE } from './bun-launch'

/**
 * Makes this process's environment look as if Bun had been started with
 * `--no-env-file` (sessions-never-pick-up-a-project-s-api-key, decision 3).
 *
 * The `runcastle` bin is a `#!/usr/bin/env bun` script, so when it starts in a
 * folder with a `.env` Bun has already loaded that file into `process.env`, and
 * every child the server starts would inherit it — an `ANTHROPIC_API_KEY` there
 * bills the project's key instead of the human's subscription. A shebang flag
 * does not cover `bun runcastle.js`, the service file or Bun's Windows shim, so
 * the bin's first import runs this instead.
 *
 * Only keys named in a `.env` file Bun could have read from the start folder
 * are ever touched, and a variable the shell exported stays (decision 1):
 * - Linux: `/proc/self/environ` is the environment the process started with,
 *   before Bun's loading; a candidate missing from it came from a file. Exact.
 * - Elsewhere: Bun lets the shell win a conflict, so a candidate whose value
 *   equals a file's value came from the file. A `$` value is expanded the way
 *   Bun does it before comparing.
 *
 * Which files Bun read depends on `NODE_ENV` as the shell set it, which a `.env`
 * may since have overwritten, so every mode's files are candidates.
 */

/** The `.env` files Bun 1.4 reads from its start folder in one mode, lowest precedence first. */
export function dotenvFiles(nodeEnv: string | undefined): string[] {
  const mode = nodeEnv && nodeEnv.length > 0 ? nodeEnv : 'development'
  return mode === 'test' ? ['.env', `.env.${mode}`] : ['.env', `.env.${mode}`, '.env.local', `.env.${mode}.local`]
}

/** Every `.env` file Bun could have read, whatever `NODE_ENV` was when it started. */
export function candidateDotenvFiles(nodeEnvs: readonly (string | undefined)[]): string[] {
  const modes = new Set<string | undefined>(['development', 'production', 'test', ...nodeEnvs])
  return [...new Set([...modes].flatMap((mode) => dotenvFiles(mode)))]
}

export interface DotenvEntry {
  value: string
  /** The value holds a `$`, which Bun expands in every quote style. */
  expands: boolean
}

const LINE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*=[ \t]*("(?:\\.|[^"\\])*"|'[^']*'|`[^`]*`|[^\r\n]*)/gm

/** The keys and values in one `.env` text, close to Bun's own reading of it. */
export function parseDotenv(text: string): Map<string, DotenvEntry> {
  const out = new Map<string, DotenvEntry>()
  for (const m of text.matchAll(LINE)) {
    const key = m[1] as string
    const raw = m[2] ?? ''
    const quote = raw[0]
    let value: string
    if ((quote === '"' || quote === "'" || quote === '`') && raw.length >= 2 && raw.endsWith(quote)) {
      value = raw.slice(1, -1)
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1')
    } else {
      value = raw.replace(/[ \t]+#.*$/, '').trim()
    }
    out.set(key, { value, expands: value.includes('$') })
  }
  return out
}

/** `\$`, `${NAME:-default}`, `${NAME}` (also `${}`) and `$NAME`: the forms Bun 1.4 expands. */
const REF = /\\\$|\$\{([A-Za-z_]\w*|)(?::-([^}]*))?\}|\$(\w+)/g

/**
 * A `$` value as Bun 1.4 expands it against `env` (checked against Bun 1.4.4):
 * `\$` is a dollar, `$NAME` and `${NAME}` are the variable or empty,
 * `${NAME:-default}` falls back when it is unset or empty, and any other `$`
 * stays as written.
 */
export function expandDotenv(value: string, env: Record<string, string | undefined>): string {
  return value.replace(REF, (m: string, braced?: string, fallback?: string, bare?: string) => {
    if (m === '\\$') return '$'
    const name = braced ?? bare ?? ''
    const set = env[name]
    if (fallback !== undefined) return set ? set : fallback
    return set ?? ''
  })
}

/** Parses NUL-separated `KEY=value` records, as `/proc/<pid>/environ` holds them. */
export function parseEnviron(text: string): Set<string> {
  const keys = new Set<string>()
  for (const rec of text.split('\0')) {
    const eq = rec.indexOf('=')
    if (eq > 0) keys.add(rec.slice(0, eq))
  }
  return keys
}

export interface DropDotenvDeps {
  env: Record<string, string | undefined>
  cwd: string
  execArgv: readonly string[]
  /** The start-time environment's keys, where the platform has them (Linux); else `null`. */
  startKeys: () => Set<string> | null
  readFile: (path: string) => string | null
}

/** Deletes from `deps.env` what Bun loaded from `.env` files; returns the names it removed. */
export function dropDotenvVars(deps: DropDotenvDeps): string[] {
  if (deps.execArgv.includes(NO_ENV_FILE)) return []
  const fromFiles = new Map<string, DotenvEntry[]>()
  for (const name of candidateDotenvFiles([deps.env.NODE_ENV])) {
    const text = deps.readFile(join(deps.cwd, name))
    if (text === null) continue
    for (const [k, v] of parseDotenv(text)) fromFiles.set(k, [...(fromFiles.get(k) ?? []), v])
  }
  if (fromFiles.size === 0) return []
  const startKeys = deps.startKeys()
  // Expansion reads the environment as Bun left it, before anything is removed.
  const loaded = { ...deps.env }
  const removed: string[] = []
  for (const [key, entries] of fromFiles) {
    const now = loaded[key]
    if (now === undefined) continue
    const fromFile = startKeys
      ? !startKeys.has(key)
      : entries.some((e) => now === (e.expands ? expandDotenv(e.value, loaded) : e.value))
    if (fromFile) {
      delete deps.env[key]
      removed.push(key)
    }
  }
  return removed
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The real process: drop what Bun loaded and say which names went (never values). */
export function dropDotenvFromProcess(): string[] {
  if (process.versions.bun === undefined) return []
  const removed = dropDotenvVars({
    env: process.env,
    cwd: process.cwd(),
    execArgv: process.execArgv,
    startKeys: () => {
      if (process.platform !== 'linux') return null
      const text = readOrNull('/proc/self/environ')
      return text === null ? null : parseEnviron(text)
    },
    readFile: readOrNull,
  })
  if (removed.length > 0) {
    console.error(
      `runcastle: ignoring ${removed.length} variable(s) Bun loaded from a .env file in ${process.cwd()}: ${removed.join(', ')}. ` +
        'Export them in your shell if runcastle should see them.',
    )
  }
  return removed
}
