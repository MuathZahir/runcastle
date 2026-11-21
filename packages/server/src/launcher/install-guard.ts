import type { SessionKind } from '@runcastle/core'
import { EDIT_TOOLS, type EditDenial, guardsEdits, type HostWorker, isUnguardedLead } from './edit-guard'
import { samePath } from './guard-paths'

/**
 * The talk-worktree install guard — the edit guard's sibling on the same
 * `PreToolUse` hook, denying package-manager installs run through a shell in a
 * feature's talk worktree.
 *
 * Why (history): charter decision 6 once made talk worktrees docs-only with no
 * dependency install, yet feature worktrees accumulated their own `node_modules` (~0.6 GB
 * each; 129 of them filled a disk). No runcastle code installs there — agents
 * did, running `bun install` from Bash to typecheck or test a merge, mostly in
 * conflict-resolve sessions. The edit guard never saw it: it covers file-write
 * tools, not shells.
 *
 * The line is the PLACE, not the kind alone (decisions §5): only a session whose
 * cwd is its feature's talk worktree is guarded. drive-fix and scenario run in
 * the developer's own checkout, where installing is legitimate; the `project`
 * session's one `__project` worktree is bounded and reused. And unlike the edit
 * guard there is NO resolve-conflict exemption — resolve sessions are the main
 * offenders (decisions §4). A feature's `chat` and `side` sessions install freely
 * (`isUnguardedLead`), so they can typecheck and test their own code edits, and
 * so does a host worker that builds (workers-build-in-the-feature-s-folder
 * decision 2): the first one builds in that very folder. A gates review there
 * stays refused — it writes no code, so it checks with what is installed.
 */

/**
 * The shell tools this guard reads. Claude Code's `Bash` and `PowerShell`; Codex
 * reports its shell (`exec_command`) under the canonical name `Bash` with
 * `tool_input.command` (verified against codex-rs `unified_exec/exec_command.rs`),
 * so one list covers both runtimes.
 */
export const SHELL_TOOLS = ['Bash', 'PowerShell'] as const

/**
 * The `matcher` registering the shared `pre-tool` hook: the edit guard's tools
 * plus the shell tools. Both runtimes match it as a regex alternation.
 */
export const PRE_TOOL_MATCHER = [...EDIT_TOOLS, ...SHELL_TOOLS].join('|')

/**
 * Command position — start, a newline, or just after a shell/PowerShell
 * separator (`;`, `&`, `&&`, `|`, `(`) — the round guard's anchoring, so a verb
 * that is only an argument (`grep -rn bun install docs/` after quote blanking)
 * is never read as a command.
 */
const CMD_START = '(?:^|[;&|(\\n])\\s*'
/** The verb ends at whitespace, a separator, or the end — so `bun init` ≠ `bun i`. */
const VERB_END = '(?=\\s|[;&|)]|$)'
/**
 * Bare `yarn`'s read-only flags — `yarn --version` / `yarn --help` report and
 * exit, so only its other flags (`yarn --frozen-lockfile`) mean an install.
 */
const YARN_READ_ONLY_FLAG = `(?:-v|--version|-h|--help)${VERB_END}`

/**
 * A package manager at command position: optionally env-prefixed (`FOO=1 bun`),
 * optionally with Windows' `.cmd`/`.exe` suffix (`npm.cmd`, from PowerShell).
 */
const manager = (name: string) =>
  `${CMD_START}(?:[A-Za-z_]\\w*=[^\\s;&|()]*\\s+)*${name}(?:\\.cmd|\\.exe)?`
/**
 * Global flags between the manager and its verb, each with an optional value —
 * `bun --cwd packages/server install`, `pnpm -C x install`, `npm --prefix x ci`.
 */
const GLOBAL_FLAGS = '(?:\\s+-[^\\s;&|()]*(?:\\s+[^\\s;&|()-][^\\s;&|()]*)?)*'
const verbAfter = (name: string, verbs: string) =>
  new RegExp(`${manager(name)}${GLOBAL_FLAGS}\\s+(?:${verbs})${VERB_END}`)

