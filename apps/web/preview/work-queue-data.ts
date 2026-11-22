import type { Need } from '@runcastle/core'
import type { FeatureListItem, RouterOutputs } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { QueueEntry } from '../src/components/WorkQueue'
import { listItem } from '../test/fixtures'

/**
 * Sample data for /preview/work-queue.html (docs/features/one-number-for-how-
 * many-build-at-once, decision 8): the open project's features and live
 * workers as the real `Sidebar` reads them, and the machine's whole line —
 * this project's workers and another project's — as the foot's `WorkQueue`
 * takes it. The limit is this machine's default: 2.
 */

export type ListedWorker = RouterOutputs['worker']['listLive'][number]

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN

/** The open project, and another on the same machine whose workers share the line. */
export const HERE = { id: 'proj_1', name: 'shopfront' }
const LEDGER = { id: 'proj_2', name: 'ledger-api' }

export const LIMIT = 2

let n = 0
const id = (prefix: string) => `${prefix}_${++n}`

function feature(title: string, over: Partial<FeatureListItem> = {}): FeatureListItem {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  return {
    ...listItem({ id: id('feat'), slug, lastActivityAt: now - (n % 7) * 5 * MIN - 2 * MIN }),
    branch: `feature/${slug}`,
    title,
    ...over,
  } as FeatureListItem
}

const tickets = (total: number, done: number) => ({ total, pending: total - done, burning: 0, done, failed: 0, cancelled: 0 })

type Shown = 'working' | 'idle' | 'needs-you' | 'waiting' | 'held'

