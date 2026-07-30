import { isAbsolute, relative, resolve } from 'node:path'
import type { SessionKind } from '@runcastle/core'
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
 */

/** The tools this guard is registered for (Claude Code's file-write surface). */
export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'] as const

/**
 * The `matcher` string registering them. Claude Code matches a tool name against
 * this as a regex, so the alternation covers all three in one entry.
 */
export const EDIT_TOOL_MATCHER = EDIT_TOOLS.join('|')

/** Does a session of this kind get the guard? Every kind but `project`. */
export function guardsEdits(kind: SessionKind): boolean {
  return kind !== 'project'
}

export interface EditGuardInput {
  kind: SessionKind
  /** `tool_name` from the hook payload. */
  toolName?: string
  /** `tool_input.file_path` / `notebook_path` — may be relative to the cwd. */
  filePath?: string
  /** The session's working directory (its talk worktree / checkout). */
  worktreePath: string
  /** The feature this session belongs to; absent for a project-scoped session. */
  featureSlug?: string
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
  if (!input.toolName || !(EDIT_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.filePath) return null

  if (!input.featureSlug) {
    return {
      reason:
        `This ${input.kind} session does not edit files — it runs in the developer's own ` +
        'checkout. Record what you establish with the `record_finding` MCP tool, and ask the ' +
        'human to make any change to the repo itself.',
    }
  }

  const docs = featureDocsRel(input.featureSlug)
  const docsDir = resolve(input.worktreePath, docs)
  const target = resolve(input.worktreePath, input.filePath)
  const rel = relative(docsDir, target)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return null

  return {
    reason:
      `Talk sessions do not write code. This ${input.kind} session may only write this ` +
      `feature's docs under \`${docs}/\` — ${input.filePath} is outside them. The change you ` +
      'want belongs in a ticket: capture the decision in `decisions.md`, amend `spec.md`, and ' +
      'emit a ticket for the work. An implementation agent burns it in its own sandbox.',
  }
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
