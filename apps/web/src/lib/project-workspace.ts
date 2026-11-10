import type { ProjectSession } from './api'
import { sessionActive } from './feature-ui'

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
  if (!session || !sessionActive(session)) return 'none'
  return session.status === 'launching' ? 'launching' : 'live'
}

/** Where the landing branch on screen came from (decisions 5–6). */
export type SessionBranchOrigin =
  /** A human picked it, and it is still a branch this repo has. */
  | 'picked'
  /** Nobody has picked, so it is the repo's main line, detected at read time. */
  | 'detected'
  /** A human picked it and it is gone — the next chat launch will refuse to run. */
  | 'vanished'

/** What the landing menu renders (decisions 5–6, and decisions.md #3). */
export interface SessionBranchState {
  /** The branch shown as chosen — the stored pick if there is one, else detection. */
  value: string
  origin: SessionBranchOrigin
}

/**
 * The menu's state, from `project.sessionBranch`'s `{ stored, effective,
 * detected }` and the project's local branches — `null` until the query lands,
 * because "detected" and "your pick" read as opposites and there is no safe
 * guess between them.
 *
 * The vanished case is why the query reports `stored` separately rather than
 * just an effective string: a pick whose branch has been deleted still shows,
 * and it is the one error state the menu paints — New chat is blocked until
 * another branch is picked, the menu being the one place that can be fixed
 * (spec, "Seams"). Unknown branches (list still in flight) never accuse a pick
 * of being gone.
 */
export function sessionBranchState(
  view: { stored: string | null; effective: string; detected: string } | undefined,
  branches: readonly string[] | undefined,
): SessionBranchState | null {
  if (!view) return null
  const origin: SessionBranchOrigin = !view.stored
    ? 'detected'
    : branches && !branches.includes(view.stored)
      ? 'vanished'
      : 'picked'
  return { value: view.effective, origin }
}

/** Which surface owns the workspace body. */
export type WorkspaceView = 'create' | 'project' | 'feature'

/**
 * The workspace body's one selector. The Draft overlay owns the body outright;
 * then the pinned project row over the selected feature. (The other creation
 * door, New, is not a view at all any more — it opens a fresh conversation in
 * the project workspace.) Nothing selected is the project home, which a new
 * project opens on its Start the project card
 * (the-orchestrator-prepares-the-project decision 1): whether to prepare is the
 * Orchestrator's call, so no view here asks whether the project is prepared.
 */
export function workspaceView(state: {
  creating: boolean
  projectSelected: boolean
  selectedFeatureId: string | null
}): WorkspaceView {
  if (state.creating) return 'create'
  if (state.projectSelected) return 'project'
  if (state.selectedFeatureId) return 'feature'
  // Nothing selected is the project home itself — never a "pick a feature"
  // page with nothing on it (the bare `/p/<id>` address lands here).
  return 'project'
}

/**
 * What the palette's project-chat row answers to. The chat is the intake door —
 * where a raw idea goes before it is a feature — so it has to answer to the
 * words for having a conversation, not only to its own name.
 */
const PROJECT_CHAT_TERMS =
  'epic epics orchestrator project chat talk ask conversation conversations idea intake discuss advice new chat'

/**
 * Whether the palette shows the project chat's row for `q` (already
 * trimmed+lowercased). Substring-of-haystack — the query is the needle, so a
 * partial word still finds it — and an empty query shows the row
 * unconditionally, because the palette opens on its whole hand (decision 12).
 */
export function matchesProjectChat(q: string): boolean {
  return q === '' || PROJECT_CHAT_TERMS.includes(q)
}

