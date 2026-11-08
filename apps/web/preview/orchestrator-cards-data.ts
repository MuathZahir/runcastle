import type { FeatureListItem } from '../src/lib/api'
import type { FeatureNeed } from '@runcastle/core'
import type { WorkStep } from '../src/lib/chat-thread'
import type { FeatureActionRow, NewsRow } from '../src/components/chat/thread/FeatureCards'
import { listItem } from '../test/fixtures'

/**
 * Sample data for the orchestrator-actions-show-as-cards preview: the features
 * as the sidebar would read them now, and two chats — the Orchestrator's and a
 * feature's — told as the thread would carry them.
 */

const now = Date.now()
const MIN = 60_000

const tickets = (total: number, done: number) => ({ total, pending: total - done, burning: 0, done, failed: 0, cancelled: 0 })
const need = (kind: FeatureNeed['kind'], words: string): FeatureNeed => ({ kind, words, held: false, since: now - 5 * MIN })

let n = 0
function feature(title: string, over: Partial<FeatureListItem> = {}): FeatureListItem {
  n += 1
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  return { ...listItem({ id: `feat_${n}`, slug, ...over }), branch: `feature/${slug}`, title, ...over } as FeatureListItem
}

export const CARDS = feature('Orchestrator actions show as cards', { need: need('plan', 'Plan to approve') })
export const COMPOSER = feature('Composer remembers the last model', { liveSession: { status: 'live', awaitingInput: false } } as Partial<FeatureListItem>)
export const EMPTY = feature('Empty states speak plainly', { status: 'draft' })
export const KEYS = feature('A keyboard map for the chat', { status: 'draft' })
export const CHANGELOG = feature('Changelog file per release', { status: 'shipped', ticketCounts: tickets(5, 5) })
export const PREPARE = feature('Prepare reruns stale checks', {
  ticketCounts: tickets(7, 7),
  need: need('test', 'Ready to test · Stale checks rerun'),
})
export const BLOCKERS = feature('Rounds see blockers outside the round', {
  ticketCounts: tickets(4, 3),
  need: need('answer', 'Needs your answer · retry the ticket or split it?'),
})
export const PER_PROJECT = feature('Model menu per project', { status: 'draft' })

const call = (id: string, title: string, kind: 'read' | 'other' = 'other') => ({ id, kind, title, status: 'completed' as const })

// ---- the Orchestrator's chat ----

export const ASK_CUT =
  'Cut the chat polish into features: cards for orchestrator actions, the composer remembering the last model, plainer empty states, and a keyboard map. Start the first two and have them plan themselves; park the rest.'

export const CUT_WORK: WorkStep[] = [
  { kind: 'tools', id: 't1', calls: [call('c1', 'mcp__runcastle__get_project_context', 'read')] },
  {
    kind: 'tools',
    id: 't2',
    calls: [
      call('c2', 'mcp__runcastle__create_feature'),
      call('c3', 'mcp__runcastle__create_feature'),
      call('c4', 'mcp__runcastle__create_feature'),
      call('c5', 'mcp__runcastle__create_feature'),
      call('c6', 'mcp__runcastle__plan_feature'),
      call('c7', 'mcp__runcastle__plan_feature'),
    ],
  },
]

export const CUT_ROWS: FeatureActionRow[] = [
  { featureId: CARDS.id, feature: CARDS, title: CARDS.title, actions: ['created', 'planning'] },
  { featureId: COMPOSER.id, feature: COMPOSER, title: COMPOSER.title, actions: ['created', 'planning'] },
  { featureId: EMPTY.id, feature: EMPTY, title: EMPTY.title, actions: ['parked'] },
  { featureId: KEYS.id, feature: KEYS, title: KEYS.title, actions: ['parked'] },
]

export const CUT_ANSWER =
  'Two are planning by themselves now; the other two wait in the backlog until you start them. I will tell you when the plans are in.'

export const PLANS_IN_ROWS: NewsRow[] = [
  { featureId: CARDS.id, feature: CARDS, title: CARDS.title, events: [{ tone: 'done', words: 'Finished planning' }] },
  {
    featureId: COMPOSER.id,
    feature: COMPOSER,
    title: COMPOSER.title,
    events: [
      { tone: 'done', words: 'Finished planning' },
      { tone: 'needsYou', words: 'Waits for you: which model does a new chat start on?' },
    ],
  },
]

