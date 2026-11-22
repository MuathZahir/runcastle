import { homedir, tmpdir } from 'node:os'
import { basename } from 'node:path'
import type { EditDenial } from './edit-guard'
import { type PathFlavor, pathApi, samePath, within } from './guard-paths'
import { SHELL_TOOLS } from './install-guard'
import { CD_VERBS, commandsOf, dialectOf, isGit, type ShellDialect, VALUE_OPTIONS } from './lead-guard'

/**
 * The remote guard (`agents-never-stop-for-approval` decisions 8 and 9): a
 * `PreToolUse` check on every host session's shell commands, the orchestrator
 * included. Runcastle answers every permission request itself, so nothing asks
 * the human before a command runs; this refuses the few that must never run
 * unattended, and a refusal is not a stall: the agent reads why and goes on.
 *
 * Refused:
 *
 * - **rewriting or deleting the remote** — `git push` forced (`--force`, `-f`,
 *   `--force-with-lease`, `--force-if-includes`, a `+` refspec), deleting
 *   (`--delete`, `-d`, a `:ref` refspec), `--mirror` or `--prune`; `gh repo
 *   delete|archive|rename`, `gh pr merge`, any `gh … delete`; `gh api` with
 *   method `DELETE`, or a `force=true` field (a forced ref update);
 * - **a recursive delete outside the session's folder** — `rm -r`, `rmdir /s`,
 *   `Remove-Item -Recurse` and its aliases, `find … -delete`, whose target is
 *   outside the working folder, or is that folder or one above it. The temp
 *   folder, and any extra folder the session owns, are inside.
 *
 * Like the lead guard, what it cannot read (a target in a variable, a command
 * built at run time, a path piped into `Remove-Item`) is allowed: a guard must
 * never wedge a session. It reads through `sudo`/`env`-style wrappers and a
 * `bash -c` / `pwsh -Command` script, and reads Windows paths — drive letters,
 * backslashes, Git Bash's `/c/…`, any case — on a Windows host
 * (workers-build-in-the-feature-s-folder decision 11).
 */
export interface RemoteGuardInput {
  /** `tool_name` from the hook payload; only the shell tools are read. */
  toolName?: string
  /** `tool_input.command` from the hook payload. */
  command?: string
  /** The session's working folder: deletes inside it run. */
  worktreePath: string
  /**
   * The folder the shell is in now (the hook's `cwd`). Claude Code's shell keeps
   * a `cd` from an earlier call, so this can differ from `worktreePath`; the
   * session's folder is assumed when it is missing.
   */
  cwd?: string
  /** Other folders the session may delete inside (a feature's scenario data). */
  ownFolders?: string[]
  /** The home folder `~` and `$HOME` stand for; the OS's by default. */
  home?: string
  /** The temp folders deletes may run in; the OS's and `/tmp` by default. */
  tempFolders?: string[]
  /**
   * Runcastle's data folder. It holds other sessions' folders, so a path inside
   * it never counts as temp, even when the data folder itself sits in one.
   */
  dataDir?: string
  /** The path rules to read targets by; the host's by default. */
  platform?: PathFlavor
}

