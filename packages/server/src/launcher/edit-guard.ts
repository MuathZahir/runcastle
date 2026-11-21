import { tmpdir } from 'node:os'
import type { SessionKind, SessionPurpose, WorkerPlacement } from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import { type PathFlavor, pathApi, within } from './guard-paths'

/**
 * The talk-session edit guard — a Claude Code `PreToolUse` hook registered into
 * every non-`project` session's settings (`renderSettings`), denying file edits
 * outside the feature's own docs.
 *
 * Why a hook and not more prompt text, the same argument the round guard makes:
 * a prompt rule is advisory, a deny is not. A talk session runs in a FULL
 * checkout of the feature branch with `--permission-mode acceptEdits`, so the
 * only thing standing between "grill the human about this round" and "just
 * implement it" was a sentence in a briefing — and when that briefing was
 * swallowed (F2), an ideation agent read the docs and started editing source.
 * Code changes ride tickets; this is the layer that makes that true.
 *
 * Deliberately NOT a blanket deny of Edit/Write: these sessions write the
 * feature docs (`decisions.md`, `spec.md`) with the same tools, and that IS
 * their output. The line is drawn at the docs dir.
 *
 * The one exempt kind is `project`: decision 18 gives it whole-repo write access
 * on a runcastle-owned branch, and its commits are the point of the session.
 * A feature's `chat` and `side` sessions are exempt too (see {@link isUnguardedLead}).
 *
 * A host worker (workers-build-in-the-feature-s-folder decisions 9 and 10) is held
 * to its folder instead of the docs: a building worker edits anywhere inside its
 * own folder and the system temp folder, a gates review only in the temp folder
 * — see {@link HostWorker}.
 *
 * A `drive-fix` session gets a narrow path exception instead of a kind exemption —
 * see {@link DRIVE_MACHINERY_WRITABLE}. A `scenario` session gets `.runcastle/`,
 * or its whole checkout while its purpose is `scenario-setup`.
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
 * `settings.json` (`PRE_TOOL_MATCHER`, beside the install guard's shell tools).
 */
export const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'apply_patch'] as const

/** Does a session of this kind get the guard? Every kind but `project`. */
export function guardsEdits(kind: SessionKind): boolean {
  return kind !== 'project'
}

/**
 * Is this session the feature's lead with its code permissions? Every feature
 * `chat` is the lead from its first message (tickets-and-review-are-tools-not-phases
 * decisions 4 and 13), attended or headless, self-planning included: it may edit
 * code and install dependencies in its worktree, so both guards lift for it, and
 * it runs without permission prompts.
 *
 * A `side` session shares the main chat's worktree and write rules
 * (several-sessions-per-feature decision 5), so it is unguarded exactly when
 * the main chat is.
 */
export function isUnguardedLead(kind: SessionKind): boolean {
  return kind === 'chat' || kind === 'side'
}

/**
 * A worker that runs on the host in a folder of its own or the feature's
 * (workers-build-in-the-feature-s-folder): what the edit, install, remote and
 * worker guards need to know of it, read off its `workers` row by the route.
 */
export interface HostWorker {
  /** `build`: a with-you, on-its-own or unassigned worker. `review`: a gates review, which writes no code. */
  role: 'build' | 'review'
  /** The feature's folder (shared with the lead) or its own worktree on its own branch; a review is always in the feature's. */
  placement: WorkerPlacement
  /** The folder it works in: its session's working directory. */
  folder: string
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
  /**
   * The feature's scenario-data folder, outside the checkout. A `scenario`
   * session on a feature's drive saves data copies there, as its brief says;
   * absent on a project drive, which has no feature and no folder.
   */
  scenarioDataDir?: string
  /** Set when the session is a host worker's: then its folder, not the docs, is the line. */
  hostWorker?: HostWorker
  /** The temp folders a host worker may write in; the OS's and `/tmp` by default. */
  tempFolders?: string[]
  /** Runcastle's data folder: other sessions' folders, never temp even when it sits in one. */
  dataDir?: string
  /** The path rules to compare paths by; the host's by default. */
  platform?: PathFlavor
}

/**
 * What a host-side session may write in the developer's own checkout: the drive
 * machinery (`.runcastle/drive-setup.sh` and friends) and the `.gitignore` line
 * that keeps `.runcastle/drive.env` — a scratch file that can hold connection
 * strings — out of the repo.
 *
 * A `drive-fix` session gets exactly this and nothing more: it is opened on one
 * failing drive, and the machinery it repairs is these same files — on the feature branch,
 * where the branch that broke the drive can carry its own fix.
 */
export const DRIVE_MACHINERY_WRITABLE = ['.runcastle/', '.gitignore'] as const

/**
 * What a `scenario` session outside setup mode may write: the runcastle
 * machinery dir its scenarios live under — {@link DRIVE_MACHINERY_WRITABLE}
 * without `.gitignore`.
 */
export const SCENARIO_WRITABLE = '.runcastle/'

/** Is `target` one of the {@link DRIVE_MACHINERY_WRITABLE} paths in this checkout? */
function isDriveMachinery(worktreePath: string, target: string, flavor?: PathFlavor): boolean {
  const { resolve } = pathApi(flavor)
  return DRIVE_MACHINERY_WRITABLE.some((rel) => within(resolve(worktreePath, rel), target, flavor))
}

/** A deny verdict, with what to tell the agent instead; `null` means allow. */
export interface EditDenial {
  reason: string
}

