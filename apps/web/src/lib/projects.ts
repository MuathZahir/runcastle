import type { FeatureListItem, Project } from './api'

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

/** Total runs in flight across every open project (the titlebar runs pill). */
export function aggregateRuns(stats: ProjectStats[]): number {
  return stats.reduce((n, s) => n + s.activeRuns, 0)
}

/**
 * The inline failure the open-a-project form shows, from the server's error.
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
