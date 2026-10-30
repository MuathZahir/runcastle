import { isPanelView, panelViewOf, type PanelView } from './feature-ui/panel'

/**
 * The URL as a projection of the navigation state machine (decision 1).
 *
 * The app has no router library and does not want one: `use-project-nav` and
 * `workspace` already own navigation, and the body view derives from
 * precedence-ordered flags rather than a route hierarchy. What was missing was
 * an *address* — Back exited the app and nothing was linkable. So the location
 * gets a canonical string form, and a thin history layer
 * ({@link ./use-history-sync}) keeps the address bar and the state machine
 * agreeing in both directions.
 *
 * This module is the pure half: format and parse, no DOM, no react. Transient
 * overlays — the ⌘K palette, Settings, the Draft form, the read-only
 * phase pin — are deliberately *not* representable here. They stay out of the
 * URL and out of history, so Back never means "close the popup".
 */

/**
 * What a feature page shows beside its chat (design-mode decision 5): one
 * panel view, or `chat` for the chat alone with the panel closed.
 */
export type FeatureView = PanelView | 'chat'

/**
 * The feature views that carry a path segment of their own. Work is the
 * feature's bare path — the old Overview link, which showed the phase body the
 * Work view replaced — and `chat`, the old Chat tab's segment, is the chat alone.
 */
export type FeatureSegment = Exclude<FeatureView, 'work'>

/** The path segment and remembered value the Tickets tab had before it was retired. */
export const RETIRED_TICKETS_TAB = 'tickets'

/** The remembered value the Overview tab had, before the body moved into the panel. */
export const RETIRED_OVERVIEW_TAB = 'overview'

function isFeatureSegment(segment: string): segment is FeatureSegment {
  return segment === 'chat' || (segment !== 'work' && isPanelView(segment))
}

/**
 * A feature view read from a path segment or from storage: the retired tabs
 * land on Work, and the retired panel views on the fixed view each became
 * (`body` on Work, `preview` on Plan).
 */
export function parseFeatureView(value: string | null): FeatureView | null {
  if (value === null) return null
  if (value === RETIRED_TICKETS_TAB || value === RETIRED_OVERVIEW_TAB) return 'work'
  return value === 'chat' ? value : panelViewOf(value)
}

/** Everywhere the app can be, in a form that survives a reload. */
export type AppLocation =
  /** The portfolio home — every open project as a card. */
  | { kind: 'home' }
  /** A project, landing on its restored feature (or its home). */
  | { kind: 'project'; projectId: string }
  /**
   * A feature inside a project, addressed by slug; no `view` is its Work view.
   * `namesWork` marks an address that says Work out loud (`/work`, or a retired
   * tab that became it): a bare path restores the remembered view on landing,
   * this one does not.
   */
  | { kind: 'feature'; projectId: string; featureSlug: string; view?: FeatureSegment; namesWork?: true }
  /** A project's conversation: the Orchestrator, on its latest chat. */
  | { kind: 'chat'; projectId: string }
  /** Every conversation the project has had. */
  | { kind: 'conversations'; projectId: string }
  /** A project's preparation. */
  | { kind: 'prepare'; projectId: string }

/** The view a feature location names — its segment, or Work for none. */
export function featureViewOf(location: { view?: FeatureSegment }): FeatureView {
  return location.view ?? 'work'
}

/** The project a location is inside, or null for the portfolio home. */
export function projectIdOf(location: AppLocation): string | null {
  return location.kind === 'home' ? null : location.projectId
}

/**
 * The view a feature address insists on when the app lands on it, or undefined
 * for a bare path, which leaves it to what the browser remembers.
 */
export function addressedView(location: { view?: FeatureSegment; namesWork?: true }): FeatureView | undefined {
  return location.namesWork ? 'work' : location.view
}

/** Whether two locations are one page, whatever view of it each names: a feature's views share its chat column. */
export function samePage(a: AppLocation | null, b: AppLocation): boolean {
  if (!a || a.kind !== b.kind || projectIdOf(a) !== projectIdOf(b)) return false
  return a.kind !== 'feature' || (b.kind === 'feature' && a.featureSlug === b.featureSlug)
}

