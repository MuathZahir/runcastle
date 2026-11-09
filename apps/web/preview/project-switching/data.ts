import type { FeatureListItem } from '../../src/lib/api'
import { needsMe } from '../../src/lib/feature-ui/sidebar'
import { projectStats, type ProjectStats } from '../../src/lib/projects'
import { listItem, need } from '../../test/fixtures'

/**
 * Sample projects for the project-switching design pages
 * (docs/features/a-better-way-to-move-between-projects). Made up, no backend:
 * each project carries its own feature list, and the needs-you and running
 * counts are worked out from it by the app's own rules (`projectStats`), so a
 * tile's badge can never disagree with the sidebar beneath it.
 */

export interface MockProject {
  id: string
  name: string
  repoPath: string
  features: FeatureListItem[]
}

export type SampleKey = 'busy' | 'quiet' | 'many'

const MIN = 60_000
const now = Date.now()

let seq = 0
function feat(pid: string, title: string, over: Partial<FeatureListItem> = {}): FeatureListItem {
  seq += 1
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return { ...listItem({ id: `${pid}_${seq}`, slug, lastActivityAt: now - seq * 7 * MIN, ...over }), projectId: pid, title }
}

const waits = (pid: string, title: string, kind: Parameters<typeof need>[0], words: string, ago = 12) =>
  feat(pid, title, { need: need(kind, words, { since: now - ago * MIN }), leadAwaitsHuman: true })

const runs = (pid: string, title: string, workers = 1, counted = 5, landed = 2) =>
  feat(pid, title, { workersWorking: workers, workerProgress: { counted, landed } })

const draft = (pid: string, title: string) => feat(pid, title, { status: 'draft' })
const shipped = (pid: string, title: string) => feat(pid, title, { status: 'shipped' })
const idle = (pid: string, title: string) => feat(pid, title)

interface Seed {
  name: string
  repo: string
  /** Its features when the portfolio is busy, and when it is quiet. */
  busy: (pid: string) => FeatureListItem[]
  quiet: (pid: string) => FeatureListItem[]
}

const shelf = (pid: string, drafts: string[], done: string[]) => [
  ...drafts.map((t) => draft(pid, t)),
  ...done.map((t) => shipped(pid, t)),
]

const SEEDS: Seed[] = [
  {
    name: 'runcastle',
    repo: '~/projects/runcastle',
    busy: (p) => [
      waits(p, 'Voice notes in the chat', 'plan', 'Plan to approve', 6),
      waits(p, 'Phone push for finished drives', 'answer', 'Needs your answer · Which sound plays?', 25),
      runs(p, 'Faster sandbox start', 2, 6, 3),
      runs(p, 'Drive recordings', 1, 4, 1),
      runs(p, 'Search inside settings', 1, 3, 0),
      idle(p, 'A better way to move between projects'),
      ...shelf(p, ['Dark mode for the website', 'Export a feature as PDF', 'Keyboard map page'], [
        'Clicking a feature opens its lead',
        'Active threads in the sidebar',
        'Review by default',
        'Phone setup screen',
        'Burn cache',
        'Drive scenarios',
      ]),
    ],
    quiet: (p) => [
      idle(p, 'A better way to move between projects'),
      ...shelf(p, ['Dark mode for the website', 'Export a feature as PDF', 'Keyboard map page'], [
        'Voice notes in the chat',
        'Faster sandbox start',
        'Clicking a feature opens its lead',
        'Active threads in the sidebar',
        'Review by default',
      ]),
    ],
  },
  {
    name: 'clawflow',
    repo: '~/projects/clawflow',
    busy: (p) => [runs(p, 'Retry failed webhooks', 1, 4, 2), ...shelf(p, ['Slack digest'], ['Cron editor', 'Run history page'])],
    quiet: (p) => shelf(p, ['Slack digest'], ['Retry failed webhooks', 'Cron editor', 'Run history page']),
  },
  {
    name: 'JanaLearn_Updated',
    repo: '~/work/JanaLearn_Updated',
    busy: (p) => [
      waits(p, 'Lesson streaks', 'test', 'Ready to test · Streak resets at midnight', 40),
      ...shelf(p, ['Teacher dashboard', 'Arabic voice-over'], ['Quiz timer', 'Parent sign-in']),
    ],
    quiet: (p) => shelf(p, ['Teacher dashboard', 'Arabic voice-over'], ['Lesson streaks', 'Quiz timer', 'Parent sign-in']),
  },
  {
    name: 'runcastle-demo',
    repo: '~/projects/runcastle-demo',
    busy: (p) => shelf(p, ['Seed data refresh'], ['Todo list app', 'Login page']),
    quiet: (p) => shelf(p, ['Seed data refresh'], ['Todo list app', 'Login page']),
  },
  {
    name: 'terminal-wait-game',
    repo: '~/fun/terminal-wait-game',
    busy: (p) => shelf(p, [], ['Snake while you wait', 'High scores']),
    quiet: (p) => shelf(p, [], ['Snake while you wait', 'High scores']),
  },
  {
    name: 'jev-browser-extension',
    repo: '~/work/jev-browser-extension',
    busy: (p) => shelf(p, ['Firefox build'], ['Popup redesign']),
    quiet: (p) => shelf(p, ['Firefox build'], ['Popup redesign']),
  },
  {
    name: 'jewellery-system',
    repo: '~/clients/jewellery-system',
    busy: (p) => shelf(p, ['Gold price feed'], ['Invoice print', 'Stock count']),
    quiet: (p) => shelf(p, ['Gold price feed'], ['Invoice print', 'Stock count']),
  },
]