/** Evaluate one tool call; `null` means the guard has no objection. */
export function evaluateRemoteGuard(input: RemoteGuardInput): EditDenial | null {
  if (!input.toolName || !(SHELL_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.command) return null
  const flavor = input.platform ?? (process.platform === 'win32' ? 'win32' : 'posix')
  const { resolve } = pathApi(flavor)
  const ctx: Ctx = {
    flavor,
    root: resolve(input.worktreePath),
    home: input.home ?? homedir(),
    owned: (input.ownFolders ?? []).map((p) => resolve(p)),
    temps: (input.tempFolders ?? [tmpdir(), '/tmp']).map((p) => resolve(p)),
    ...(input.dataDir ? { dataDir: resolve(input.dataDir) } : {}),
  }
  // `${HOME}`'s braces would read as a group to the shell split.
  const start = input.cwd ? resolve(input.cwd) : ctx.root
  const why = evaluateScript(ctx, input.command.replace(/\$\{HOME\}/g, '$HOME'), dialectOf(input.toolName), start, 0)
  return why ? { reason: `${why} ${FOOTER}` } : null
}

const FOOTER =
  'Runcastle refuses this for every agent, since nobody approves commands any more ' +
  '(agents-never-stop-for-approval decisions 8 and 9). Carry on another way; if it truly must happen, ' +
  'tell the human what and why, so they can run it themselves.'

interface Ctx {
  flavor: PathFlavor
  root: string
  home: string
  /** Folders a delete may run inside (not on): the session's own extras. */
  owned: string[]
  /** Temp folders a delete may run inside, except within `dataDir`. */
  temps: string[]
  dataDir?: string
}

/** How deep `bash -c` scripts are read inside one another. */
const MAX_DEPTH = 3

/** The first refused act in a shell script, run from `cwd` (undefined once it is unknowable). */
function evaluateScript(ctx: Ctx, script: string, dialect: ShellDialect, start: string | undefined, depth: number): string | null {
  let cwd = start
  for (const raw of commandsOf(script, dialect)) {
    const words = unwrap(raw)
    const [verb, ...args] = words
    if (!verb) continue
    const name = commandName(verb)
    if (CD_VERBS.has(name)) {
      const target = args.find((a) => !a.startsWith('-'))
      // A bare `cd` goes home; `cd -` goes back to a folder the guard never saw.
      cwd = target === undefined ? (args.includes('-') ? undefined : ctx.home) : at(ctx, cwd, target)
      continue
    }
    const nested = nestedScript(name, args)
    if (nested !== undefined) {
      if (depth >= MAX_DEPTH) continue
      const why = evaluateScript(ctx, nested.script, nested.dialect, cwd, depth + 1)
      if (why) return why
      continue
    }
    const why = isGit(verb) ? evaluateGit(args) : name === 'gh' ? evaluateGh(args) : evaluateDelete(ctx, cwd, name, args)
    if (why) return why
  }
  return null
}

/** `rm`, `Remove-Item`, `rmdir.exe` → lower-case name with no folder or `.exe`. */
export function commandName(verb: string): string {
  return basename(verb.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '')
}

/** Wrappers that run the command after them, and their options that take a value. */
const WRAPPERS: Record<string, Set<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-U', '-r', '-t', '-D']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S']),
  nice: new Set(['-n']),
  nohup: new Set(),
  time: new Set(),
  command: new Set(),
  exec: new Set(),
  builtin: new Set(),
}

/** The command a wrapper runs: `sudo -u x env A=1 rm -rf y` → `rm -rf y`. */
export function unwrap(words: string[]): string[] {
  let rest = words
  for (;;) {
    const first = rest[0]
    const values = first === undefined ? undefined : WRAPPERS[commandName(first)]
    if (!values) return rest
    let i = 1
    while (i < rest.length) {
      const w = rest[i] as string
      if (values.has(w)) i += 2
      else if (w.startsWith('-') || /^[A-Za-z_]\w*=/.test(w)) i += 1
      else break
    }
    rest = rest.slice(i)
  }
}

/**
 * The script a shell is handed to run, and its dialect: `bash -c '…'`,
 * `pwsh -Command '…'`, `cmd /c …`, `eval …` (`iex` in PowerShell).
 */
export function nestedScript(name: string, args: string[]): { script: string; dialect: ShellDialect } | undefined {
  if (name === 'eval') return { script: args.join(' '), dialect: 'bash' }
  if (name === 'iex' || name === 'invoke-expression') {
    const i = args.findIndex((a) => /^-command$/i.test(a))
    return { script: args.slice(i + 1).join(' '), dialect: 'powershell' }
  }
  if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(name)) {
    const i = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
    const script = i < 0 ? undefined : args[i + 1]
    return script === undefined ? undefined : { script, dialect: 'bash' }
  }
  if (name === 'pwsh' || name === 'powershell') {
    const i = args.findIndex((a) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(a))
    return i < 0 ? undefined : { script: args.slice(i + 1).join(' '), dialect: 'powershell' }
  }
  if (name === 'cmd') {
    const i = args.findIndex((a) => /^\/[ck]$/i.test(a))
    return i < 0 ? undefined : { script: args.slice(i + 1).join(' '), dialect: 'bash' }
  }
  return undefined
}

