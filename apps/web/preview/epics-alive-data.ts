import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { Epic, EpicHolder } from '../src/lib/feature-ui/epics'
import type { RailTile } from '../src/lib/project-rail'
import { listItem } from '../test/fixtures'

/**
 * Sample sidebars for /preview/epics-alive.html (epics-that-look-alive): the
 * epics with their colour, icon and shipped count, the shelves, and the
 * project rail's tiles. Each state's epics are listed in the order the list
 * itself sorts them; neighbours wear different colours.
 */

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

let n = 0

function feature(title: string, over: Partial<FeatureListItem> = {}): FeatureListItem {
  n += 1
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  return {
    ...listItem({ id: `feat_${n}`, slug, lastActivityAt: now - n * 9 * MIN, ...over }),
    branch: `feature/${slug}`,
    title,
    ...over,
  } as FeatureListItem
}

function chat(title: string, createdAgo: number, lastAgo: number, state: ThreadEntry['state'] = 'idle'): ThreadEntry {
  n += 1
  return {
    id: `chat_${n}`,
    title,
    role: 'project',
    state,
    createdAt: now - createdAgo,
    updatedAt: now - lastAgo,
    runtime: 'claude-code',
    epicNamed: true,
  }
}

const tickets = (total: number, done: number) => ({ total, pending: total - done, burning: 0, done, failed: 0, cancelled: 0 })

const is = {
  needs: (words: string, kind: 'plan' | 'design' | 'answer' | 'test' | 'merge' = 'plan'): Partial<FeatureListItem> => ({
    need: { kind, words, held: false, since: now - 20 * MIN },
  }),
  lead: (): Partial<FeatureListItem> => ({ liveSession: { status: 'live', awaitingInput: false } }),
  workers: (k: number, total = 6, done = 2): Partial<FeatureListItem> => ({ workersWorking: k, ticketCounts: tickets(total, done) }),
  upNext: (after: string): Partial<FeatureListItem> => ({
    status: 'draft',
    upNext: true,
    dependsOn: [{ featureId: 'feat_dep', slug: after, title: after, status: 'active', upNext: false, satisfied: false }],
  }),
}

const EPIC: EpicHolder = { kind: 'epic' }

export interface Sample {
  epics: Epic[]
  backlog: FeatureListItem[]
  shipped: FeatureListItem[]
  archived: FeatureListItem[]
  /** Every epic the project has: "All N epics". */
  total: number
  /** The epic chat in front, or null. */
  openChat: string | null
}

// ---------------------------------------------------------------------------
// Shelves: Backlog 8, Shipped 207, Archived 5 — the same in every state.
// ---------------------------------------------------------------------------

const SHIPPED_TITLES = [
  'Project rail',
  'Status words tell the truth',
  'Sidebar shows only active chats',
  'Command palette jumps',
  'Owner control in the header',
  'Hand-back button',
  'Tax lines on receipts',
]

function shelves(): Pick<Sample, 'backlog' | 'shipped' | 'archived'> {
  const backlog = [
    'Saved payment methods',
    'Invite a teammate',
    'Dark terminal palette',
    'Export a chat as PDF',
    'Keyboard map',
    'Pin a feature',
    'Weekly digest email',
    'Usage meter',
  ].map((t) => feature(t, { status: 'draft' }))
  const shipped = Array.from({ length: 207 }, (_, i) =>
    feature(SHIPPED_TITLES[i] ?? `Shipped feature ${i + 1}`, { status: 'shipped', lastActivityAt: now - (i + 1) * 5 * HOUR }),
  )
  const archived = ['PayPal checkout', 'Violet theme', 'Slack bridge', 'Inline diffs v1', 'Voice notes'].map((t) =>
    feature(t, { status: 'archived' }),
  )
  return { backlog, shipped, archived }
}

// ---------------------------------------------------------------------------
// The six epics
// ---------------------------------------------------------------------------

/** A working epic with features in motion: the full card. */
function workerHandoff(): Epic {
  return {
    chat: chat('Worker Handoff Visibility', 5 * HOUR, 1 * MIN, 'working'),
    asksAbout: null,
    color: 'teal',
    icon: 'workflow',
    shipped: 2,
    features: [
      { feature: feature('Handoff notes in the chat', is.lead()), holder: EPIC },
      { feature: feature('Worker timeline', is.workers(2, 7, 3)), holder: EPIC },
      { feature: feature('Handoff badge on the card', is.upNext('worker-timeline')), holder: EPIC },
    ],
  }
}

