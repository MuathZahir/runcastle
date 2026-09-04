import type { FeatureListItem, Project } from './api'
import type { AppLocation } from './routes'

/**
 * Multi-project navigation + portfolio derivations (issue #45).
 *
 * The app is two-level: a portfolio *home* (a card per open project) and the
 * in-project IDE. These pure helpers derive the landing view and the per-project
 * health/runs/needs-you a home card renders. The stateful navigation hook lives
 * in {@link ./use-project-nav} so this module stays IO-free and unit-testable
 * (no react/trpc imports — only erased type imports).
 */

/** Which top-level surface fills the shell. */
export type AppView = 'home' | 'project' | 'open' | 'setup'

/** Where the shell is pointed: a surface, plus the project it is bound to. */
export interface Landing {
  view: AppView
  projectId: string | null
}

/**
 * Where the app lands given the currently open projects (acceptance criteria):
 * none → the open-a-project flow (fresh install); exactly one → straight into
 * it; more than one → the portfolio home.
 */
export function initialView(projects: Project[]): Landing {
  if (projects.length === 0) return { view: 'open', projectId: null }
  if (projects.length === 1) return { view: 'project', projectId: projects[0].id }
  return { view: 'home', projectId: null }
}

/**
 * The navigation a past session left behind (decision 3 — persisted rather than
 * re-derived from project count on every load). The transient open-a-project
 * flow is deliberately not representable: a half-finished create/import is not
 * a place to come back to, so it falls through to {@link initialView}.
 */
export type StoredNav = { view: 'home' } | { view: 'project'; projectId: string }

/**
 * Where the app lands on boot now that navigation is remembered: back in the
 * project the user was last in, or on the chooser if that is where they left
 * off. Everything else — nothing stored, storage corrupted, or a stored project
 * that has since been closed — falls back to the count-based landing rule.
 *
 * Setup outranks all of it (decision 3): while the host still owes us a git
 * identity or a ready coding agent there is nothing useful to do in a project,
 * so an incomplete setup lands on the wizard whatever is open or remembered.
 * It is *only* incomplete setup that does — a finished setup with no projects
 * lands on the plain first-project screen, so closing the last project never
 * replays onboarding.
 */
export function restoredView(
  projects: Project[],
  stored: StoredNav | null,
  setupComplete: boolean,
): Landing {
  if (!setupComplete) return { view: 'setup', projectId: null }
  if (stored?.view === 'project' && projects.some((p) => p.id === stored.projectId)) {
    return { view: 'project', projectId: stored.projectId }
  }
  if (stored?.view === 'home' && projects.length > 0) return { view: 'home', projectId: null }
  return initialView(projects)
}

/**
 * Where the app lands on boot now that locations have URLs (decision 1). Three
 * sources, in order: the address bar, then what the last session stored, then
 * the count-based rule — all outranked by an incomplete setup (the onboarding
 * flow's decision 3): while the host still owes a git identity or a coding
 * agent there is nothing useful behind any address, so the wizard wins even
 * over a URL naming a project.
 *
 * A bare `/` is not an opinion — it is how the app is launched from a bookmark
 * or a fresh window, and it is precisely the case localStorage exists to answer.
 * Only a URL naming a project beats storage, and a URL naming a project that has
 * since been closed falls all the way through rather than dead-ending.
 */
export function launchView(
  projects: Project[],
  url: AppLocation | null,
  stored: StoredNav | null,
  setupComplete: boolean,
): Landing {
  const projectId = url && url.kind !== 'home' ? url.projectId : null
  if (setupComplete && projectId && projects.some((p) => p.id === projectId)) {
    return { view: 'project', projectId }
  }
  return restoredView(projects, stored, setupComplete)
}

/**
 * Where to go when the project list has moved out from under the surface the
 * user is standing on — `null` while that surface still exists.
 *
 * The landing rule only runs on load, so decision 3's promise that the home is
 * never reached with nothing open held for boot and not for the home's own
 * Remove: taking the last card left the user on "Projects (0)", a state no one
 * designed, that a reload would have replaced with the first-project screen. A
 * bound project closed in another window is the same fact — the place underfoot
 * is gone — and both answer with {@link initialView}.
 */
