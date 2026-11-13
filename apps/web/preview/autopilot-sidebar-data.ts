import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { Epic } from '../src/lib/feature-ui/epics'
import type { RailTile } from '../src/lib/project-rail'
import { listItem } from '../test/fixtures'

/**
 * Sample sidebars for /preview/autopilot-sidebar.html (epics-on-autopilot):
 * the epic "Checkout flow" off and on autopilot, beside two ordinary epics and
 * two at rest, over the usual shelves. Each state lists its epics in the order
 * the list itself sorts them (needs you first, then in motion, then at rest).
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
    ...listItem({ id: `feat_${n}`, slug, lastActivityAt: now - n * 7 * MIN, ...over }),
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
    need: null,
  }
}

const tickets = (total: number, done: number) => ({ total, pending: total - done, burning: 0, done, failed: 0, cancelled: 0 })

const is = {
  needs: (why: string): Partial<FeatureListItem> => ({
    need: { why, since: now - 20 * MIN, threadId: 'thread_lead', by: 'agent' },
  }),
  working: (): Partial<FeatureListItem> => ({ working: true, liveSession: { status: 'live', awaitingInput: false } } as Partial<FeatureListItem>),
  workers: (k: number, total = 6, done = 2): Partial<FeatureListItem> => ({ working: true, workersWorking: k, ticketCounts: tickets(total, done) }),
  idle: (total = 5, done = 5): Partial<FeatureListItem> => ({ ticketCounts: tickets(total, done) }),
}

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
// Shelves: the same in every state.
// ---------------------------------------------------------------------------

function shelves(): Pick<Sample, 'backlog' | 'shipped' | 'archived'> {
  const backlog = ['Gift cards', 'Invite a teammate', 'Export a chat as PDF', 'Weekly digest email', 'Usage meter'].map((t) =>
    feature(t, { status: 'draft' }),
  )
  const shippedTitles = ['Cart drawer', 'Status words tell the truth', 'Project rail', 'Command palette jumps', 'Address autocomplete']
  const shipped = Array.from({ length: 64 }, (_, i) =>
    feature(shippedTitles[i] ?? `Shipped feature ${i + 1}`, { status: 'shipped', lastActivityAt: now - (i + 1) * 5 * HOUR }),
  )
  const archived = ['PayPal checkout', 'Violet theme', 'Slack bridge'].map((t) => feature(t, { status: 'archived' }))
  return { backlog, shipped, archived }
}

// ---------------------------------------------------------------------------
// The epic this page is about: "Checkout flow"
// ---------------------------------------------------------------------------

type Mode = 'off' | 'on' | 'needs-you' | 'left-for-grill'

/**
 * Checkout flow. Off: an ordinary epic, one of its features asking you about
 * a design. On: the same features locked to the run — Working or Idle, never
 * Needs you. Needs you: the epic's own chat waits on you, its features carry
 * on. Left for grill: the run plan left one feature for your grill; autopilot
 * locks the whole epic (decision 14), so it sits locked and untouched, Idle,
 * until you end autopilot.
 */
function checkout(mode: Mode): Epic {
  const on = mode !== 'off'
  const base = chat('Checkout flow', 7 * HOUR, mode === 'needs-you' ? 6 * MIN : 1 * MIN, mode === 'needs-you' ? 'waiting' : 'working')
  const epicChat: ThreadEntry =
    mode === 'needs-you'
      ? { ...base, need: { why: 'Card fees or a flat price? Pick one', since: now - 6 * MIN, threadId: base.id, by: 'agent' } }
      : base
  const page = feature('Checkout page', is.working())
  const cards = feature('Saved cards', on ? is.workers(2, 6, 3) : is.needs('Design to approve'))
  const receipts = feature('Receipt emails', is.idle(4, 4))
  const locked = (f: FeatureListItem) => ({ feature: f, locked: on })
  const features = [locked(page), locked(cards), locked(receipts)]
  if (mode === 'left-for-grill') {
    // Left for the human's grill (decision 14): locked with the rest, nobody working it.
    features.push({ feature: feature('Refunds', { lastActivityAt: now - 3 * HOUR }), locked: true })
  }
  if (mode === 'off') {
    // Off, the asking feature leads its epic, as the list orders it.
    features.sort((a, b) => Number(!!b.feature.need) - Number(!!a.feature.need))
  }
  return { chat: epicChat, color: 'violet', icon: 'credit-card', shipped: 3, autopilot: on, features }
}

// ---------------------------------------------------------------------------
// Its neighbours: two ordinary epics and two at rest
// ---------------------------------------------------------------------------

/** An ordinary epic, a feature in it needing you: amber, so it leads the list. */
function agentStatus(): Epic {
  return {
    chat: chat('Agent status display', 20 * HOUR, 12 * MIN, 'idle'),
    color: 'rose',
    icon: 'bot',
    shipped: 4,
    features: [
      { feature: feature('Status chip in the header', is.needs('Design to approve')) },
      { feature: feature('Idle timer on rows', is.workers(1, 4, 1)) },
    ],
  }
}

/** An ordinary epic at work. */
function workerHandoff(): Epic {
  return {
    chat: chat('Worker handoff visibility', 5 * HOUR, 3 * MIN, 'working'),
    color: 'teal',
    icon: 'workflow',
    shipped: 2,
    features: [{ feature: feature('Handoff notes in the chat', is.working()) }],
  }
}

function resting(): Epic[] {
  return [
    { chat: chat('Onboarding tour', 40 * MIN, 25 * MIN), color: 'blue', icon: 'compass', shipped: 0, features: [] },
    { chat: chat('Billing export', 2 * DAY, 1 * DAY), color: 'amber', icon: 'chart', shipped: 12, features: [] },
  ]
}

function sample(mode: Mode): Sample {
  const epic = checkout(mode)
  const asking = mode === 'off' || mode === 'needs-you'
  // Yellow first: an epic that asks (itself or through a feature it holds) leads, in recency.
  const epics = asking ? [epic, agentStatus(), workerHandoff(), ...resting()] : [agentStatus(), epic, workerHandoff(), ...resting()]
  return { epics, ...shelves(), total: 23, openChat: null }
}

export type StateKey = 'off' | 'on' | 'needs-you' | 'left-for-grill' | 'phone'

export const STATES: { key: StateKey; label: string; hint: string; make: () => Sample }[] = [
  { key: 'off', label: 'Off', hint: 'Checkout flow as any epic today: its features are yours, one asks you about a design.', make: () => sample('off') },
  { key: 'on', label: 'On', hint: 'On autopilot: the card wears the look; its features are locked, Working or Idle, never Needs you.', make: () => sample('on') },
  { key: 'needs-you', label: 'Needs you', hint: 'The epic itself waits on you: the amber dot is on its card; its locked features carry on.', make: () => sample('needs-you') },
  {
    key: 'left-for-grill',
    label: 'Left for grill',
    hint: 'The run plan left Refunds for your grill. Autopilot locks the whole epic, so it sits locked and Idle until you end autopilot.',
    make: () => sample('left-for-grill'),
  },
  { key: 'phone', label: 'Phone', hint: 'The On state on a phone: the sidebar is the whole screen.', make: () => sample('on') },
]

export const RAIL_TILES: RailTile[] = [
  { id: 'proj_1', name: 'shopfront', initials: 'S', needsYou: false, shortcut: 1 },
  { id: 'proj_2', name: 'runcastle', initials: 'R', needsYou: true, shortcut: 2 },
  { id: 'proj_3', name: 'tiny-notes', initials: 'TN', needsYou: false, shortcut: 3 },
]
