import { resolve } from 'node:path'
import type { SessionKind, SessionPurpose } from '@runcastle/core'
import { DRIVE_MACHINERY_WRITABLE, type EditDenial, SCENARIO_WRITABLE } from './edit-guard'
import { SHELL_TOOLS } from './install-guard'
import { CD_VERBS, commandsOf, isGit, VALUE_OPTIONS, within } from './lead-guard'

/**
 * The checkout guard (`small-fixes-before-publish` decisions 1 and 2): a
 * `PreToolUse` check on the shell commands of the three host-side kinds —
 * `prepare`, `drive-fix`, `scenario` — which work in the human's OWN checkout,
 * with their own uncommitted work in it.
 *
 * Those sessions used to prompt on `git commit` and on anything off the
 * pre-allowed list, and the prompt is what kept them from committing or staging
 * the human's work. Every kind now runs without prompts, so a refusal takes the
 * prompt's place; hooks still run under `bypassPermissions`. It refuses:
 *
 * - `git add` of a path outside what the kind may write (`-A`, `--all`, `-u` and
 *   a bare `.` included) — the scenario setup errand is exempt from this alone;
 * - `git commit -a/--all`, a commit naming paths outside that set, or a commit
 *   while anything outside it is staged (the refusal lists them);
 * - the acts that move or discard the human's work: switching branches, `reset`,
 *   `stash`, `clean`, `restore` outside that set, `rebase`, `merge`, `push`,
 *   branch deletion.
 *
 * Anything it cannot read is allowed, like the lead's guard: it must never wedge
 * a session. Pure — the staged paths are probed by the route.
 */

export interface CheckoutGuardInput {
  kind: SessionKind
  purpose?: SessionPurpose
  /** `tool_name` from the hook payload; only the shell tools are read. */
  toolName?: string
  /** `tool_input.command` from the hook payload. */
  command?: string
  /** The session's working directory: the human's checkout. */
  worktreePath: string
  /** `git diff --cached --name-only` in the checkout, as the route probed it. */
  stagedPaths?: readonly string[]
}

/** The kinds this guard applies to. */
export function guardsCheckout(kind: SessionKind): boolean {
  return kind === 'prepare' || kind === 'drive-fix' || kind === 'scenario'
}

/** Does this command line run a `git commit` (so the route knows to probe the index)? */
export function mentionsCommit(command: string): boolean {
  return commandsOf(command).some(([verb, ...args]) => verb !== undefined && isGit(verb) && gitSub(args)?.sub === 'commit')
}

/** The rel paths (dirs end in `/`) a kind may write in the checkout. */
function writableFor(kind: SessionKind): readonly string[] {
  return kind === 'scenario' ? [SCENARIO_WRITABLE] : DRIVE_MACHINERY_WRITABLE
}

function describe(kind: SessionKind): string {
  return writableFor(kind)
    .map((p) => `\`${p}\``)
    .join(' and ')
}