// --- the remote ---------------------------------------------------------------

function evaluateGit(args: string[]): string | null {
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i] as string
    if (!arg.startsWith('-')) break
    if (!arg.includes('=') && VALUE_OPTIONS.has(arg)) i++
  }
  return args[i] === 'push' ? evaluatePush(args.slice(i + 1)) : null
}

function evaluatePush(args: string[]): string | null {
  const flags = args.filter((a) => a.startsWith('-'))
  const short = flags.filter((f) => /^-[a-zA-Z0-9]+$/.test(f)).join('')
  if (flags.includes('--dry-run') || short.includes('n')) return null
  if (flags.some((f) => /^--force(-with-lease|-if-includes)?(=|$)/.test(f)) || short.includes('f')) {
    return 'A force push rewrites the remote.'
  }
  if (flags.includes('--delete') || short.includes('d')) return 'Deleting a branch or tag on the remote is refused.'
  if (flags.includes('--mirror')) return 'A mirror push overwrites and deletes refs on the remote.'
  if (flags.includes('--prune')) return 'A prune push deletes refs on the remote.'
  // The first positional is the remote; the rest are refspecs.
  const refspecs = args.filter((a) => !a.startsWith('-')).slice(1)
  if (refspecs.some((r) => r.startsWith('+'))) return 'A `+` refspec is a force push, which rewrites the remote.'
  if (refspecs.some((r) => r.startsWith(':'))) return 'A `:ref` refspec deletes that ref on the remote.'
  return null
}

/** gh's options that take a value, so their value is not read as a subcommand. */
const GH_VALUE_OPTIONS = new Set(['-R', '--repo', '--hostname'])

function evaluateGh(args: string[]): string | null {
  const words: string[] = []
  for (let i = 0; i < args.length && words.length < 3; i++) {
    const a = args[i] as string
    if (GH_VALUE_OPTIONS.has(a)) i++
    else if (!a.startsWith('-')) words.push(a)
  }
  const [group, sub, third] = words
  if (group === 'api') return evaluateGhApi(args)
  if (group === 'repo' && (sub === 'delete' || sub === 'archive' || sub === 'rename')) {
    return `\`gh repo ${sub}\` changes the repository itself.`
  }
  if (group === 'pr' && sub === 'merge') return 'Merging a pull request is the human\'s call.'
  if ([sub, third].some((w) => w === 'delete' || w?.startsWith('delete-'))) {
    return `\`gh ${group} ${sub === 'delete' || sub?.startsWith('delete-') ? sub : `${sub} ${third}`}\` deletes something on GitHub.`
  }
  return null
}

function evaluateGhApi(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    const method = a === '-X' || a === '--method' ? args[i + 1] : /^(?:-X|--method=)(.+)$/.exec(a)?.[1]
    if (method?.toUpperCase() === 'DELETE') return 'A `DELETE` call to the GitHub API deletes something on GitHub.'
    const field = ['-f', '-F', '--field', '--raw-field'].includes(a) ? args[i + 1] : /^--(?:raw-)?field=(.+)$/.exec(a)?.[1]
    if (field && /^force=true$/i.test(field)) return 'A forced ref update through the GitHub API is a force push.'
  }
  return null
}

// --- recursive deletes --------------------------------------------------------

/** The delete commands, bash and PowerShell (`rm`, `rd`, `del` are PowerShell aliases of `Remove-Item`). */
const DELETERS = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir'])

/** The deleters cmd also spells with `/s`-style switches. */
const CMD_DELETERS = new Set(['rd', 'rmdir', 'del', 'erase'])