/** The canonical path for a location. Always absolute, never trailing-slashed. */
export function pathFor(location: AppLocation): string {
  if (location.kind === 'home') return '/'
  const project = `/p/${encodeURIComponent(location.projectId)}`
  switch (location.kind) {
    case 'project':
      return project
    case 'chat':
      return `${project}/chat`
    case 'conversations':
      return `${project}/conversations`
    case 'prepare':
      return `${project}/prepare`
    case 'feature': {
      const feature = `${project}/f/${encodeURIComponent(location.featureSlug)}`
      return location.view ? `${feature}/${location.view}` : feature
    }
  }
}

/** Path segments, decoded, with empty ones (leading/trailing slashes) dropped. */
function segments(path: string): string[] | null {
  try {
    return path
      .split('/')
      .filter((s) => s.length > 0)
      .map(decodeURIComponent)
  } catch {
    return null // a malformed escape is an unknown path, not a crash
  }
}

/**
 * The location a path names, or `null` for anything this app does not own —
 * a hand-typed URL, a stale bookmark from before the route table existed.
 * Callers treat `null` as "no opinion" and fall back to what they stored.
 */
export function parsePath(path: string): AppLocation | null {
  const parts = segments(path)
  if (!parts) return null
  if (parts.length === 0) return { kind: 'home' }
  if (parts[0] !== 'p') return null

  const projectId = parts[1]
  if (!projectId) return null
  if (parts.length === 2) return { kind: 'project', projectId }
  if (parts.length === 3 && parts[2] === 'chat') return { kind: 'chat', projectId }
  if (parts.length === 3 && parts[2] === 'conversations') return { kind: 'conversations', projectId }
  if (parts.length === 3 && parts[2] === 'prepare') return { kind: 'prepare', projectId }
  if (parts.length === 4 && parts[2] === 'f' && parts[3]) {
    return { kind: 'feature', projectId, featureSlug: parts[3] }
  }
  const segment = parts[4]
  if (parts.length === 5 && parts[2] === 'f' && parts[3] && segment && isFeatureSegment(segment)) {
    return { kind: 'feature', projectId, featureSlug: parts[3], view: segment }
  }
  // The retired Tickets tab, the retired `/body` and a hand-typed `/work` land
  // on Work; the retired `/preview` on Plan.
  const featureSlug = parts[3]
  const retired = parts.length === 5 && parts[2] === 'f' && featureSlug && segment ? parseFeatureView(segment) : null
  if (featureSlug && retired === 'work') return { kind: 'feature', projectId, featureSlug, namesWork: true }
  if (featureSlug && retired === 'plan') return { kind: 'feature', projectId, featureSlug, view: retired }
  return null
}

/**
 * The addressable places *inside* a project — everything the in-project state
 * machine can be pointed at. A bare `/p/<id>` is deliberately not one of them:
 * it names the project and leaves where to land inside it to be decided.
 */
export type InProjectLocation = Extract<
  AppLocation,
  { kind: 'feature' | 'chat' | 'conversations' | 'prepare' }
>

/**
 * The place a location names inside `projectId`, or `null` — for the portfolio
 * home, for a bare project path, and for another project's address, which is
 * the outer navigation's business rather than this project's shell.
 */
export function insideProject(
  location: AppLocation | null,
  projectId: string,
): InProjectLocation | null {
  if (!location || location.kind === 'home' || location.kind === 'project') return null
  return location.projectId === projectId ? location : null
}

/**
 * Where the shell currently *is*, from the in-project navigation flags — the
 * same precedence `workspaceView` applies, minus the two cases that have no
 * address: the Draft overlay (transient, decision 1) and the automatic
 * preparation a featureless unprepared project gets, which is that project's
 * home rather than somewhere you navigated to.
 */
export function locationFor(state: {
  projectId: string
  /** Preparation was opened deliberately — the persisted per-project flag. */
  preparing: boolean
  projectSelected: boolean
  /** The Orchestrator's Conversations page, rather than its chat. */
  conversations?: boolean
  /** The selected feature's slug, or null when none is selected. */
  featureSlug: string | null
  /** The selected feature's view; Work when omitted. */
  featureView?: FeatureView
}): AppLocation {
  const { projectId, featureView = 'work' } = state
  if (state.preparing) return { kind: 'prepare', projectId }
  if (state.projectSelected) return { kind: state.conversations ? 'conversations' : 'chat', projectId }
  if (state.featureSlug) {
    const feature = { kind: 'feature', projectId, featureSlug: state.featureSlug } as const
    return featureView === 'work' ? feature : { ...feature, view: featureView }
  }
  return { kind: 'project', projectId }
}
