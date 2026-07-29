import type { ProjectSession } from './api'

/**
 * The project workspace (decision 20) — the third thing the shell body can show.
 *
 * The features rail is the project's list of things to work on, and the project
 * session is the one entry on it that is not a feature: a pinned row above the
 * triage lanes swaps the workspace from the feature workspace to this one. Every
 * Inspector panel is feature-scoped, so the swap hides the Inspector entirely.
 *
 * Pure by design (no react, no trpc) so the swap rules and the session's live
 * state are unit-testable the way the rest of `lib/` is.
 */

/**
 * The runcastle-owned branch the project session works on (decision 18). Mirrors
 * `PROJECT_BRANCH` in `packages/server/src/services/git.ts`; it is chrome here —
 * the UI states the branch, it never sends it.
 */
export const PROJECT_BRANCH = 'runcastle/project'

/**
 * The door's one wording. Both surfaces that demand a title the human may not
 * have yet — the empty workspace and the New Feature form — carry it verbatim,
 * so the affordance reads as the same door in both places.
 */
export const TALK_IT_THROUGH = "Not sure it's one feature? Talk it through"

/** What the pinned row's indicator and the workspace's session panel render. */
export type ProjectSessionState = 'none' | 'launching' | 'live'

/**
 * The live state of the project conversation, from the polled session row.
 * `none` covers both "never started" and "ended" — the row is the single source
 * of truth, so a session that ended anywhere stops showing as live here.
 */
export function projectSessionState(
  session: ProjectSession | null | undefined,
): ProjectSessionState {
  if (!session) return 'none'
  if (session.status === 'launching') return 'launching'
  if (session.status === 'live') return 'live'
  return 'none'
}

/**
 * The chrome's consequence sentence (decision 18). The session writes the repo
 * for real, so the workspace has to say plainly where those commits go — landing
 * on the base branch fast-forwards the human's working tree exactly like a pull,
 * which is reassuring only if it was stated up front.
 */
export function projectBranchNote(mainBranch: string): string {
  // Empty only in the window before `project.list` lands; naming no branch beats
  // naming the wrong one.
  const target = mainBranch || 'the base branch'
  return `Runs on ${PROJECT_BRANCH} — commits land on ${target} and arrive in your checkout like a git pull.`
}

/** Which surface owns the workspace body. */
export type WorkspaceView = 'create' | 'project' | 'feature' | 'empty'

/**
 * The workspace body's one selector. A creation form owns the body outright;
 * otherwise the pinned project row wins over the selected feature, and with
 * neither the project home shows.
 */
export function workspaceView(state: {
  creating: boolean
  projectSelected: boolean
  selectedFeatureId: string | null
}): WorkspaceView {
  if (state.creating) return 'create'
  if (state.projectSelected) return 'project'
  return state.selectedFeatureId ? 'feature' : 'empty'
}

/**
 * Whether the Inspector rail renders. Every panel in it is feature-scoped, so it
 * belongs to exactly one view — the project workspace hides it entirely rather
 * than showing panels about a feature you are not looking at.
 */
export function showsInspector(view: WorkspaceView, inspectorCollapsed: boolean): boolean {
  return view === 'feature' && !inspectorCollapsed
}
