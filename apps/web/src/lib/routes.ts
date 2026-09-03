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
 * overlays — the ⌘K palette, Settings, DocPeek, the Quick form, the read-only
 * phase pin — are deliberately *not* representable here. They stay out of the
 * URL and out of history, so Back never means "close the popup".
 */

/** Everywhere the app can be, in a form that survives a reload. */
export type AppLocation =
  /** The portfolio home — every open project as a card. */
  | { kind: 'home' }
  /** A project, landing on its restored feature (or its home). */
  | { kind: 'project'; projectId: string }
  /** A feature inside a project, addressed by slug. */
  | { kind: 'feature'; projectId: string; featureSlug: string }
  /** A project's conversation. */
  | { kind: 'chat'; projectId: string }
  /** A project's preparation. */
  | { kind: 'prepare'; projectId: string }

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
    case 'feature':
      return `${project}/f/${encodeURIComponent(location.featureSlug)}`
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
  if (parts.length === 4 && parts[2] === 'f' && parts[3]) {
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
  { kind: 'feature' | 'chat' | 'prepare' }
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
 * address: the Quick overlay (transient, decision 1) and the automatic
 * preparation a featureless unprepared project gets, which is that project's
 * home rather than somewhere you navigated to.
 */
export function locationFor(state: {
  projectId: string
  /** Preparation was opened deliberately — the persisted per-project flag. */
  preparing: boolean
  projectSelected: boolean
  /** The selected feature's slug, or null when none is selected. */
  featureSlug: string | null
}): AppLocation {
  const { projectId } = state
  if (state.preparing) return { kind: 'prepare', projectId }
  if (state.projectSelected) return { kind: 'chat', projectId }
  if (state.featureSlug) return { kind: 'feature', projectId, featureSlug: state.featureSlug }
  return { kind: 'project', projectId }
}