/** A waiting epic, a feature in it needing the human: the full card, amber. */
function agentStatus(): Epic {
  return {
    chat: chat('Agent Status Display', 20 * HOUR, 12 * MIN, 'waiting'),
    asksAbout: 'Status chip in the header',
    color: 'rose',
    icon: 'bot',
    shipped: 4,
    features: [
      { feature: feature('Status chip in the header', is.needs('Design to approve', 'design')), holder: EPIC },
      { feature: feature('Idle timer on rows', is.workers(1, 4, 1)), holder: EPIC },
    ],
  }
}

/** The four at rest, newest first. */
function idleFour(): Epic[] {
  return [
    {
      chat: chat('Onboarding Tour', 40 * MIN, 25 * MIN),
      asksAbout: null,
      color: 'blue',
      icon: 'compass',
      shipped: 0,
      features: [],
    },
    {
      chat: chat('Epic Rail Polish', 9 * HOUR, 2 * HOUR),
      asksAbout: null,
      color: 'violet',
      icon: 'palette',
      shipped: 3,
      features: [],
    },
    {
      chat: chat('Billing Export', 2 * DAY, 1 * DAY),
      asksAbout: null,
      color: 'amber',
      icon: 'credit-card',
      shipped: 12,
      features: [],
    },
    {
      // An epic from before this feature: a colour given in turn, no icon yet (decision 6).
      chat: chat('Runcastle Orchestrator Flow', 4 * DAY, 3 * DAY),
      asksAbout: null,
      color: 'green',
      icon: null,
      shipped: 1,
      features: [],
    },
  ]
}

function mixed(): Sample {
  const epics = [agentStatus(), workerHandoff(), ...idleFour()]
  return { epics, ...shelves(), total: 31, openChat: epics[1]!.chat.id }
}

function allIdle(): Sample {
  const handoff = workerHandoff()
  const status = agentStatus()
  const epics: Epic[] = [
    ...idleFour(),
    { ...handoff, chat: { ...handoff.chat, state: 'idle', updatedAt: now - 6 * HOUR }, features: [], shipped: 5 },
    { ...status, chat: { ...status.chat, state: 'idle', updatedAt: now - 8 * DAY }, asksAbout: null, features: [], shipped: 7 },
  ]
  return { epics, ...shelves(), total: 31, openChat: epics[1]!.chat.id }
}

/** The picker opens from the epic's menu, so that epic is the one in front. */
function picker(): Sample {
  const s = mixed()
  return { ...s, openChat: s.epics.find((e) => e.chat.title === 'Epic Rail Polish')!.chat.id }
}

function newEpic(): Sample {
  return { ...mixed(), openChat: null }
}

export type StateKey = 'mixed' | 'all-idle' | 'new-epic' | 'picker' | 'phone'

export const STATES: { key: StateKey; label: string; hint: string; make: () => Sample }[] = [
  { key: 'mixed', label: 'Mixed', hint: 'One epic working, one waiting on you, four at rest.', make: mixed },
  { key: 'all-idle', label: 'All idle', hint: 'Six epics, nothing in motion: the list a quiet day leaves.', make: allIdle },
  { key: 'new-epic', label: 'New epic', hint: 'The slot pressed: an empty epic chat in front, no card until its first message.', make: newEpic },
  { key: 'picker', label: 'Picker', hint: '"Colour and icon…" from an epic\'s menu, open on Epic Rail Polish.', make: picker },
  { key: 'phone', label: 'Phone', hint: 'The phone list at 390px: the rail row, the head, the slot on top.', make: mixed },
]

// ---------------------------------------------------------------------------
// The project rail
// ---------------------------------------------------------------------------

export const RAIL_TILES: RailTile[] = [
  { id: 'proj_1', name: 'runcastle', initials: 'R', needsYou: false, shortcut: 1 },
  { id: 'proj_2', name: 'JanaLearn', initials: 'JL', needsYou: true, shortcut: 2 },
  { id: 'proj_3', name: 'tiny-notes', initials: 'TN', needsYou: false, shortcut: 3 },
  { id: 'proj_4', name: 'site', initials: 'S', needsYou: false, shortcut: 4 },
  { id: 'proj_5', name: 'Payment Gateway', initials: 'PG', needsYou: true, shortcut: 5 },
]
