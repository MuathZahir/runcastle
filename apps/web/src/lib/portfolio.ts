import type { FeatureListItem, Project } from './api'
import { needsMe } from './feature-ui/sidebar'
import { projectStats, type ProjectStats } from './projects'

/**
 * What the All projects page shows for each open project
 * (a-better-way-to-move-between-projects, decision 4): a card for a project
 * with something waiting on the human or running, one line for a quiet one,
 * all in the order the projects are given (the rail's order — never re-sorted
 * here).
 *
 * "Waiting" is the sidebar's own Needs-you rule ({@link needsMe}), the one the
 * tab-title count and the rail's dot use, so the page can never disagree with
 * them. "Running" is {@link projectStats}' rule: an agent works on it.
 *
 * Pure: no react, no trpc.
 */

/** A feature waiting on the human, with the short words that say why. */
export interface WaitingFeature {
  feature: FeatureListItem
  /** The agent's line: why it needs the human. */
  words: string
}

export interface PortfolioEntry {
  project: Project
  /** A card (something waits or runs) or a quiet line. */
  kind: 'card' | 'line'
  stats: ProjectStats
  /** What waits on the human, in the feature list's order. */
  waiting: WaitingFeature[]
  /** What runs. */
  running: FeatureListItem[]
  /** The project's feature list has not answered yet. */
  loading: boolean
}

/**
 * One entry per project, in the given order. `lists[i]` is project i's
 * feature list, `undefined` while it loads (a loading project is a quiet line
 * until it says otherwise).
 */
export function portfolioEntries(
  projects: Project[],
  lists: Array<FeatureListItem[] | undefined>,
): PortfolioEntry[] {
  return projects.map((project, i) => {
    const features = lists[i] ?? []
    const waiting = features.flatMap((feature) => {
      const n = needsMe(feature)
      return n ? [{ feature, words: n.why }] : []
    })
    const running = features.filter((f) => f.working)
    return {
      project,
      kind: waiting.length > 0 || running.length > 0 ? 'card' : 'line',
      stats: projectStats(features),
      waiting,
      running,
      loading: lists[i] === undefined,
    }
  })
}

/** How many waiting features a card lists before "and N more". */
export const CARD_WAITING_MAX = 3

/**
 * What a card lists: up to three waiting features, how many more wait, and —
 * only where nothing waits — up to three running ones, so the amber lines stay
 * the card's one colour and the running count sits in its foot.
 */
export function cardLines(entry: Pick<PortfolioEntry, 'waiting' | 'running'>): {
  waiting: WaitingFeature[]
  moreWaiting: number
  running: FeatureListItem[]
} {
  return {
    waiting: entry.waiting.slice(0, CARD_WAITING_MAX),
    moreWaiting: Math.max(0, entry.waiting.length - CARD_WAITING_MAX),
    running: entry.waiting.length === 0 ? entry.running.slice(0, CARD_WAITING_MAX) : [],
  }
}

/** The page header's totals across every project. */
export function portfolioTotals(entries: PortfolioEntry[]): { projects: number; running: number; waiting: number } {
  return {
    projects: entries.length,
    running: entries.reduce((n, e) => n + e.stats.working, 0),
    waiting: entries.reduce((n, e) => n + e.stats.needsYou, 0),
  }
}
