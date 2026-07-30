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
export type AppView = 'home' | 'project' | 'open'

/**
 * Where the app lands given the currently open projects (acceptance criteria):
 * none → the open-a-project flow (fresh install); exactly one → straight into
 * it; more than one → the portfolio home.
 */
export function initialView(projects: Project[]): { view: AppView; projectId: string | null } {
  if (projects.length === 0) return { view: 'open', projectId: null }
  if (projects.length === 1) return { view: 'project', projectId: projects[0].id }
  return { view: 'home', projectId: null }
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
  message: string
  /** What to do about it, when the failure has a known remedy. */
  hint: string | null
  /** Offering `git init` on this path would be the fix. */
  offerGitInit: boolean
}

export function repoOpenFailure(message: string, path: string): RepoOpenFailure {
  const where = path.trim() || 'that folder'
  if (/not a git repository/i.test(message)) {
    return {
      message,
      hint: `runcastle tracks work as branches, so it needs a git repository. Run \`git init\` in ${where}, or pick a folder that already is one.`,
      offerGitInit: true,
    }
  }
  if (/does not exist|cannot read/i.test(message)) {
    return {
      message,
      hint: 'Check the path, or use Browse… to find the folder.',
      offerGitInit: false,
    }
  }
  return { message, hint: null, offerGitInit: false }
}
