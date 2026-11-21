import { gitSub } from './checkout-guard'
import type { EditDenial, HostWorker } from './edit-guard'
import { SHELL_TOOLS } from './install-guard'
import { commandsOf, dialectOf, isGit, type ShellDialect } from './lead-guard'
import { commandName, nestedScript, unwrap } from './remote-guard'

/**
 * The worker git guard (workers-build-in-the-feature-s-folder decision 10): a
 * `PreToolUse` check on a host worker's shell commands. A building worker works
 * in the feature's folder, which it shares with the lead, or in its own git
 * worktree whose branch the lead merges back; a gates review works in the
 * feature's folder and changes nothing. Every git folder of a repository shares
 * its branches and its stash, so a worker is refused the git that would reach
 * past its own work:
 *
 * - **pushing** — any `git push`, and `git pull`: the lead publishes the branch
 *   and keeps it in step with the remote;
 * - **rewriting history** — `reset --hard`/`--soft`/`--keep`/`--merge`, a
 *   `reset` to an earlier commit (`HEAD~1`, `ORIG_HEAD`, a hash), `rebase`,
 *   `commit --amend`, `filter-branch`, `filter-repo`; plain `reset`,
 *   `reset <file>` and `reset HEAD` (unstaging) stay allowed;
 * - **branches** — deleting, renaming or force-moving one (`branch
 *   -d/-D/-m/-M/-f/-C`), any `update-ref`;
 * - **switching branch** — `checkout <branch>`, `checkout -b`, `switch`;
 *   `checkout -- <path>` and `restore` of files stay allowed;
 * - **the stash**, in any form: one stack for every folder of the repository;
 * - **worktrees** — `worktree add/remove/prune/move`;
 * - **merging** — allowed only to a worker in its own folder, which merges the
 *   feature branch in to settle a conflict; in the feature's folder merges into
 *   the feature branch are the lead's.
 *
 * A gates review is refused all of that and, since it writes nothing, every git
 * command that changes the folder or its history (`add`, `commit`, `checkout`,
 * `restore`, `reset`, `merge`, `cherry-pick`, `revert`, `clean`, `rm`, `mv`).
 *
 * Read with the same light shell split as the other guards, through wrappers
 * and `bash -c` / `pwsh -Command` scripts, in bash and PowerShell. What it
 * cannot read is allowed: a guard must never wedge a session, and a script can
 * still reach past it (decision 5 says so plainly).
 */

export interface WorkerGuardInput {
  /** The host worker this session is; absent for every other session, which the guard leaves alone. */
  hostWorker?: HostWorker
  /** `tool_name` from the hook payload; only the shell tools are read. */
  toolName?: string
  /** `tool_input.command` from the hook payload. */
  command?: string
}