/** PowerShell `Remove-Item` options whose value is not a target. */
const PS_VALUE_OPTIONS = /^-(filter|include|exclude|credential|stream|erroraction|ea|warningaction|wa)$/i

function evaluateDelete(ctx: Ctx, cwd: string | undefined, name: string, args: string[]): string | null {
  let targets: string[]
  if (name === 'find') {
    if (!args.includes('-delete')) return null
    const end = args.findIndex((a) => a.startsWith('-') || a === '!')
    targets = args.slice(0, end < 0 ? args.length : end)
    if (targets.length === 0) targets = ['.']
  } else if (DELETERS.has(name)) {
    if (!isRecursive(args)) return null
    targets = []
    let positional = false
    for (let i = 0; i < args.length; i++) {
      const a = args[i] as string
      if (positional || !(a.startsWith('-') || (CMD_DELETERS.has(name) && /^\/[a-z]$/i.test(a)))) targets.push(a)
      else if (a === '--') positional = true
      else if (PS_VALUE_OPTIONS.test(a)) i++
    }
    // PowerShell takes several paths as one comma-separated array: `Remove-Item a,b -Recurse`.
    targets = targets.flatMap((t) => t.split(',')).filter((t) => t !== '')
  } else {
    return null
  }
  for (const target of targets) {
    const path = at(ctx, cwd, target)
    if (path === undefined) continue
    // `find .` deletes what matches inside the folder, never the folder.
    if (samePath(path, ctx.root, ctx.flavor) && name !== 'find') {
      return `A recursive delete of the session's own folder (${path}) is refused.`
    }
    if (within(ctx.root, path, ctx.flavor)) continue
    const inside = (dir: string) => within(dir, path, ctx.flavor) && !samePath(dir, path, ctx.flavor)
    if (ctx.owned.some(inside)) continue
    if (ctx.temps.some(inside) && !(ctx.dataDir && within(ctx.dataDir, path, ctx.flavor))) continue
    return `A recursive delete outside the session's folder (${path}) is refused.`
  }
  return null
}

/** `-r`, `-rf`, `-R`, `--recursive`, PowerShell `-Recurse` (or a prefix of it), cmd's `/s`. */
function isRecursive(args: string[]): boolean {
  return args.some(
    (a) =>
      /^-[rRfivdIP]+$/.test(a) && /[rR]/.test(a) ||
      a === '--recursive' ||
      /^-rec(u(r(s(e)?)?)?)?(:\$true)?$/i.test(a) ||
      /^\/s$/i.test(a),
  )
}

/**
 * Where `target` points from `cwd`, with `~`, `$HOME` and their PowerShell and
 * cmd spellings expanded; undefined when it cannot be read (another variable, a
 * command substitution, a relative path from an unknown folder).
 */
function at(ctx: Ctx, cwd: string | undefined, target: string): string | undefined {
  // A backslash is a separator in the PowerShell and cmd spellings; read it as one everywhere.
  let expanded = target
    .replace(/\\/g, '/')
    .replace(/^~(?=$|\/)/, ctx.home.replace(/\\/g, '/'))
    .replace(/^(\$HOME|\$env:HOME|\$env:USERPROFILE|%USERPROFILE%|%HOMEPATH%)(?=$|\/)/i, ctx.home.replace(/\\/g, '/'))
  if (/[$`%]/.test(expanded)) return undefined
  // Git Bash spells `C:\x` as `/c/x`; a bare `C:` is that drive's root here, not a folder on it.
  if (ctx.flavor === 'win32') expanded = expanded.replace(/^\/([A-Za-z])(\/|$)/, '$1:/').replace(/^([A-Za-z]:)$/, '$1/')
  const { resolve } = pathApi(ctx.flavor)
  const absolute = /^(\/|[A-Za-z]:\/)/.test(expanded)
  if (!absolute && cwd === undefined) return undefined
  return absolute ? resolve(expanded) : resolve(cwd as string, expanded)
}