/** Package-manager install verbs, each anchored at command position. */
const INSTALL_PATTERNS: readonly RegExp[] = [
  verbAfter('bun', 'install|i|add'),
  verbAfter('npm', 'install|i|ci|add'),
  verbAfter('pnpm', 'install|i|add'),
  verbAfter('yarn', 'install|add'),
  // Bare `yarn` — alone, or with install flags only — installs too. It ends at a
  // separator, a newline (the next line is its own command), or the end.
  new RegExp(`${manager('yarn')}(?:[^\\S\\n]+(?!${YARN_READ_ONLY_FLAG})-|[^\\S\\n]*(?:[;&|)\\n]|$))`),
]

export interface InstallGuardInput {
  kind: SessionKind
  /** `tool_name` from the hook payload. */
  toolName?: string
  /** `tool_input.command` from the hook payload. */
  command?: string
  /** The session's working directory. */
  worktreePath: string
  /**
   * The feature's talk worktree (`worktreeDir(projectId, slug)`); absent when the
   * session has no feature, which is never guarded.
   */
  talkWorktreePath?: string
  /** Set when the session is a host worker's; a building one installs freely. */
  hostWorker?: HostWorker
}

/**
 * Evaluate one tool call; `null` means allow. Fails OPEN on anything it cannot
 * read, for the edit guard's reason: a guard must never wedge a session.
 */
export function evaluateInstallGuard(input: InstallGuardInput): EditDenial | null {
  if (!guardsEdits(input.kind)) return null
  if (isUnguardedLead(input.kind)) return null
  if (input.hostWorker?.role === 'build') return null
  if (!input.toolName || !(SHELL_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.command || !input.talkWorktreePath) return null
  if (!samePath(input.worktreePath, input.talkWorktreePath)) return null

  // Blank heredoc bodies and quoted spans, as the round guard does: a commit
  // message that mentions the string, or searching for it, is not running it.
  // One left-to-right pass over both quote kinds, so the quote that opens first
  // wins — an apostrophe inside `"it's"` never opens a single-quoted span.
  const stripped = blankHeredocBodies(input.command).replace(/'[^']*'|"[^"]*"/g, ' ')
  if (!INSTALL_PATTERNS.some((pattern) => pattern.test(stripped))) return null

  if (input.hostWorker?.role === 'review') {
    return {
      reason:
        "A review installs nothing: it checks the feature in the feature's folder with the packages " +
        'already installed there, and an install would change the folder the lead builds in. Run the ' +
        "checks as they are; if one cannot run for a missing package, report that with report_finding.",
    }
  }
  return {
    reason:
      "Package installs are blocked for this session in the feature's folder: only the feature's lead " +
      'and its building workers install there. Check what you can without them (`git diff --check`, ' +
      'grep, re-reading the code), or say in your reply what needs installing and why.',
  }
}

/** A heredoc opener — `<<EOF`, `<<-'EOF'`, `<< "EOF"` — but not a `<<<` here-string. */
const HEREDOC_OPENER = /(?<!<)<<(?!<)(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([\w.-]+))/g

/**
 * Drop the body lines of every heredoc, keeping the line that opens it and the
 * lines after its terminator. A body is text fed to a command's stdin — a
 * `git commit -F - <<'EOF'` message line that starts with `bun install` is prose,
 * yet after a newline it would sit in command position.
 */
export function blankHeredocBodies(command: string): string {
  const kept: string[] = []
  const pending: { word: string; stripTabs: boolean }[] = []
  for (const line of command.split('\n')) {
    const open = pending[0]
    if (open) {
      if ((open.stripTabs ? line.replace(/^\t+/, '') : line) === open.word) pending.shift()
      continue
    }
    kept.push(line)
    for (const m of line.matchAll(HEREDOC_OPENER)) {
      pending.push({ word: m[2] ?? m[3] ?? m[4] ?? '', stripTabs: m[1] === '-' })
    }
  }
  return kept.join('\n')
}