export function replacementLanding(landing: Landing, projects: Project[]): Landing | null {
  const vacated =
    landing.view === 'project'
      ? !projects.some((p) => p.id === landing.projectId)
      : landing.view === 'home' && projects.length === 0
  return vacated ? initialView(projects) : null
}

/**
 * Whether a feature is waiting on a human. Mirrors `needsMe` in feature-ui as a
 * boolean; kept inline (not imported) so this module has no runtime deps and the
 * portfolio derivations stay unit-testable in the workspace's node test env.
 */
function featureNeedsYou(f: FeatureListItem): boolean {
  if (f.status === 'shipped') return false
  if (f.activeRun) return false
  if (f.ticketCounts.failed > 0) return true
  if (f.phase === 'ideation') return true
  if (f.phase === 'tickets' && f.ticketCounts.total > 0) return true
  if (f.phase === 'review') return true
  return false
}

/** Coarse health lens for a portfolio card, most-urgent first. */
export type ProjectHealth = 'attention' | 'working' | 'steady' | 'empty'

export interface ProjectStats {
  total: number
  /** Features waiting on a human (needs-me), excluding those with a live run. */
  needsYou: number
  /** Features with a run in flight. */
  activeRuns: number
  shipped: number
  health: ProjectHealth
}

/**
 * Aggregate a project's feature list into the numbers a home card shows.
 * Health precedence: a human-blocked feature (amber) outranks a live run, which
 * outranks a steady project; a project with no features reads empty.
 */
export function projectStats(features: FeatureListItem[]): ProjectStats {
  const activeRuns = features.filter((f) => f.activeRun).length
  const needsYou = features.filter(featureNeedsYou).length
  const shipped = features.filter((f) => f.status === 'shipped').length
  const total = features.length
  const health: ProjectHealth =
    total === 0
      ? 'empty'
      : needsYou > 0
        ? 'attention'
        : activeRuns > 0
          ? 'working'
          : 'steady'
  return { total, needsYou, activeRuns, shipped, health }
}

/**
 * Runs in flight in projects OTHER than the one being looked at — the titlebar
 * pill's number (decision 7).
 *
 * It used to be the total across every project, which double-counted work the
 * rail's own "Agent working" lane was already itemising by name three inches
 * away, and left the titlebar and the lane disagreeing by whatever this project
 * was running. The one number a frame earns is the work you cannot see from
 * here, so the current project is subtracted and the pill says "elsewhere".
 */
export function runsElsewhere(
  stats: readonly { projectId: string; activeRuns: number }[],
  currentProjectId: string | null,
): number {
  return stats.reduce((n, s) => (s.projectId === currentProjectId ? n : n + s.activeRuns), 0)
}

/**
 * The repo's folder name — the last segment of its path (decision 8).
 *
 * Two projects can carry the same name, and the switcher's rows are then
 * indistinguishable; the folder the repo actually lives in is what tells them
 * apart. Written here rather than with `node:path` because this runs in the
 * browser, and it answers for both separators because the path is the *server's*
 * and may be a Windows one however the browser is running.
 */
export function repoFolderName(repoPath: string): string {
  const trimmed = withoutTrailingSeparators(repoPath)
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut < 0 ? trimmed : trimmed.slice(cut + 1)
}

/** A path with any trailing separators dropped, so its last segment is nameable. */
function withoutTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '')
}

/**
 * The inline failure this flow shows about a path — the open-a-project form's
 * rejected repo, and the picker's refused listing.
 *
 * It used to be a bottom-right toast that auto-dismissed six seconds later,
 * fired from the far corner of the screen while the user was still looking at
 * the path field (findings F17.2). The message belongs under the field it is
 * about — and the commonest one of all, "not a git repository", has an obvious
 * next move the toast never mentioned.
 */
export interface RepoOpenFailure {
  /** The problem, said once and in full — never with the path spliced into it. */
  message: string
  /** What to do about it, when the failure has a known remedy. */
  hint: string | null
  /**
   * The rejected path, for the caller to render exactly once (decision 5). The
   * server's message names it too, so a recognised failure is restated as a
   * short statement and the path shown separately — long paths are truncated
   * from the left, which a sentence with one buried in it cannot be.
   */
  path: string | null
}

