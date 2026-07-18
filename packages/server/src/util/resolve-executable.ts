import { existsSync } from 'node:fs'
import { win32, posix } from 'node:path'

/**
 * PATHEXT-aware executable resolution — the single home for the PATH scan the
 * launcher, the PTY node sidecar, and the doctor probes all share.
 *
 * Why this exists: `spawn("docker")` can ENOENT on Windows even though `docker`
 * works in a terminal, because a non-shell spawn does NOT apply `PATHEXT` — a
 * `.cmd`/`.bat` shim is invisible unless we name the extension. So we hand-scan
 * PATH ourselves, trying each Windows extension in turn (native `.exe` first),
 * exactly as `resolveClaudeExecutable`/`resolveNodeExecutable` used to inline
 * (docs/research/PREREQS-NOTES.md §8). Any code that spawns a possibly-shimmed
 * binary must route through here, never `spawn(name)` directly.
 */
export interface ResolveExecutableOptions {
  /** An explicit path that wins if it exists (e.g. `RUNCASTLE_CLAUDE_BIN`). */
  override?: string
  /** Platform to resolve for; defaults to the host. Injected in tests. */
  platform?: NodeJS.Platform
  /** PATH string to scan; defaults to `process.env.PATH`. Injected in tests. */
  pathEnv?: string
  /** Extensions to try; defaults to the platform's shim set. */
  exts?: string[]
  /** Existence predicate; defaults to `fs.existsSync`. Injected in tests. */
  exists?: (path: string) => boolean
}

/** Windows shim extensions, native binary first so `.exe` beats a `.cmd`. */
const WIN_EXTS = ['.exe', '.cmd', '.bat', '']

/**
 * Resolve `name` to an absolute executable path. Returns the bare `name`
 * unchanged when nothing is found so the caller's `spawn` can make a final
 * attempt (and surface a real ENOENT) rather than us inventing a bad path.
 */
export function resolveExecutable(name: string, opts: ResolveExecutableOptions = {}): string {
  const exists = opts.exists ?? existsSync
  if (opts.override && exists(opts.override)) return opts.override

  const isWin = (opts.platform ?? process.platform) === 'win32'
  const exts = opts.exts ?? (isWin ? WIN_EXTS : [''])
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? ''
  const dirs = pathEnv.split(isWin ? ';' : ':')
  // Join with the TARGET platform's separator, not the host's, so resolution is
  // testable cross-platform (a linux CI can exercise the Windows path).
  const join = isWin ? win32.join : posix.join

  for (const dir of dirs) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`)
      if (exists(candidate)) return candidate
    }
  }
  return name
}
