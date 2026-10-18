import { isAbsolute, relative, resolve } from 'node:path'
import type { EditDenial } from './edit-guard'
import { blankHeredocBodies, SHELL_TOOLS } from './install-guard'

/**
 * The feature lead's line guard (`the-feature-lead-runs-rounds` decision 27): a
 * `PreToolUse` check on a feature chat's shell commands that holds the human's
 * lines whatever the permission mode. After Go the lead runs with no permission
 * prompts — `bypassPermissions`, or the pre-tool hook answering `allow` — so
 * this is the only thing between "the lead can run any command" and "Merge
 * stays the human's click". Hooks run under bypass too, so a deny here holds.
 *
 * Three acts are refused, and only these:
 *
 * - **writing the base branch** — pushing to it (a refspec naming it, `--all`,
 *   `--mirror`), fetching into it, moving it (`branch -f`, `update-ref`), or
 *   checking it out, which is how a merge into it starts;
 * - **git on another checkout** — any git command whose directory (the cwd,
 *   after `cd`/`Set-Location`, or `-C`/`--git-dir`/`--work-tree`) is the
 *   project's main checkout or another feature's worktree;
 * - **deleting the feature branch** — `branch -d/-D`, `push --delete`, a
 *   `:branch` refspec, `update-ref -d`.
 *
 * Everything else is allowed, including what the guard cannot read (a path in a
 * variable, an unknown wrapper): rules for the lead are judgement (decision 6),
 * and a guard must never wedge a session. The parse is a light shell split —
 * separators (`&&`, `||`, `;`, `|`, `&`, newlines, parentheses) outside quotes,
 * quotes removed, heredoc bodies dropped — which reads bash and PowerShell
 * alike, since sessions run on Windows too.
 */

export interface LeadGuardInput {
  /** `tool_name` from the hook payload; only the shell tools are read. */
  toolName?: string
  /** `tool_input.command` from the hook payload. */
  command?: string
  /** The session's working directory: the lead's own worktree. */
  worktreePath: string
  /** The project's main checkout (`project.repoPath`). */
  mainCheckout: string
  /** The dir every worktree of the project lives in; any but the lead's own is off limits. */
  worktreesDir: string
  /** The feature's branch (`feature/<slug>`). */
  featureBranch: string
  /** The branch the feature merges into; unset on a draft, when only the deletion rule applies. */
  baseBranch?: string
}

/** Evaluate one tool call; `null` means the guard has no objection. */
export function evaluateLeadGuard(input: LeadGuardInput): EditDenial | null {
  if (!input.toolName || !(SHELL_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.command) return null
  let cwd = resolve(input.worktreePath)
  for (const words of commandsOf(input.command)) {
    const [verb, ...args] = words
    if (!verb) continue
    if (CD_VERBS.has(verb.toLowerCase())) {
      const target = args.find((a) => !a.startsWith('-'))
      if (target !== undefined) cwd = resolve(cwd, target)
      continue
    }
    if (!isGit(verb)) continue
    const denial = evaluateGit(input, cwd, args)
    if (denial) return { reason: `${denial} ${GUARD_FOOTER}` }
  }
  return null
}

const GUARD_FOOTER =
  'This line is the human\'s (decision 27): Merge stays the human\'s click, and other checkouts ' +
  'belong to other sessions. Work on the feature branch in your own worktree; if you need this ' +
  'done, call wait_for_you and ask the human.'

/** The directory-changing verbs whose first non-flag argument becomes the cwd. */
const CD_VERBS = new Set(['cd', 'pushd', 'set-location', 'sl', 'chdir'])

/** `git`, `git.exe`, or a path to either (`& "C:\Program Files\Git\cmd\git.exe"`). */
function isGit(word: string): boolean {
  const base = word.split(/[\\/]/).pop()?.toLowerCase()
  return base === 'git' || base === 'git.exe'
}

/** Git's global options that take a value as the next word. */
const VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'])

function evaluateGit(input: LeadGuardInput, cwd: string, args: string[]): string | null {
  let dir = cwd
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i] as string
    if (!arg.startsWith('-')) break
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const value = inline ?? (VALUE_OPTIONS.has(name) ? args[++i] : undefined)
    if (value === undefined) continue
    if (name === '-C') dir = resolve(dir, value)
    else if (name === '--git-dir' || name === '--work-tree') {
      const elsewhere = foreignCheckout(input, resolve(dir, value))
      if (elsewhere) return elsewhere
    }
  }
  const elsewhere = foreignCheckout(input, dir)
  if (elsewhere) return elsewhere

  const sub = args[i]
  const rest = args.slice(i + 1)
  switch (sub) {
    case 'push':
      return evaluatePush(input, rest)
    case 'branch':
      return evaluateBranch(input, rest)
    case 'fetch':
      return refspecsOf(rest.filter((a) => !a.startsWith('-')).slice(1)).some((r) => r.dst !== undefined && isBase(input, r.dst))
        ? `Fetching into \`${input.baseBranch}\` moves the base branch.`
        : null
    case 'update-ref':
      return evaluateUpdateRef(input, rest)
    case 'checkout':
    case 'switch':
      return checksOutBase(input, rest)
        ? `Checking out \`${input.baseBranch}\` is how a merge into the base branch starts.`
        : null
    default:
      return null
  }
}