/** Evaluate one tool call; `null` means the guard has no objection. */
export function evaluateWorkerGuard(input: WorkerGuardInput): EditDenial | null {
  const worker = input.hostWorker
  if (!worker) return null
  if (!input.toolName || !(SHELL_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.command) return null
  const why = evaluateScript(worker, input.command, dialectOf(input.toolName), 0)
  return why ? { reason: why } : null
}

/** How deep `bash -c` scripts are read inside one another. */
const MAX_DEPTH = 3

function evaluateScript(worker: HostWorker, script: string, dialect: ShellDialect, depth: number): string | null {
  for (const raw of commandsOf(script, dialect)) {
    const [verb, ...args] = unwrap(raw)
    if (!verb) continue
    const nested = nestedScript(commandName(verb), args)
    if (nested !== undefined) {
      if (depth >= MAX_DEPTH) continue
      const why = evaluateScript(worker, nested.script, nested.dialect, depth + 1)
      if (why) return why
      continue
    }
    if (!isGit(verb)) continue
    const parsed = gitSub(args)
    if (!parsed) continue
    const why = evaluateSub(worker, parsed.sub, parsed.rest)
    if (why) return why
  }
  return null
}

/** The git subcommands that change a folder or its history, all refused to a review. */
const REVIEW_REFUSED = new Set([
  'add', 'commit', 'checkout', 'restore', 'reset', 'merge', 'cherry-pick', 'revert', 'clean', 'rm', 'mv',
])

/** The `reset` modes that discard work or move the branch back. */
const RESET_MOVING_MODES = new Set(['--hard', '--soft', '--keep', '--merge'])

/** The `checkout` flags that make or leave a branch. */
const CHECKOUT_BRANCH_FLAGS = new Set(['-b', '-B', '--orphan', '--detach'])

/** The `worktree` subcommands that make, move or delete a folder. */
const WORKTREE_CHANGES = new Set(['add', 'remove', 'prune', 'move'])

function evaluateSub(worker: HostWorker, sub: string, args: string[]): string | null {
  const flags = args.filter((a) => a.startsWith('-'))
  switch (sub) {
    case 'push':
      return `\`git push\` is refused: a worker never pushes. ${landing(worker)} Commit, and hand back.`
    case 'pull':
      return (
        '`git pull` is refused: it merges or rebases the remote into your branch, and keeping the feature ' +
        'branch in step with the remote is the lead\'s. Work from the branch as it is; say in your handback ' +
        'if it needs updating.'
      )
    case 'stash':
      return (
        '`git stash` is refused in every form: the stash is one list shared by every folder of this ' +
        'repository, so another agent can pop your stash, or you theirs. Commit work in progress instead, ' +
        'or copy a file to the system temp folder; to see an older version use `git show HEAD:<path>`.'
      )
    case 'rebase':
      return flags.some((f) => f === '--abort' || f === '--quit') ? null : rewrite('git rebase')
    case 'filter-branch':
    case 'filter-repo':
      return rewrite(`git ${sub}`)
    case 'update-ref':
      return '`git update-ref` moves a branch by hand. The branches are the lead\'s: leave them as they are.'
    case 'branch':
      return flags.some((f) => ['--delete', '--move', '--force', '--copy'].includes(f) || /^-[A-Za-z]*[dDmMfC]/.test(f))
        ? 'Deleting, renaming or force-moving a branch is refused: the branches are the lead\'s, and it ' +
            'removes a worker\'s own branch when it lands or drops the worker. Leave the branches as they are.'
        : null
    case 'worktree': {
      const verb = args.find((a) => !a.startsWith('-'))
      return verb !== undefined && WORKTREE_CHANGES.has(verb)
        ? `\`git worktree ${verb}\` is refused: runcastle makes and removes worktrees, and removing one ` +
            'deletes another session\'s folder. Work in the folder you were given; `git worktree list` is fine.'
        : null
    }
    case 'switch':
      return flags.some((f) => f === '-h' || f === '--help') ? null : switching(worker)
  }

  if (worker.role === 'review' && REVIEW_REFUSED.has(sub)) {
    return (
      `\`git ${sub}\` is refused: a review changes nothing in the feature's folder — it reads the ` +
      'committed branch and reports. Report what should change with report_finding.'
    )
  }

  switch (sub) {
    case 'commit':
      return args.includes('--amend') ? rewrite('git commit --amend') : null
    case 'reset': {
      const mode = flags.find((f) => RESET_MOVING_MODES.has(f))
      if (mode) return rewrite(`git reset ${mode}`)
      const dd = args.indexOf('--')
      const revs = (dd < 0 ? args : args.slice(0, dd)).filter((a) => !a.startsWith('-') && isEarlierCommit(a))
      return revs.length > 0 ? rewrite(`git reset ${revs[0]}`) : null
    }
    case 'checkout': {
      if (args.includes('--') || flags.some((f) => f === '-p' || f === '--patch')) return null
      return flags.some((f) => CHECKOUT_BRANCH_FLAGS.has(f)) || args.some((a) => a === '-' || !a.startsWith('-'))
        ? switching(worker)
        : null
    }
    case 'merge':
      if (worker.placement === 'own-folder') return null
      return (
        '`git merge` is refused in the feature\'s folder: you already build on the feature branch, and ' +
        'merging other work into it is the lead\'s. If you need another branch\'s work, say so in your handback.'
      )
    default:
      return null
  }
}

/** A `reset` argument that names an earlier commit, so the reset moves the branch back. */
function isEarlierCommit(arg: string): boolean {
  return /[~^]|@\{/.test(arg) || /^(ORIG_HEAD|FETCH_HEAD)$/.test(arg) || /^[0-9a-f]{7,40}$/i.test(arg)
}

/** How a worker's commits reach the feature branch, said in a refusal. */
function landing(worker: HostWorker): string {
  return worker.placement === 'feature-folder'
    ? 'Your commits are already on the feature branch, and the lead publishes it.'
    : 'The lead merges your branch into the feature branch when it lands your work.'
}

function rewrite(what: string): string {
  return (
    `\`${what}\` is refused: it rewrites history the lead and other workers build on` +
    ' (in the feature\'s folder those commits are the lead\'s too). Undo a mistake with a new commit ' +
    'instead — `git revert`, or a fix-up commit.'
  )
}

function switching(worker: HostWorker): string {
  const why =
    worker.placement === 'feature-folder'
      ? 'you share the feature\'s folder with the lead, so a switch would move the folder under it too'
      : 'your folder is on your own branch, which the lead merges back'
  return (
    `Switching branch is refused: ${why}. Stay on the branch you are on. To restore a file use ` +
    '`git checkout -- <path>` or `git restore <path>`; to read another branch\'s file use `git show <branch>:<path>`.'
  )
}
