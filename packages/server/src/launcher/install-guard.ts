import { resolve } from 'node:path'
import type { SessionKind } from '@runcastle/core'
import { EDIT_TOOLS, type EditDenial, guardsEdits } from './edit-guard'

/**
 * The talk-worktree install guard — the edit guard's sibling on the same
 * `PreToolUse` hook, denying package-manager installs run through a shell in a
 * feature's talk worktree.
 *
 * Why: charter decision 6 makes talk worktrees docs-only with no dependency
 * install, yet feature worktrees accumulated their own `node_modules` (~0.6 GB
 * each; 129 of them filled a disk). No runcastle code installs there — agents
 * did, running `bun install` from Bash to typecheck or test a merge, mostly in
 * conflict-resolve sessions. The edit guard never saw it: it covers file-write
 * tools, not shells.
 *
 * The line is the PLACE, not the kind alone (decisions §5): only a session whose
 * cwd is its feature's talk worktree is guarded. `prepare` and drive-fix run in
 * the developer's own checkout, where installing is legitimate; the `project`
 * session's one `__project` worktree is bounded and reused. And unlike the edit
 * guard there is NO resolve-conflict exemption — resolve sessions are the main
 * offenders (decisions §4).
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
 * separator (`;`, `&`, `&&`, `|`, `(`) — the burn guard's anchoring, so a verb
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

/** Package-manager install verbs, each anchored at command position. */
const INSTALL_PATTERNS: readonly RegExp[] = [
  new RegExp(`${CMD_START}bun\\s+(?:install|i|add)${VERB_END}`),
  new RegExp(`${CMD_START}npm\\s+(?:install|i|ci|add)${VERB_END}`),
  new RegExp(`${CMD_START}pnpm\\s+(?:install|i|add)${VERB_END}`),
  new RegExp(`${CMD_START}yarn\\s+(?:install|add)${VERB_END}`),
  // Bare `yarn` — alone, or with install flags only — installs too. It ends at a
  // separator, a newline (the next line is its own command), or the end.
  new RegExp(`${CMD_START}yarn(?:[^\\S\\n]+(?!${YARN_READ_ONLY_FLAG})-|[^\\S\\n]*(?:[;&|)\\n]|$))`),
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
}

/**
 * Evaluate one tool call; `null` means allow. Fails OPEN on anything it cannot
 * read, for the edit guard's reason: a guard must never wedge a session.
 */
export function evaluateInstallGuard(input: InstallGuardInput): EditDenial | null {
  if (!guardsEdits(input.kind)) return null
  if (!input.toolName || !(SHELL_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.command || !input.talkWorktreePath) return null
  if (!samePath(input.worktreePath, input.talkWorktreePath)) return null

  // Blank quoted spans, as the burn guard does: searching for the string is not
  // running it.
  const stripped = input.command.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ')
  if (!INSTALL_PATTERNS.some((pattern) => pattern.test(stripped))) return null

  return {
    reason:
      'Package installs are blocked in this worktree: a talk worktree is docs-only, with no ' +
      'dependency install (charter decision 6), and every install here costs a full ' +
      '`node_modules` per feature. Verification that needs dependencies happens elsewhere — ' +
      'in the burn sandbox, in the review lap, or in a test drive of the branch, which runs in ' +
      'the main checkout with dependencies installed. Check what you can without them ' +
      '(`git diff --check`, grep, re-reading the code).',
  }
}

/** Same directory? Case-insensitive on Windows, where the filesystem is. */
function samePath(a: string, b: string): boolean {
  const [x, y] = [resolve(a), resolve(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}
