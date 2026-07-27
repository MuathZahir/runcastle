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

/**
 * Windows shim extensions, in launch-cost order: a native `.exe` beats a `.cmd`,
 * which beats a `.ps1` (that one costs a PowerShell startup — see
 * {@link spawnTargetFor}). `.ps1` is here because npm's global shims are a
 * *trio* — `foo`, `foo.cmd`, `foo.ps1` — and `Get-Command foo` reports the
 * `.ps1`, since PowerShell ranks ExternalScript above Application. So a user
 * whose shell clearly resolves the tool can still be missing every extension we
 * used to scan for.
 */
const WIN_EXTS = ['.exe', '.cmd', '.bat', '.ps1', '']

/**
 * The `RUNCASTLE_*_BIN` escape hatch each externally-installed tool honors. This
 * table is the reason it exists as a table and not an inline `process.env` read
 * per call site: `claude` is resolved from three places (the session launcher,
 * the doctor/verify {@link import('../doctor/system-exec').createSystemExec},
 * and the embedded setup terminals), and when only one of them honored the
 * override, pinning the path fixed sessions while onboarding still reported
 * "claude CLI not found". Resolve tools through {@link resolveTool}, never
 * {@link resolveExecutable} directly, so the override applies everywhere.
 */
export const BIN_OVERRIDE_ENV: Readonly<Record<string, string>> = {
  claude: 'RUNCASTLE_CLAUDE_BIN',
  node: 'RUNCASTLE_NODE_BIN',
}

/**
 * {@link resolveExecutable} plus the tool's `RUNCASTLE_*_BIN` override — the
 * entry point every spawn site should use. `env` is injected in tests.
 */
export function resolveTool(
  name: string,
  opts: ResolveExecutableOptions & { env?: NodeJS.ProcessEnv } = {},
): string {
  const env = opts.env ?? process.env
  const overrideKey = BIN_OVERRIDE_ENV[name]
  const override = opts.override ?? (overrideKey ? env[overrideKey] : undefined)
  return resolveExecutable(name, override ? { ...opts, override } : opts)
}

/** What to actually hand a spawn call: the real executable, and its full argv. */
export interface SpawnTarget {
  file: string
  args: string[]
}

/**
 * Turn a resolved path into something `CreateProcess`/ConPTY can actually run.
 *
 * Windows can only exec a real PE image, so both shim kinds need an interpreter:
 * a `.cmd`/`.bat` goes through the command processor, and a `.ps1` — which is
 * just a text file — needs PowerShell with `-File`. `-ExecutionPolicy Bypass` is
 * required rather than optional: the default policy on Windows client SKUs is
 * `Restricted`, which refuses to run npm's `.ps1` shims at all. We are launching
 * a script the user installed and already runs by hand, at a path we resolved
 * ourselves off PATH, so this widens nothing they had not already chosen.
 *
 * This lives here, once, because three call sites (doctor/verify exec, the
 * session launcher, the embedded setup terminals) each had their own copy of the
 * `.cmd`/`.bat` branch — and adding `.ps1` to three copies is how one gets
 * missed.
 */
export function spawnTargetFor(resolved: string, args: string[]): SpawnTarget {
  if (/\.(cmd|bat)$/i.test(resolved)) {
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/c', resolved, ...args] }
  }
  if (/\.ps1$/i.test(resolved)) {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved, ...args],
    }
  }
  return { file: resolved, args }
}

/** {@link resolveTool} + {@link spawnTargetFor}: name and argv → runnable spawn. */
export function resolveSpawnTarget(name: string, args: string[]): SpawnTarget {
  return spawnTargetFor(resolveTool(name), args)
}

/** A bare command name — resolution gave up and never found a real path. */
function isBareName(cmd: string): boolean {
  return !cmd.includes('/') && !cmd.includes('\\')
}

/**
 * Turn a raw spawn failure into something the user can act on.
 *
 * node-pty is the reason this exists: when its own PATH search fails it throws
 * `File not found: ` followed by the *resolved* path — which is the empty string
 * precisely when the search failed. So the one case that needs explaining most
 * arrives with no filename, no cause, and no next step. Every spawn site funnels
 * its failure through here so the terminal says which binary was missing and why
 * a working shell is not evidence that the server can see it.
 */
export function explainSpawnFailure(cmd: string, raw: string): string {
  const detail = raw.trim()
  if (!isBareName(cmd)) {
    return `Could not launch ${cmd}${detail ? ` — ${detail}` : ''}`
  }
  const overrideKey = BIN_OVERRIDE_ENV[cmd]
  const lines = [
    `Could not launch \`${cmd}\`: nothing by that name is on the PATH this runcastle server inherited.`,
    // The trap this message exists to defuse: users check their own shell,
    // find the binary, and conclude runcastle is lying. The server's PATH is a
    // snapshot taken when it started — a newer install is simply not in it.
    `A terminal where \`${cmd}\` works does not prove the server can see it: the server's PATH was captured when it started.`,
    `Fix: quit runcastle and start it again from a terminal where \`${cmd} --version\` works.`,
  ]
  if (overrideKey) {
    lines.push(
      `If that fails, set ${overrideKey} to the full path (\`where.exe ${cmd}\` / \`which ${cmd}\`) and restart.`,
    )
  }
  if (detail) lines.push(`(underlying error: ${detail})`)
  return lines.join('\n')
}

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