/**
 * Evaluate one tool call. Fails OPEN on anything it cannot read — an unknown
 * tool, a payload with no path — for the round guard's reason: a guard must never
 * be able to wedge a session, and every path it does not recognise is one the
 * prompt rule still covers.
 */
export function evaluateEditGuard(input: EditGuardInput): EditDenial | null {
  if (!guardsEdits(input.kind)) return null
  if (isUnguardedLead(input.kind)) return null
  // The merge being resolved is what the session was opened for: while it is in
  // progress, ANY path is fair game (the content comes from the two sides of the
  // merge, not from the agent deciding to write code).
  if (input.purpose === 'resolve-conflict' && input.mergeInProgress) return null
  if (!input.toolName || !(EDIT_TOOLS as readonly string[]).includes(input.toolName)) return null
  if (!input.filePath) return null

  const flavor = input.platform
  const { resolve } = pathApi(flavor)
  const target = resolve(input.worktreePath, input.filePath)

  if (input.hostWorker) return evaluateHostWorkerEdit(input, input.hostWorker, target)

  // A drive-fix session is feature-scoped but host-side: it holds the real
  // checkout on the feature branch, and its whole job is amending the drive
  // machinery there. Its docs are not the line — the machinery is.
  if (input.kind === 'drive-fix') {
    if (isDriveMachinery(input.worktreePath, target, flavor)) return null
    return {
      reason:
        'A drive-fix session repairs one failing drive in the developer\'s own checkout, so it ' +
        `writes the drive machinery and nothing else: ${writablePaths()} — ${input.filePath} is ` +
        'outside them. A change to the app itself belongs in a worker assignment, not in this session.',
    }
  }

  // A scenario session is host-side too, scoped to its drive. In setup mode it
  // writes the login route and the typecheck config, so the whole checkout is
  // open; afterwards only `.runcastle/`, where scenarios and their fixtures
  // live. `.gitignore` is not on that list: a scenario has no business there.
  // On a feature's drive, the feature's scenario-data folder is open too.
  if (input.kind === 'scenario') {
    if (input.purpose === 'scenario-setup' && within(resolve(input.worktreePath), target, flavor)) return null
    if (within(resolve(input.worktreePath, SCENARIO_WRITABLE), target, flavor)) return null
    if (input.scenarioDataDir && within(resolve(input.scenarioDataDir), target, flavor)) return null
    const writable = input.scenarioDataDir
      ? `\`${SCENARIO_WRITABLE}\` and the feature's data folder (\`RUNCASTLE_SCENARIO_DATA\`)`
      : `\`${SCENARIO_WRITABLE}\``
    return {
      reason:
        'A scenario session writes scenarios and their shared code, so it may write only ' +
        `${writable} — ${input.filePath} is outside them. A change to the app itself ` +
        'belongs in a worker assignment; tell the human what the scenario needs.',
    }
  }

  if (!input.featureSlug) {
    return {
      reason:
        `This ${input.kind} session has no feature, so it has no docs to write and does not ` +
        'edit files. Ask the human to make the change to the repo itself.',
    }
  }

  const docs = featureDocsRel(input.featureSlug)
  if (within(resolve(input.worktreePath, docs), target, flavor)) return null

  return {
    reason:
      `This ${input.kind} session does not write code: it may only write this feature's docs under ` +
      `\`${docs}/\` — ${input.filePath} is outside them. Code is written by the feature's lead or one of ` +
      'its building workers: say what should change in your reply (a review reports it with ' +
      'report_finding), and they make the change.',
  }
}

/**
 * A host worker's edit (decisions 9 and 10): a building worker writes inside its
 * own folder and the system temp folder; a gates review only in the temp folder,
 * since it works in the feature's folder and writes no code.
 */
function evaluateHostWorkerEdit(input: EditGuardInput, worker: HostWorker, target: string): EditDenial | null {
  const flavor = input.platform
  const temps = input.tempFolders ?? [tmpdir(), '/tmp']
  const inData = input.dataDir !== undefined && within(input.dataDir, target, flavor)
  if (!inData && temps.some((dir) => within(dir, target, flavor))) return null
  if (worker.role === 'review') {
    return {
      reason:
        `A review writes no code: it reads the feature's folder and reports what it finds, so ${input.filePath} ` +
        'may not be edited. Report what should change with report_finding; a scratch file goes in the ' +
        `system temp folder (${temps[0]}).`,
    }
  }
  if (within(worker.folder, target, flavor)) return null
  const whose =
    worker.placement === 'feature-folder'
      ? "the feature's folder, which you share with the lead"
      : 'your own folder, on your own branch'
  return {
    reason:
      `A worker edits only inside its folder (${worker.folder}, ${whose}) and the system temp folder ` +
      `(${temps[0]}) — ${input.filePath} is outside them, and the rest of this machine belongs to the ` +
      'human or to other sessions. Make the change inside your folder, or say in your handback what ' +
      'needs changing elsewhere.',
  }
}

/** The writable paths, as a denial names them ("`.runcastle/` and `.gitignore`"). */
function writablePaths(): string {
  return DRIVE_MACHINERY_WRITABLE.map((p) => `\`${p}\``).join(' and ')
}

/** The verified `PreToolUse` deny shape (same as the round guard's). */
export function editDenyResponse(denial: EditDenial): unknown {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denial.reason,
    },
  }
}