export const PLANS_IN_AGENT_TEXT = `[runcastle] orchestrator-actions-show-as-cards finished planning. Read it with get_feature_context({ slug: "orchestrator-actions-show-as-cards" }).
[runcastle] composer-remembers-the-last-model finished planning. Read it with get_feature_context({ slug: "composer-remembers-the-last-model" }).
[runcastle] composer-remembers-the-last-model waits for you: which model does a new chat start on?. Read what it asked with read_feature_chat({ slug: "composer-remembers-the-last-model" }).`

export const PLANS_IN_ANSWER =
  'Both plans are in. The cards plan has 14 decisions and three tickets; its designs wait for your look. The composer one asks which model a new chat should start on: the last one you picked anywhere, or the last one in that project?'

export const ASK_SEND = 'The last one I picked anywhere. And merge the changelog feature, I drove it this morning.'

export const SEND_WORK: WorkStep[] = [
  { kind: 'tools', id: 't3', calls: [call('c8', 'mcp__runcastle__send_to_feature'), call('c9', 'mcp__runcastle__merge_feature')] },
]

export const SEND_ROWS: FeatureActionRow[] = [
  {
    featureId: COMPOSER.id,
    feature: COMPOSER,
    title: COMPOSER.title,
    actions: ['relayed'],
    quote: 'The last one I picked anywhere.',
  },
  { featureId: CHANGELOG.id, feature: CHANGELOG, title: CHANGELOG.title, actions: ['merged'], into: 'main' },
]

export const SEND_ANSWER = 'Passed on, and the changelog is on main. Its two waiting backlog features can start whenever you like.'

export const ROUNDS_ROWS: NewsRow[] = [
  {
    featureId: PREPARE.id,
    feature: PREPARE,
    title: PREPARE.title,
    events: [
      { tone: 'done', words: 'Round 2 finished' },
      { tone: 'done', words: 'Review pass finished' },
      { tone: 'needsYou', words: 'Ready to test' },
    ],
  },
  { featureId: BLOCKERS.id, feature: BLOCKERS, title: BLOCKERS.title, events: [{ tone: 'failed', words: 'Round 3 failed: 1 of 2 tickets landed' }] },
]

export const ROUNDS_AGENT_TEXT = `[runcastle] prepare-reruns-stale-checks round finished (2 tickets landed). Read it with list_tickets({ slug: "prepare-reruns-stale-checks" }).
[runcastle] prepare-reruns-stale-checks review pass (ticket 9) finished. Read it with list_tickets({ slug: "prepare-reruns-stale-checks" }).
[runcastle] prepare-reruns-stale-checks declared ready to test (drive: Stale checks rerun). Read it with get_feature_context({ slug: "prepare-reruns-stale-checks" }).
[runcastle] rounds-see-blockers-outside-the-round round failed (1 of 2 tickets landed). Read it with list_tickets({ slug: "rounds-see-blockers-outside-the-round" }).`

export const ROUNDS_ANSWER =
  'Stale checks is ready for you to drive. The blockers round failed on its second ticket: its agent asks whether to retry it or split it.'

// ---- a feature's chat ----

export const KICKOFF_SUMMARY = 'Started this chat to plan the feature by itself'

export const KICKOFF_AGENT_TEXT = `[runcastle] Proceed with your task: no human is present and nobody will reply to you. Invoke /runcastle:feature and follow its \`references/planning-alone.md\` to plan this feature by yourself in this one run: plan it, design its screens where it adds or reshapes them, do not build it, and end by asking for the human's yes. Feature status: Talking with you; rounds run: 0; tickets: none; latest run: none. Call get_feature_context for the full picture.`

export const PLAN_WORDS = `I planned this without you: **7 decisions**, two to check first (2 and 5). It is **2 tickets** and a review round.

One question decides the rest: which model should a new chat start on, the last one you picked anywhere, or the last one in that project?`

export const RELAYED = 'The last one I picked anywhere.'

export const PARK_WORK: WorkStep[] = [
  { kind: 'tools', id: 't4', calls: [call('c10', 'mcp__runcastle__create_feature')] },
]

export const PARK_ROWS: FeatureActionRow[] = [{ featureId: PER_PROJECT.id, feature: PER_PROJECT, title: PER_PROJECT.title, actions: ['parked'] }]

export const PARK_ANSWER =
  'Recorded: a new chat starts on the last model you picked anywhere. I parked "Model menu per project" in the backlog for later. Say yes to start round 1.'

export const FROM_ORCHESTRATOR =
  'The changelog feature merged and touched the composer footer. Merge main into this branch before round 1, so the tickets fork from it.'

export const AFTER_ORCHESTRATOR = 'Merged main in; no conflicts. The plan still holds.'

export const WHEN = { plans: '42m ago', rounds: '6m ago' }
export const NOW = now