/** The seven more a long portfolio adds; two of them are not quiet. */
const MORE: Seed[] = [
  {
    name: 'invoice-parser',
    repo: '~/work/invoice-parser',
    busy: (p) => [waits(p, 'Read scanned PDFs', 'design', 'Design to approve', 90), ...shelf(p, [], ['CSV export'])],
    quiet: (p) => shelf(p, [], ['CSV export']),
  },
  {
    name: 'homelab-dashboard',
    repo: '~/fun/homelab-dashboard',
    busy: (p) => [runs(p, 'Disk health panel', 1, 3, 1), ...shelf(p, [], ['Uptime chart'])],
    quiet: (p) => shelf(p, [], ['Uptime chart']),
  },
  { name: 'recipe-scaler', repo: '~/fun/recipe-scaler', busy: (p) => shelf(p, ['Metric units'], []), quiet: (p) => shelf(p, ['Metric units'], []) },
  { name: 'pdf-annotator', repo: '~/work/pdf-annotator', busy: (p) => shelf(p, [], ['Highlights']), quiet: (p) => shelf(p, [], ['Highlights']) },
  { name: 'portfolio-site', repo: '~/projects/portfolio-site', busy: (p) => shelf(p, [], ['Blog']), quiet: (p) => shelf(p, [], ['Blog']) },
  { name: 'mlNotebookSync', repo: '~/work/mlNotebookSync', busy: (p) => shelf(p, ['Conflict view'], []), quiet: (p) => shelf(p, ['Conflict view'], []) },
  { name: 'family-photos', repo: '~/home/family-photos', busy: (p) => shelf(p, [], ['Face groups']), quiet: (p) => shelf(p, [], ['Face groups']) },
]

const idOf = (name: string) => `proj_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`

/** The projects for a sample, in their fixed rail order. */
export function projectsFor(sample: SampleKey): MockProject[] {
  const seeds = sample === 'many' ? [...SEEDS, ...MORE] : SEEDS
  return seeds.map((s) => {
    const id = idOf(s.name)
    return { id, name: s.name, repoPath: s.repo, features: sample === 'quiet' ? s.quiet(id) : s.busy(id) }
  })
}

export const statsOf = (p: MockProject): ProjectStats => projectStats(p.features)

/** The features that need the human, with the words that say why. */
export function waitingIn(p: MockProject): Array<{ f: FeatureListItem; words: string }> {
  return p.features.flatMap((f) => {
    const n = needsMe(f)
    return n ? [{ f, words: n.label }] : []
  })
}

/** The features with workers at work. */
export const runningIn = (p: MockProject) => p.features.filter((f) => f.workersWorking > 0)

/** Needs-you first, then running, then the rest, keeping the given order within each. */
export function byUrgency(projects: MockProject[]): MockProject[] {
  const rank = (p: MockProject) => {
    const s = statsOf(p)
    return s.needsYou > 0 ? 0 : s.working > 0 ? 1 : 2
  }
  return [...projects].sort((a, b) => rank(a) - rank(b))
}
