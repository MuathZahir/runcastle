import { isAbsolute, relative, resolve } from 'node:path'
import type { SessionKind, SessionPurpose } from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'

/**
 * The talk-session edit guard — a Claude Code `PreToolUse` hook registered into
 * every non-`project` session's settings (`renderSettings`), denying file edits
 * outside the feature's own docs.
 *
 * Why a hook and not more prompt text, the same argument the burn guard makes:
 * a prompt rule is advisory, a deny is not. A talk session runs in a FULL
 * checkout of the feature branch with `--permission-mode acceptEdits`, so the
 * only thing standing between "grill the human about this lap" and "just
 * implement it" was a sentence in a briefing — and when that briefing was
 * swallowed (F2), an ideation agent read the docs and started editing source.
 * Code changes ride tickets; this is the layer that makes that true.
 *
 * Deliberately NOT a blanket deny of Edit/Write: these sessions write the
 * feature docs (`decisions.md`, `spec.md`, `map.md`, the map's notes) with the
 * same tools, and that IS their output. The line is drawn at the docs dir.
 *
 * The one exempt kind is `project`: decision 18 gives it whole-repo write access
 * on a runcastle-owned branch, and its commits are the point of the session.
 *
 * A `prepare` session gets a narrow path exception instead of a kind exemption —
 * see {@link PREPARE_WRITABLE}.
 *
 * The one exempt PURPOSE is `resolve-conflict`, and only while a merge is
 * actually in progress in the session's worktree. Both conflict-resolve launch
 * sites brief their agent to merge, resolve the conflicts and commit — work this
 * guard used to deny outright, so the agent either wedged or bypassed it with
 * shell scripts. The exemption is scoped to the in-progress merge rather than
 * granted to the session, so it is self-limiting: the moment the merge commit
 * lands, the guard snaps back to docs-only.
 */

/**
 * The tools this guard is registered for: Claude Code's file-write surface plus
 * Codex's (`apply_patch`), because the guard is shared and a session is one or
 * the other. Additive on purpose — a runtime never sees the other's tool names,
 * so listing both costs nothing and keeps one matcher for both `hooks.json` and
 * `settings.json`.
 */
export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'apply_patch'] as const

/**
 * The `matcher` string registering them. Both runtimes match a tool name against
 * this as a regex, so the alternation covers all of them in one entry.
 */
export const EDIT_TOOL_MATCHER = EDIT_TOOLS.join('|')

/** Does a session of this kind get the guard? Every kind but `project`. */
export function guardsEdits(kind: SessionKind): boolean {
  return kind !== 'project'
}

export interface EditGuardInput {
  kind: SessionKind
  /** The session's errand, when it has one — `resolve-conflict` is the exempt purpose. */
  purpose?: SessionPurpose
  /**
   * Is a merge in progress in the session's worktree (`MERGE_HEAD` exists)? The
   * probe is git IO, so the caller runs it and this stays pure — see
   * `handlePreToolUse`, which only asks when the purpose could use the answer.
   */
  mergeInProgress?: boolean
  /** `tool_name` from the hook payload. */
  toolName?: string
  /** `tool_input.file_path` / `notebook_path` — may be relative to the cwd. */
  filePath?: string
  /** The session's working directory (its talk worktree / checkout). */
  worktreePath: string
  /** The feature this session belongs to; absent for a project-scoped session. */
  featureSlug?: string
}

/**
 * What a host-side session may write in the developer's own checkout: the drive
 * machinery (`.runcastle/drive-setup.sh` and friends) and the `.gitignore` line
 * that keeps `.runcastle/drive.env` — a scratch file that can hold connection
 * strings — out of the repo.
 *
 * Both kinds that hold the real checkout get exactly this and nothing more. A
 * `prepare` session is otherwise the strictest of all: it establishes settings
 * and never touches code. A `drive-fix` session is opened on one failing drive,
 * and the machinery it repairs is these same files — on the feature branch,
 * where the branch that broke the drive can carry its own fix.
 */
const DRIVE_MACHINERY_WRITABLE = ['.runcastle/', '.gitignore'] as const

/** Is `target` one of the {@link DRIVE_MACHINERY_WRITABLE} paths in this checkout? */
function isDriveMachinery(worktreePath: string, target: string): boolean {
  return DRIVE_MACHINERY_WRITABLE.some((rel) => within(resolve(worktreePath, rel), target))
}

/** A deny verdict, with what to tell the agent instead; `null` means allow. */
export interface EditDenial {
  reason: string
}

/**
 * Evaluate one tool call. Fails OPEN on anything it cannot read — an unknown
 * tool, a payload with no path — for the burn guard's reason: a guard must never
 * be able to wedge a session, and every path it does not recognise is one the
 * prompt rule still covers.
 */
export function evaluateEditGuard(input: EditGuardInput): EditDenial | null {
  if (!guardsEdits(input.kind)) return null
  // The merge being resolved is what the session was opened for: while it is in
  // progress, ANY path is fair game (the content comes from the two sides of the
  // merge, not from the agent deciding to write code).
  if (input.purpose === 'resolve-conflict' && input.mergeInProgress) return null
  if (!input.toolName || !(EDIT_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.filePath) return null

  const target = resolve(input.worktreePath, input.filePath)

  // A drive-fix session is feature-scoped but host-side: it holds the real
  // checkout on the feature branch, and its whole job is amending the drive
  // machinery there. Its docs are not the line — the machinery is.
  if (input.kind === 'drive-fix') {
    if (isDriveMachinery(input.worktreePath, target)) return null
    return {
      reason:
        'A drive-fix session repairs one failing drive in the developer\'s own checkout, so it ' +
        `writes the drive machinery and nothing else: ${writablePaths()} — ${input.filePath} is ` +
        'outside them. A change to the app itself belongs in a ticket, not in this session.',
    }
  }

  if (!input.featureSlug) {
    if (input.kind === 'prepare' && isDriveMachinery(input.worktreePath, target)) return null
    return {
      reason:
        `This ${input.kind} session does not edit files — it runs in the developer's own ` +
        `checkout. Its one exception is the drive machinery it authors: ${writablePaths()}. ` +
        'Record what you establish with the `record_finding` MCP tool, and ask the human to make ' +
        'any other change to the repo itself.',
    }
  }

  const docs = featureDocsRel(input.featureSlug)
  if (within(resolve(input.worktreePath, docs), target)) return null

  return {
    reason:
      `Talk sessions do not write code. This ${input.kind} session may only write this ` +
      `feature's docs under \`${docs}/\` — ${input.filePath} is outside them. The change you ` +
      'want belongs in a ticket: capture the decision in `decisions.md`, amend `spec.md`, and ' +
      'emit a ticket for the work. An implementation agent burns it in its own sandbox.',
  }
}

/** The writable paths, as a denial names them ("`.runcastle/` and `.gitignore`"). */
function writablePaths(): string {
  return DRIVE_MACHINERY_WRITABLE.map((p) => `\`${p}\``).join(' and ')
}

/** Is `target` inside `dir` — or `dir` itself? Both paths must be absolute. */
function within(dir: string, target: string): boolean {
  const rel = relative(dir, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The verified `PreToolUse` deny shape (same as the burn guard's). */
export function editDenyResponse(denial: EditDenial): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denial.reason,
    },
  }
}