/** Where the directory picker should browse, and what to keep of what was typed. */
export interface PickerStart {
  /** The directory to list; `undefined` asks the server for the user's home. */
  dir: string | undefined
  /**
   * Whether the path the picker was handed is still worth keeping in the path
   * control's edit value — true when we walked away from it because it was not
   * there, so the user can see and correct what they meant.
   */
  keepTyped: boolean
}

/** Server wordings for "that path is not somewhere I can list" (see fsbrowse). */
const UNBROWSABLE = /does not exist|cannot read/i

/**
 * Where the picker opens when the path it was handed cannot be listed
 * (decision 6).
 *
 * A field holding a half-typed or stale path used to open a dialog that was
 * only an error message: no listing, no crumbs, and a primary button that would
 * happily submit the garbage. Walking one segment up per failure lands on the
 * nearest ancestor that does exist, with home as the floor — every machine has
 * one, and the roots rail is right there for anything above it.
 *
 * Only a missing/unreadable path is fallen back from. Any other failure (a
 * relative path, a permission error the server phrased its own way) is left
 * alone: it is not a claim about *this* directory being the wrong one, and
 * silently browsing somewhere else would hide it.
 */
export function pickerStartDir(
  typed: string | undefined,
  errorMessage: string | undefined,
): PickerStart {
  const path = typed?.trim() || undefined
  if (!path || !errorMessage || !UNBROWSABLE.test(errorMessage)) {
    return { dir: path, keepTyped: false }
  }
  return { dir: parentPath(path), keepTyped: true }
}

/**
 * `path` minus its last segment, on either separator so one helper answers for
 * both platforms, and `undefined` once nothing addressable is left.
 */
function parentPath(path: string): string | undefined {
  const trimmed = withoutTrailingSeparators(path)
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut <= 0) return undefined
  const parent = trimmed.slice(0, cut)
  // `C:` on its own is drive-*relative*, not a directory — keep the separator so
  // the drive root is a real place to land.
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  // A UNC path stripped past its host leaves bare separators, which name nothing.
  return /^[\\/]+$/.test(parent) ? undefined : parent
}

/**
 * The wordings `browseDir` throws, and what the picker says in their place.
 * Each pattern captures the path out of the sentence so it can be shown once,
 * on its own line, truncated from the left — which a sentence with a path
 * buried in the middle of it cannot be.
 */
const BROWSE_FAILURES: { match: RegExp; message: string; hint: string }[] = [
  {
    match: /path does not exist: (.*)$/i,
    message: 'Path does not exist',
    hint: 'Check the path, or pick a folder from the rail.',
  },
  {
    // The server appends the errno in brackets; that is a fact about the
    // filesystem, not about the folder the user asked for.
    match: /cannot read (?:path|directory): (.*?)(?: \(.*\))?$/i,
    message: 'Cannot read that folder',
    hint: 'It may need permissions this machine does not have.',
  },
  {
    match: /path is not absolute: (.*)$/i,
    message: 'Enter an absolute path',
    hint: 'A path from the root of the machine runcastle runs on.',
  },
]

/**
 * What the picker says when a listing fails (decision 5's error style).
 *
 * The dialog used to print the server's sentence into the file pane verbatim —
 * lowercase, unstyled, with the rejected path spliced into it. It is the same
 * condition the open screen states as "Path does not exist", so it is said the
 * same way here.
 */
export function browseFailure(message: string): RepoOpenFailure {
  for (const failure of BROWSE_FAILURES) {
    const hit = failure.match.exec(message)
    if (hit) return { message: failure.message, hint: failure.hint, path: hit[1].trim() || null }
  }
  return { message, hint: null, path: null }
}

export function repoOpenFailure(message: string, path: string): RepoOpenFailure {
  const where = path.trim() || null
  if (/not a git repository/i.test(message)) {
    return {
      message: 'Not a git repository',
      hint: 'runcastle tracks work as branches, so it needs a git repository. Run `git init` there, or pick a folder that already is one.',
      path: where,
    }
  }
  const missing = /does not exist/i.test(message)
  if (missing || /cannot read/i.test(message)) {
    return {
      // A path that is there but unreadable is a different fact from one that
      // is not there at all, and the same advice answers both.
      message: missing ? 'Path does not exist' : 'Cannot read that path',
      hint: 'Check the path, or use Browse… to find the folder.',
      path: where,
    }
  }
  return { message, hint: null, path: null }
}
