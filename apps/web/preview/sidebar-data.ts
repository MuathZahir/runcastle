import type { FeatureListItem } from '../src/lib/api'
import { listItem } from '../test/fixtures'

/**
 * A busy project's features, one or more in every lane the sidebar draws:
 * waiting on you (a chat awaiting input, a question, ready to test), agents at work,
 * work in progress, drafts (one waiting on another), a long shipped tail and a
 * few archived.
 */

const now = Date.now()
const MIN = 60_000

let n = 0
function f(title: string, over: Partial<FeatureListItem> = {}): FeatureListItem {
  n += 1
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  // Older the further down the list, as the server's newest-first order has it.
  const lastActivityAt = now - n * n * 7 * MIN
  return {
    ...listItem({ id: `feat_${n}`, slug, lastActivityAt, ...over }),
    branch: `feature/${slug}`,
    title,
    ...over,
  } as FeatureListItem
}

const tickets = (total: number, done: number, failed = 0) => ({
  total,
  pending: total - done - failed,
  burning: 0,
  done,
  failed,
  cancelled: 0,
})

export const busyFeatures: FeatureListItem[] = [
  f('Sidebar refresh', { liveSession: { status: 'live', awaitingInput: true } }),
  f('Rounds see blockers outside the round', {
    ticketCounts: tickets(4, 3, 1),
    waitingReason: 'which retry policy should rounds use?',
  }),
  f('Changelog file per release', { ticketCounts: tickets(5, 5), waitingReason: 'ready to test' }),
  f('Prepare reruns stale checks', {
    activeRun: true,
    orchestrated: true,
    ticketCounts: tickets(7, 3),
  } as Partial<FeatureListItem>),
  f('Note capture keeps drafts', { liveSession: { status: 'live', awaitingInput: false } }),
  f('Scenario fixtures for drives', { ticketCounts: tickets(6, 4) }),
  f('Dark terminal palette', { status: 'draft' }),
  f('Portfolio search', {
    status: 'draft',
    dependsOn: [
      {
        featureId: 'feat_x',
        slug: 'scenario-fixtures-for-drives',
        title: 'Scenario fixtures for drives',
        status: 'active',
        satisfied: false,
      },
    ],
  }),
  f('Export a feature as PDF', { status: 'draft' }),
  ...[
    'Rounds dispatch in parallel',
    'Burn cache warm start',
    'Drive setup scripts',
    'Project notes inbox',
    'Command palette jumps',
    'Feature page is chat-first',
    'Review evidence walkthrough',
    'Merge dialog shows the delta',
    'Lap trail on the feature page',
    'Codex runtime',
    'Settings: models and annotations',
    'First-run wizard',
  ].map((t) => f(t, { status: 'shipped' })),
  ...['Storybook previews', 'Violet theme', 'Two-line sidebar rows'].map((t) => f(t, { status: 'archived' })),
]

/** A quiet day: nothing waits on you, one agent at work, a short shipped tail. */
export const quietFeatures: FeatureListItem[] = busyFeatures.filter((x) =>
  [
    'Prepare reruns stale checks',
    'Scenario fixtures for drives',
    'Dark terminal palette',
    'Rounds dispatch in parallel',
    'Burn cache warm start',
    'Drive setup scripts',
  ].includes(x.title),
)

/** The row the previews show as open. */
export const SELECTED_TITLE = 'Scenario fixtures for drives'