/** Why `dir` is off limits — the main checkout or another worktree — or null for the lead's own. */
function foreignCheckout(input: LeadGuardInput, dir: string): string | null {
  if (within(input.worktreePath, dir)) return null
  if (within(input.mainCheckout, dir)) {
    return `Git on the project's main checkout (${input.mainCheckout}) is refused.`
  }
  if (within(input.worktreesDir, dir)) return `Git on another feature's worktree (${dir}) is refused.`
  return null
}

function evaluatePush(input: LeadGuardInput, args: string[]): string | null {
  const flags = args.filter((a) => a.startsWith('-'))
  if (flags.some((f) => f === '--all' || f === '--mirror' || f === '--branches')) {
    return 'Pushing every branch pushes the base branch too.'
  }
  const deleting = flags.some((f) => f === '--delete' || f === '-d')
  // The first positional is the remote; the rest are refspecs.
  const refspecs = refspecsOf(args.filter((a) => !a.startsWith('-')).slice(1))
  for (const r of refspecs) {
    const target = r.dst ?? r.src
    if (isBase(input, target)) return `Pushing to \`${input.baseBranch}\` is merging without the human.`
    if ((deleting || r.src === '') && isBranch(input.featureBranch, target)) {
      return `Deleting \`${input.featureBranch}\` on the remote is refused.`
    }
  }
  return null
}

function evaluateBranch(input: LeadGuardInput, args: string[]): string | null {
  const flags = args.filter((a) => a.startsWith('-'))
  const names = args.filter((a) => !a.startsWith('-'))
  const deleting = flags.some((f) => f === '--delete' || /^-[a-zA-Z]*[dD]/.test(f))
  if (deleting && names.some((n) => isBranch(input.featureBranch, n))) {
    return `Deleting the feature branch \`${input.featureBranch}\` is refused.`
  }
  const moving = flags.some((f) => f === '--force' || f === '--move' || f === '--copy' || /^-[a-zA-Z]*[fmMcC]/.test(f))
  if (moving && names.some((n) => isBase(input, n))) {
    return `Moving or overwriting \`${input.baseBranch}\` is merging without the human.`
  }
  return null
}

function evaluateUpdateRef(input: LeadGuardInput, args: string[]): string | null {
  const ref = args.find((a) => !a.startsWith('-'))
  if (ref === undefined) return null
  if (isBase(input, ref)) return `Moving \`${input.baseBranch}\` is merging without the human.`
  if (args.includes('-d') && isBranch(input.featureBranch, ref)) {
    return `Deleting the feature branch \`${input.featureBranch}\` is refused.`
  }
  return null
}

/** `checkout <base>` / `switch <base>` — but not `checkout <base> -- <path>`, which restores files. */
function checksOutBase(input: LeadGuardInput, args: string[]): boolean {
  if (args.includes('--')) return false
  return args.some((a) => !a.startsWith('-') && isBase(input, a))
}

interface Refspec {
  src: string
  dst?: string
}

function refspecsOf(words: string[]): Refspec[] {
  return words.map((w) => {
    const spec = w.replace(/^\+/, '')
    const colon = spec.indexOf(':')
    return colon < 0 ? { src: spec } : { src: spec.slice(0, colon), dst: spec.slice(colon + 1) }
  })
}

function isBase(input: LeadGuardInput, ref: string): boolean {
  return input.baseBranch !== undefined && isBranch(input.baseBranch, ref)
}

/** `ref` names `branch`: bare, or as `refs/heads/<branch>`. */
function isBranch(branch: string, ref: string): boolean {
  return ref === branch || ref === `refs/heads/${branch}`
}

/** Is `target` inside `dir`, or `dir` itself? Case-insensitive on Windows. */
function within(dir: string, target: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
  const rel = relative(fold(dir), fold(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The simple commands in a shell line, each as its words: split on separators
 * outside quotes, quotes removed, heredoc bodies dropped, leading `VAR=value`
 * assignments and PowerShell's `&` call operator skipped.
 */
export function commandsOf(command: string): string[][] {
  // `2>&1` / `&>` redirect; their `&` is not PowerShell's call operator or a separator.
  const text = blankHeredocBodies(command).replace(/\d*>&\d*|&>/g, ' ')
  const commands: string[][] = []
  let words: string[] = []
  let word: string | null = null
  const endWord = () => {
    if (word !== null) words.push(word)
    word = null
  }
  const endCommand = () => {
    endWord()
    const start = words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w))
    if (start >= 0) commands.push(words.slice(start))
    words = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1)
      const end = close < 0 ? text.length : close
      word = (word ?? '') + text.slice(i + 1, end)
      i = end
    } else if (ch === ';' || ch === '&' || ch === '|' || ch === '\n' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
      endCommand()
    } else if (/\s/.test(ch)) {
      endWord()
    } else {
      word = (word ?? '') + ch
    }
  }
  endCommand()
  return commands
}
