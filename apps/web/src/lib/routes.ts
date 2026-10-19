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
 * overlays — the ⌘K palette, Settings, DocPeek, the Draft form, the read-only
 * phase pin — are deliberately *not* representable here. They stay out of the
 * URL and out of history, so Back never means "close the popup".
 */

/** The views a feature page switches between with its topbar tabs. */
export type FeatureView = 'overview' | 'chat'

/**
 * The feature views that carry a path segment of their own
 * (one-chat-layout-everywhere decision 8). Overview is the feature's bare path.
 */
export type FeatureTab = Exclude<FeatureView, 'overview'>

const FEATURE_TABS: readonly FeatureTab[] = ['chat']

/** The path segment and remembered value the Tickets tab had before it was retired. */
export const RETIRED_TICKETS_TAB = 'tickets'

function isFeatureTab(segment: string): segment is FeatureTab {
  return (FEATURE_TABS as readonly string[]).includes(segment)
}

/** Everywhere the app can be, in a form that survives a reload. */
export type AppLocation =
  /** The portfolio home — every open project as a card. */
  | { kind: 'home' }
  /** A project, landing on its restored feature (or its home). */
  | { kind: 'project'; projectId: string }
  /** A feature inside a project, addressed by slug; no `tab` is its Overview. */
  | { kind: 'feature'; projectId: string; featureSlug: string; tab?: FeatureTab }
  /** A project's conversation. */
  | { kind: 'chat'; projectId: string }
  /** A project's preparation. */
  | { kind: 'prepare'; projectId: string }
  /**
   * A project's map: its overview, or one group by id (`checkout/coupons`),
   * whose `/` separates the path's segments.
   */
  | { kind: 'map'; projectId: string; group?: string }

/** The view a feature location names — its tab, or Overview for none. */
export function featureViewOf(location: { tab?: FeatureTab }): FeatureView {
  return location.tab ?? 'overview'
}

/** The project a location is inside, or null for the portfolio home. */
export function projectIdOf(location: AppLocation): string | null {
  return location.kind === 'home' ? null : location.projectId
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
    case 'prepare':
      return `${project}/prepare`
    case 'map': {
      const map = `${project}/map`
      if (!location.group) return map
      return `${map}/${location.group.split('/').map(encodeURIComponent).join('/')}`
    }
    case 'feature': {
      const feature = `${project}/f/${encodeURIComponent(location.featureSlug)}`
      return location.tab ? `${feature}/${location.tab}` : feature
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
  if (parts.length === 3 && parts[2] === 'prepare') return { kind: 'prepare', projectId }
  // The map's tree is two levels deep, so a group is at most two segments.
  if (parts[2] === 'map' && parts.length <= 5) {
    const group = parts.slice(3).join('/')
    return group ? { kind: 'map', projectId, group } : { kind: 'map', projectId }
  }
  if (parts.length === 4 && parts[2] === 'f' && parts[3]) {
    return { kind: 'feature', projectId, featureSlug: parts[3] }
  }
  const tab = parts[4]
  if (parts.length === 5 && parts[2] === 'f' && parts[3] && tab && isFeatureTab(tab)) {
    return { kind: 'feature', projectId, featureSlug: parts[3], tab }
  }
  // The retired Tickets tab: its links land on the Overview, which shows the
  // tickets in every phase that has them.
  if (parts.length === 5 && parts[2] === 'f' && parts[3] && tab === RETIRED_TICKETS_TAB) {
    return { kind: 'feature', projectId, featureSlug: parts[3] }
  }
  return null
}

/**
 * The addressable places *inside* a project — everything the in-project state
 * machine can be pointed at. A bare `/p/<id>` is deliberately not one of them:
 * it names the project and leaves where to land inside it to be decided.
 */
export type InProjectLocation = Extract<
  AppLocation,
  { kind: 'feature' | 'chat' | 'prepare' | 'map' }
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
  /** The map is open, on its overview (`group: null`) or one group; null or omitted when not. */
  map?: { group: string | null } | null
  projectSelected: boolean
  /** The selected feature's slug, or null when none is selected. */
  featureSlug: string | null
  /** The selected feature's view; Overview when omitted. */
  featureView?: FeatureView
}): AppLocation {
  const { projectId, featureView = 'overview' } = state
  if (state.preparing) return { kind: 'prepare', projectId }
  if (state.map) {
    return state.map.group
      ? { kind: 'map', projectId, group: state.map.group }
      : { kind: 'map', projectId }
  }
  if (state.projectSelected) return { kind: 'chat', projectId }
  if (state.featureSlug) {
    const feature = { kind: 'feature', projectId, featureSlug: state.featureSlug } as const
    return featureView === 'overview' ? feature : { ...feature, tab: featureView }
  }
  return { kind: 'project', projectId }
}