/** A worker as `worker.listLive` serves it, with its place in line (the field the server adds). */
function worker(
  f: FeatureListItem,
  label: string,
  shown: Shown,
  { ago = 3 * MIN, born = 30 * MIN, kind = 'with-you', place, held }: { ago?: number; born?: number; kind?: string; place?: number; held?: string } = {},
): ListedWorker {
  const wid = id('sess')
  const status = shown === 'waiting' || shown === 'held' ? 'queued' : shown === 'idle' ? 'working' : shown
  return {
    id: wid,
    featureId: f.id,
    projectId: f.projectId,
    label,
    purpose: `${label} for ${f.title.toLowerCase()}`,
    kind,
    status,
    startedBy: 'lead',
    model: 'claude-opus-5-5',
    branch: `${f.branch}--${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    failure: null,
    createdAt: now - born,
    updatedAt: now - ago,
    need: shown === 'needs-you' ? ({ why: 'pick the badge colour', since: now - ago, threadId: wid, by: 'agent' } satisfies Need) : null,
    turnRunning: shown === 'working',
    heldBy: shown === 'held' ? (held ?? null) : null,
    queuePlace: shown === 'waiting' ? (place ?? null) : null,
    previewPath: null,
    passPort: 4514,
  } as unknown as ListedWorker
}

function epic(title: string, color: ThreadEntry['color'], icon: ThreadEntry['icon']): ThreadEntry {
  return {
    id: id('chat'),
    title,
    role: 'project',
    state: 'idle',
    createdAt: now - 9 * HOUR,
    updatedAt: now - 40 * MIN,
    runtime: 'claude-code',
    epicNamed: true,
    need: null,
    color,
    icon,
  } as ThreadEntry
}

export interface Sample {
  features: FeatureListItem[]
  chats: ThreadEntry[]
  /** This project's live workers, as `worker.listLive` serves them. */
  workers: ListedWorker[]
  /** The machine's line, as the foot's `WorkQueue` takes it. */
  working: QueueEntry[]
  waiting: QueueEntry[]
  /** The open feature and its lead's chat: its card holds its worker rows. */
  open: { feature: FeatureListItem; lead: ThreadEntry }
}

/** The project: one epic, and two features of no epic whose workers sit under them with their words. */
function project() {
  const search = epic('Search that works', 'teal', 'compass')
  const filters = feature('Search filters', { chatId: search.id, ticketCounts: tickets(5, 1) })
  const coupons = feature('Checkout coupons', { ticketCounts: tickets(6, 2) })
  const darkMode = feature('Dark mode', { ticketCounts: tickets(4, 3) })
  const backlog = ['Gift cards', 'Invite a teammate'].map((t) => feature(t, { status: 'draft' }))
  const shipped = ['Cart drawer', 'Project rail', 'Address autocomplete'].map((t, i) =>
    feature(t, { status: 'shipped', lastActivityAt: now - (i + 1) * 5 * HOUR }),
  )
  const ledger = { exports: feature('CSV export', { projectId: LEDGER.id }), keys: feature('API keys', { projectId: LEDGER.id }) }
  return { search, filters, coupons, darkMode, backlog, shipped, ledger }
}

type P = ReturnType<typeof project>

const featuresOf = (p: P) => [p.filters, p.coupons, p.darkMode, ...p.backlog, ...p.shipped]

/** Checkout coupons is open, its lead's chat in front. */
const openOf = (p: P): Sample['open'] => ({
  feature: p.coupons,
  lead: {
    id: 'thread_lead',
    title: 'Checkout coupons',
    role: 'main',
    state: 'idle',
    createdAt: now - 24 * HOUR,
    updatedAt: now - 2 * MIN,
    runtime: 'claude-code',
    need: null,
  } as ThreadEntry,
})

/** A listed worker as an entry in the machine's line. */
function entry(w: ListedWorker, f: FeatureListItem, since: number, held?: string): QueueEntry {
  const where = f.projectId === LEDGER.id ? LEDGER : HERE
  return {
    id: w.id,
    label: w.label,
    kind: w.kind === 'unassigned' ? undefined : w.kind,
    featureId: f.id,
    featureTitle: f.title,
    projectId: where.id,
    projectName: where.name,
    since,
    ...(held ? { heldBy: held } : {}),
  } as QueueEntry
}

/** Workers that hold no place (decision 5): one asks you, one idles between turns. */
function resting(p: P) {
  return [
    worker(p.coupons, 'Badge design', 'needs-you', { ago: 2 * MIN, born: 50 * MIN }),
    worker(p.filters, 'Facet chips', 'idle', { ago: 9 * MIN, born: 25 * MIN }),
  ]
}

/** Nothing works or waits: the line is hidden, though Badge design asks and Facet chips idles. */
function noneState(): Sample {
  const p = project()
  return { features: featuresOf(p), chats: [p.search],
    open: openOf(p), workers: resting(p), working: [], waiting: [] }
}

/** One works, a place is free, nobody waits: "1 of 2 working". */
function roomState(): Sample {
  const p = project()
  const api = worker(p.coupons, 'Coupon API', 'working', { ago: 20_000, born: 12 * MIN, kind: 'on-its-own' })
  p.coupons.working = true
  return {
    features: featuresOf(p),
    chats: [p.search],
    open: openOf(p),
    workers: [...resting(p), api],
    working: [entry(api, p.coupons, now - 12 * MIN)],
    waiting: [],
  }
}

/** Both places taken, three wait — one in another project; Checkout coupons' Review is 2nd in line. */
function waitingState(): Sample {
  const p = project()
  const api = worker(p.coupons, 'Coupon API', 'working', { ago: 20_000, born: 12 * MIN, kind: 'on-its-own' })
  const exporter = worker(p.ledger.exports, 'Export job', 'working', { ago: 40_000, born: 31 * MIN, kind: 'on-its-own' })
  const toggle = worker(p.darkMode, 'Theme toggle', 'waiting', { ago: 9 * MIN, born: 9 * MIN, place: 1 })
  const review = worker(p.coupons, 'Review', 'waiting', { ago: 4 * MIN, born: 4 * MIN, kind: 'review', place: 2 })
  const limiter = worker(p.ledger.keys, 'Rate limiter', 'waiting', { ago: MIN, born: MIN, kind: 'on-its-own', place: 3 })
  p.coupons.working = true
  return {
    features: featuresOf(p),
    chats: [p.search],
    open: openOf(p),
    workers: [...resting(p), api, toggle, review],
    working: [entry(exporter, p.ledger.exports, now - 31 * MIN), entry(api, p.coupons, now - 12 * MIN)],
    waiting: [entry(toggle, p.darkMode, now - 9 * MIN), entry(review, p.coupons, now - 4 * MIN), entry(limiter, p.ledger.keys, now - MIN)],
  }
}

const HOLD = 'usage limit until 14:00'

/** Two work, two wait; the first to ask is held by its account's usage limit, so Review is next. */
function heldState(): Sample {
  const p = project()
  const api = worker(p.coupons, 'Coupon API', 'working', { ago: 20_000, born: 12 * MIN, kind: 'on-its-own' })
  const exporter = worker(p.ledger.exports, 'Export job', 'working', { ago: 40_000, born: 31 * MIN, kind: 'on-its-own' })
  const toggle = worker(p.darkMode, 'Theme toggle', 'held', { ago: 26 * MIN, born: 26 * MIN, held: HOLD })
  const review = worker(p.coupons, 'Review', 'waiting', { ago: 4 * MIN, born: 4 * MIN, kind: 'review', place: 1 })
  p.coupons.working = true
  return {
    features: featuresOf(p),
    chats: [p.search],
    open: openOf(p),
    workers: [...resting(p), api, toggle, review],
    working: [entry(exporter, p.ledger.exports, now - 31 * MIN), entry(api, p.coupons, now - 12 * MIN)],
    waiting: [entry(toggle, p.darkMode, now - 26 * MIN, HOLD), entry(review, p.coupons, now - 4 * MIN)],
  }
}

export type StateKey = 'none' | 'room' | 'waiting' | 'open' | 'held'

const RAW_STATES: { key: StateKey; label: string; hint: string; make: () => Sample }[] = [
  {
    key: 'none',
    label: 'Nothing in line',
    hint: 'Nothing works or waits: no line in the foot. Badge design asks you and Facet chips idles — neither holds a place (decision 5).',
    make: noneState,
  },
  { key: 'room', label: 'Room', hint: 'Coupon API works and one place is free: "1 of 2 working".', make: roomState },
  {
    key: 'waiting',
    label: 'Waiting',
    hint: 'Both places taken, three wait across two projects. Checkout coupons’ Review says its place on its own row: "Waiting · 2nd in line".',
    make: waitingState,
  },
  {
    key: 'open',
    label: 'Line open',
    hint: 'The foot line clicked: those working, then those waiting in order. Another project’s entries name it; an entry opens its chat.',
    make: waitingState,
  },
  {
    key: 'held',
    label: 'Held',
    hint: 'Theme toggle asked first but its account hit the usage limit: it keeps its spot with no number and says why, so Review is 1st.',
    make: heldState,
  },
]

/** Each state numbers its ids from 1, so a state built twice (StrictMode) renders the same ids. */
export const STATES = RAW_STATES.map((s) => ({
  ...s,
  make: () => {
    n = 0
    return s.make()
  },
}))
