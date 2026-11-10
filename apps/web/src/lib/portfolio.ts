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
 * them. "Running" is {@link projectStats}' rule: workers at work.
 *
 * Pure: no react, no trpc.
 */

/** A feature waiting on the human, with the short words that say why. */
export interface WaitingFeature {
  feature: FeatureListItem
  /** The need's first phrase ("Plan to approve", "Needs your answer"). */
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

/** A need's words up to its first " · " — the reason, without its detail. */
export function needWords(label: string): string {
  return label.split(' · ')[0]!
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
      return n ? [{ feature, words: needWords(n.label) }] : []
    })
    const running = features.filter((f) => f.workersWorking > 0)
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

/** "JanaLearn_Updated" → "JL", "runcastle-demo" → "RD", "runcastle" → "R" (the rail's rule). */
export function projectInitials(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return (words[0]?.[0] ?? '?').toUpperCase()
}