/** Evaluate one tool call; `null` means the guard has no objection. */
export function evaluateCheckoutGuard(input: CheckoutGuardInput): EditDenial | null {
  if (!guardsCheckout(input.kind)) return null
  if (!input.toolName || !(SHELL_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.command) return null
  const root = resolve(input.worktreePath)
  const writable = writableFor(input.kind)
  const isWritable = (dir: string, p: string) => {
    const target = resolve(dir, p)
    return writable.some((rel) => within(resolve(root, rel), target))
  }
  const setupErrand = input.kind === 'scenario' && input.purpose === 'scenario-setup'
  const footer = ` In this session, ${describe(input.kind)} is yours to stage; the rest of the checkout is the human's.`

  const evaluateSub = (name: string, a: string[], dir: string): string | null => {
      switch (name) {
        case 'add': {
          if (setupErrand) return null
          const paths = pathsOf(a, new Set())
          const sweeping = a.some((x) => ['-A', '--all', '-u', '--update'].includes(x))
          if (paths.length === 0) {
            return sweeping
              ? '`git add -A`/`-u` would stage the human\'s own uncommitted work. Name the paths instead.'
              : null
          }
          const outside = paths.filter((p) => !isWritable(dir, p))
          return outside.length > 0
            ? `\`git add\` of ${outside.join(', ')} is refused: it is outside what this session may stage. Stage only paths you wrote.`
            : null
        }
        case 'commit': {
          if (a.some((x) => x === '--all' || (/^-[A-Za-z]+$/.test(x) && shortClusterHasAll(x)))) {
            return '`git commit -a` would commit the human\'s own tracked changes. Stage your own paths and commit without -a.'
          }
          const paths = pathsOf(a, COMMIT_VALUE_OPTIONS)
          const outside = paths.filter((p) => !isWritable(dir, p))
          if (outside.length > 0) {
            return `\`git commit\` naming ${outside.join(', ')} is refused: it is outside what this session may commit.`
          }
          const staged = (input.stagedPaths ?? []).filter((p) => !isWritable(root, p))
          if (staged.length > 0) {
            return (
              `\`git commit\` is refused while paths outside this session's own are staged: ${staged.join(', ')}. ` +
              'Those are the human\'s; leave committing the human\'s own work to them, and do not unstage it.'
            )
          }
          return null
        }
        case 'checkout':
        case 'switch': {
          const dd = a.indexOf('--')
          if (name === 'checkout' && dd >= 0) {
            const outside = a.slice(dd + 1).filter((p) => !isWritable(dir, p))
            return outside.length > 0
              ? `\`git checkout -- ${outside.join(' ')}\` would discard the human's changes there. Restore only paths you wrote.`
              : null
          }
          return a.some((x) => !x.startsWith('-')) || a.some((x) => ['-b', '-B', '-c', '-C', '--orphan', '--detach', '-d'].includes(x))
            ? `\`git ${name}\` of a branch moves the human's checkout. Stay on the branch you are on; to restore a file you wrote use \`git checkout -- <path>\`.`
            : null
        }
        case 'restore': {
          const paths = pathsOf(a, RESTORE_VALUE_OPTIONS)
          const outside = paths.filter((p) => !isWritable(dir, p))
          return paths.length === 0 || outside.length > 0
            ? '`git restore` outside this session\'s own paths would discard the human\'s changes. Name only paths you wrote.'
            : null
        }
        case 'branch':
          return a.some((x) => x === '--delete' || (/^-[A-Za-z]+$/.test(x) && /[dD]/.test(x)))
            ? 'Deleting a branch is refused: the branches in this checkout are the human\'s.'
            : null
        case 'reset':
        case 'stash':
        case 'clean':
        case 'rebase':
        case 'merge':
        case 'push':
          return `\`git ${name}\` moves or discards the human's work, or publishes it. Leave it to them; say in your reply what you would have done.`
        default:
          return null
      }
  }

  let cwd = root
  for (const words of commandsOf(input.command)) {
    const [verb, ...args] = words
    if (!verb) continue
    if (CD_VERBS.has(verb.toLowerCase())) {
      const target = args.find((a) => !a.startsWith('-'))
      if (target !== undefined) cwd = resolve(cwd, target)
      continue
    }
    if (!isGit(verb)) continue
    const parsed = gitSub(args, cwd)
    if (!parsed) continue
    const reason = evaluateSub(parsed.sub, parsed.rest, parsed.dir)
    if (reason) return { reason: reason + footer }
  }
  return null
}

const COMMIT_VALUE_OPTIONS = new Set([
  '-m', '-F', '-C', '-c', '-t', '--message', '--file', '--author', '--date', '--reuse-message',
  '--reedit-message', '--template', '--cleanup', '--fixup', '--squash', '--trailer',
])
const RESTORE_VALUE_OPTIONS = new Set(['-s', '--source'])

/** Does a short-flag cluster (`-am`, `-sa`) carry `a` before any letter that takes a value? */
function shortClusterHasAll(cluster: string): boolean {
  for (const ch of cluster.slice(1)) {
    if (ch === 'a') return true
    if ('mFCct'.includes(ch)) return false
  }
  return false
}

/** The pathspec words in a subcommand's args: non-flags that are not an option's value; all after `--`. */
function pathsOf(args: string[], valueOptions: ReadonlySet<string>): string[] {
  const paths: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === '--') {
      paths.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('-')) {
      if (valueOptions.has(arg)) i++
      continue
    }
    paths.push(arg)
  }
  return paths
}

/** Skip git's global options (tracking `-C`), returning the subcommand, its args and its directory. */
function gitSub(args: string[], cwd = '.'): { sub: string; rest: string[]; dir: string } | null {
  let dir = cwd
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i] as string
    if (!arg.startsWith('-')) break
    const eq = arg.indexOf('=')
    const [name, inline] = eq >= 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined]
    const value = inline ?? (VALUE_OPTIONS.has(name) ? args[++i] : undefined)
    if (name === '-C' && value !== undefined) dir = resolve(dir, value)
  }
  const sub = args[i]
  return sub === undefined ? null : { sub, rest: args.slice(i + 1), dir }
}
