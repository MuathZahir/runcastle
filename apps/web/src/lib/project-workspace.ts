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
export type WorkspaceView = 'create' | 'prepare' | 'project' | 'feature' | 'empty'

/**
 * The workspace body's one selector. A creation form owns the body outright;
 * then an explicitly opened preparation; then the pinned project row over the
 * selected feature.
 *
 * The last line is the interesting one. A project with no features and no
 * preparation has exactly ONE sensible next step, so it gets the whole body
 * rather than a card tucked under the new-feature buttons — which is where
 * preparation was, and why nobody found it. Once features exist the rail's
 * pinned nudge carries it instead and the home reads normally again.
 */
export function workspaceView(state: {
  creating: boolean
  preparing: boolean
  projectSelected: boolean
  selectedFeatureId: string | null
  featureCount: number
  prepared: boolean
}): WorkspaceView {
  if (state.creating) return 'create'
  if (state.preparing) return 'prepare'
  if (state.projectSelected) return 'project'
  if (state.selectedFeatureId) return 'feature'
  return state.featureCount === 0 && !state.prepared ? 'prepare' : 'empty'
}

/**
 * Whether the Inspector rail renders. Every panel in it is feature-scoped, so it
 * belongs to exactly one view — the project workspace hides it entirely rather
 * than showing panels about a feature you are not looking at.
 */
export function showsInspector(view: WorkspaceView, inspectorCollapsed: boolean): boolean {
  return view === 'feature' && !inspectorCollapsed
}

/**
 * What the palette's Preparation row answers to. Every word someone might type
 * looking for preparation, including the ones they type looking for it a SECOND
 * time — "re-prepare", "redo", "re-run" all missed, which is how a finished
 * preparation became unreachable for anyone who had not memorised the noun.
 *
 * 'talk'/'ask' are here because the conversation is reached THROUGH this row:
 * the palette navigates, it never launches sessions, so searching for the
 * conversation has to land you where its button is.
 */
const PREPARATION_TERMS =
  'preparation prepare re-prepare reprepare redo re-run rerun again findings evidence stale project commands baseline talk ask secrets database'

/**
 * Whether the palette shows Preparation for `q` (already trimmed+lowercased).
 * Substring-of-haystack, matching every other action row in the palette — the
 * query is the needle, so a partial word still finds it.
 */
export function matchesPreparation(q: string): boolean {
  return PREPARATION_TERMS.includes(q)
}

/**
 * The rail foot's preparation row. `todo` before a preparation has run, `done`
 * after — never absent.
 *
 * The row used to be a boolean nudge that vanished the moment preparation
 * completed, and `prepared` is monotonic, so completing it once removed both
 * preparation surfaces at the same instant and nothing represented a *finished*
 * preparation. Findings went on rotting where only the settings overlay
 * mentioned them, under a tooltip that said "re-prepare to refresh it" while
 * offering no way to. A permanent resident costs one quiet row and answers both
 * questions the vanishing one could not: what was established, and how to do it
 * again.
 */
export interface PrepRailRow {
  /** Never prepared (`todo`), or a preparation has been through it (`done`). */
  variant: 'todo' | 'done'
  /** Prepared keys still unset. */
  count: number
  /** Established findings whose measurements have drifted out of date. */
  stale: number
  /** The row's one line of copy. */
  label: string
  /** The number beside it: what is unanswered before, what has drifted after. */
  badge: string | null
  /** Why the row is there, spelled out on hover. */
  title: string
}

/**
 * The row, or `null` only while the prep view is still in flight — the two
 * variants read as opposites, so guessing one before the answer lands would
 * flash the wrong sentence on every first paint.
 */
export function prepRailRow(
  view: { prepared: boolean; pendingCount: number; staleCount: number } | null | undefined,
): PrepRailRow | null {
  if (!view) return null
  const { prepared, pendingCount, staleCount } = view
  // Unprepared, the number is the size of the job. Prepared, the job is done and
  // the only number worth interrupting for is what has since gone out of date.
  if (!prepared)
    return {
      variant: 'todo',
      count: pendingCount,
      stale: staleCount,
      label: 'Prepare this project',
      // A bare number said nothing — a rail badge reading "8" beside "Prepare
      // this project" was read as a count of anything at all (findings F17.5).
      badge: pendingCount > 0 ? `${pendingCount} to establish` : null,
      title: `${pendingCount} repo fact${pendingCount === 1 ? '' : 's'} nobody has established yet — how to install, how to verify, what is already red`,
    }
  return {
    variant: 'done',
    count: pendingCount,
    stale: staleCount,
    label: 'Re-prepare the project',
    badge: staleCount > 0 ? `${staleCount} stale` : null,
    title:
      staleCount > 0
        ? `${staleCount} established fact${staleCount === 1 ? ' has' : 's have'} not been re-measured in a long time`
        : "See what was established about this repo, or establish it again",
  }
}
