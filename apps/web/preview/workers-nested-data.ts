import type { Need } from '@runcastle/core'
import type { FeatureListItem, RouterOutputs } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { listItem } from '../test/fixtures'

/**
 * Sample projects for /preview/workers-nested.html
 * (docs/features/workers-nest-under-their-feature): what the real `Sidebar`
 * reads — the feature list, the epic chats, every feature's live workers and
 * the open feature's full worker list — in each state the design is judged in.
 */

export type ListedWorker = RouterOutputs['worker']['listLive'][number]

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

let n = 0
const id = (prefix: string) => `${prefix}_${++n}`

function feature(title: string, over: Partial<FeatureListItem> = {}): FeatureListItem {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  return {
    ...listItem({ id: id('feat'), slug, lastActivityAt: now - (n % 9) * 6 * MIN - 2 * MIN }),
    branch: `feature/${slug}`,
    title,
    ...over,
  } as FeatureListItem
}

function epic(title: string, color: ThreadEntry['color'], icon: ThreadEntry['icon'], over: Partial<ThreadEntry> = {}): ThreadEntry {
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
    ...over,
  } as ThreadEntry
}

const need = (why: string, threadId: string, ago = 4 * MIN): Need => ({ why, since: now - ago, threadId, by: 'agent' })
const tickets = (total: number, done: number) => ({ total, pending: total - done, burning: 0, done, failed: 0, cancelled: 0 })

type Shown = 'needs-you' | 'working' | 'idle' | 'queued' | 'failed' | 'handed-back' | 'landed' | 'dropped'

/** A worker as `worker.listLive` and `worker.list` serve it. */
function worker(
  f: FeatureListItem,
  label: string,
  shown: Shown,
  { ago = 3 * MIN, born = 30 * MIN, why, kind = 'with-you' }: { ago?: number; born?: number; why?: string; kind?: string } = {},
): ListedWorker {
  const wid = id('sess')
  const status = shown === 'idle' ? 'working' : shown
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
    failure: shown === 'failed' ? 'the sandbox ran out of disk' : null,
    createdAt: now - born,
    updatedAt: now - ago,
    need: shown === 'needs-you' ? need(why ?? 'which colour?', wid, ago) : null,
    turnRunning: shown === 'working',
    heldBy: null,
    previewPath: null,
    passPort: 4514,
  } as unknown as ListedWorker
}

/** An old side or drive chat, as the open feature's thread list holds it. */
function oldChat(title: string, role: 'side' | 'old-drive-chat', ago: number): ThreadEntry {
  return { id: id('sess'), title, role, state: 'idle', createdAt: now - ago - HOUR, updatedAt: now - ago, runtime: 'claude-code', need: null } as ThreadEntry
}

export interface Sample {
  features: FeatureListItem[]
  chats: ThreadEntry[]
  workers: ListedWorker[]
  /** The open feature, with its lead and its old chats, or null on the epic's page. */
  open: { feature: FeatureListItem; lead: ThreadEntry; oldChats: ThreadEntry[]; current: string | null } | null
  /** Features whose workers start folded (decision 9's remembered choice). */
  folded: string[]
  /** The row the page holds in its hover, for "+". */
  hover?: string
}

// ---------------------------------------------------------------------------
// The project: two epics in motion, one at rest, a feature from no epic, the shelves.
// ---------------------------------------------------------------------------

function project(opts: { autopilot?: boolean } = {}) {
  const checkout = epic('Checkout flow', 'violet', 'credit-card', opts.autopilot ? { autopilot: true, state: 'working' } : {})
  const search = epic('Search that works', 'teal', 'compass', { state: 'working' })
  const resting = epic('Billing export', 'amber', 'chart', { updatedAt: now - 2 * DAY })
  const locked = opts.autopilot ? { autopilot: { epicId: checkout.id, epicName: checkout.title } } : {}

  const coupons = feature('Checkout coupons', { chatId: checkout.id, ticketCounts: tickets(6, 2), working: true, ...locked })
  const receipts = feature('Receipt emails', { chatId: checkout.id, ticketCounts: tickets(4, 4), ...locked })
  const filters = feature('Search filters', { chatId: search.id, ticketCounts: tickets(5, 1), working: true })
  const ranking = feature('Result ranking', { chatId: search.id, ticketCounts: tickets(3, 0) })
  const darkMode = feature('Dark mode', { ticketCounts: tickets(4, 3) })

  const backlog = ['Gift cards', 'Invite a teammate', 'Weekly digest email'].map((t) => feature(t, { status: 'draft' }))
  const shipped = ['Cart drawer', 'Project rail', 'Address autocomplete', 'Command palette jumps'].map((t, i) =>
    feature(t, { status: 'shipped', chatId: i < 2 ? checkout.id : null, lastActivityAt: now - (i + 1) * 5 * HOUR }),
  )
  return { checkout, search, resting, coupons, receipts, filters, ranking, darkMode, backlog, shipped }
}

type P = ReturnType<typeof project>

const features = (p: P, ...extra: FeatureListItem[]) => [p.coupons, p.receipts, p.filters, p.ranking, p.darkMode, ...extra, ...p.backlog, ...p.shipped]
const chats = (p: P) => [p.checkout, p.search, p.resting]

/** Checkout coupons' workers: one asks, one works, Review waits in line; four finished and an old chat under "N done". */
function couponWorkers(p: P, asking = true) {
  const badge = worker(p.coupons, 'Badge design', asking ? 'needs-you' : 'working', { why: 'pick the badge colour', ago: 2 * MIN, born: 50 * MIN })
  const live = [
    badge,
    worker(p.coupons, 'Coupon API', 'working', { ago: 20_000, born: 40 * MIN, kind: 'on-its-own' }),
    worker(p.coupons, 'Review', 'queued', { ago: 5 * MIN, born: 4 * MIN, kind: 'review' }),
  ]
  const done = [
    worker(p.coupons, 'Coupon schema', 'landed', { ago: 3 * HOUR, born: 6 * HOUR }),
    worker(p.coupons, 'Price rounding', 'landed', { ago: 2 * HOUR, born: 5 * HOUR }),
    worker(p.coupons, 'Expiry rules', 'handed-back', { ago: 70 * MIN, born: 3 * HOUR }),
  ]
  return { badge, live, done }
}

function otherWorkers(p: P) {
  return [
    worker(p.filters, 'Index rebuild', 'working', { ago: 40_000, born: 20 * MIN, kind: 'on-its-own' }),
    worker(p.filters, 'Facet chips', 'idle', { ago: 9 * MIN, born: 25 * MIN }),
    worker(p.darkMode, 'Theme toggle', 'needs-you', { why: 'keep the old icon?', ago: 8 * MIN }),
    worker(p.darkMode, 'Contrast pass', 'failed', { ago: 14 * MIN, born: 50 * MIN, kind: 'on-its-own' }),
  ]
}

function lead(p: P, asking: boolean): ThreadEntry {
  const leadId = 'thread_lead'
  return {
    id: leadId,
    title: 'Checkout coupons',
    role: 'main',
    state: asking ? 'idle' : 'working',
    createdAt: now - DAY,
    updatedAt: now - 2 * MIN,
    runtime: 'claude-code',
    need: null,
  } as ThreadEntry
}

/** The open feature with live workers and its "N done" (decisions 2–4). */
function openState(): Sample {
  const p = project()
  const c = couponWorkers(p)
  p.coupons.need = need('pick the badge colour', c.badge.id, 2 * MIN)
  const old = [oldChat('Try a coupon field in the cart', 'side', 2 * DAY)]
  return {
    features: features(p),
    chats: chats(p),
    workers: [...c.live, ...c.done, ...otherWorkers(p)],
    open: { feature: p.coupons, lead: lead(p, true), oldChats: old, current: 'thread_lead' },
    folded: [],
  }
}

/** No feature open: each feature's live workers wherever its row sits — under its epic, in Other features. */
function lanesState(): Sample {
  const p = project()
  const c = couponWorkers(p)
  p.coupons.need = need('pick the badge colour', c.badge.id, 2 * MIN)
  const others = otherWorkers(p)
  p.darkMode.need = need('keep the old icon?', others[2]!.id, 8 * MIN)
  return { features: features(p), chats: chats(p), workers: [...c.live, ...c.done, ...others], open: null, folded: [] }
}

/** Dark mode folded while its worker needs you: the row keeps the amber dot and the words (decision 9). */
function foldedState(): Sample {
  const s = lanesState()
  const dark = s.features.find((f) => f.title === 'Dark mode')!
  return { ...s, folded: [dark.id] }
}

/** Under an epic card, with a worker's chat in front: the open feature's card holds the worker in front. */
function epicState(): Sample {
  const p = project()
  const c = couponWorkers(p, false)
  return {
    features: features(p),
    chats: chats(p),
    workers: [...c.live, ...c.done, ...otherWorkers(p)],
    open: { feature: p.coupons, lead: lead(p, false), oldChats: [], current: c.live[1]!.id },
    folded: [],
  }
}

/** Checkout flow on autopilot: its features and their workers carry the lock, never the amber dot (decision 7). */
function autopilotState(): Sample {
  const p = project({ autopilot: true })
  const c = couponWorkers(p)
  return { features: features(p), chats: chats(p), workers: [...c.live, ...c.done, ...otherWorkers(p)], open: null, folded: [] }
}

/** The open feature has no workers: the row is today's row, no chevron, no "N done". */
function noneState(): Sample {
  const p = project()
  return {
    features: features(p),
    chats: chats(p),
    workers: otherWorkers(p),
    open: { feature: p.ranking, lead: { ...lead(p, false), title: 'Result ranking' }, oldChats: [], current: 'thread_lead' },
    folded: [],
  }
}

/** "+" (New worker) shown on an in-progress row's hover, beside "…" (decision 5). */
function hoverState(): Sample {
  const s = lanesState()
  return { ...s, hover: 'Search filters' }
}

export type StateKey = 'open' | 'lanes' | 'folded' | 'epic' | 'autopilot' | 'none' | 'hover'

const RAW_STATES: { key: StateKey; label: string; hint: string; make: () => Sample }[] = [
  {
    key: 'open',
    label: 'Open feature',
    hint: 'Checkout coupons is open: its live workers under it, needs you first; "4 done" folds the finished ones and an old side chat. Badge design’s question shows on its own row only (decision 12).',
    make: openState,
  },
  {
    key: 'lanes',
    label: 'Many features',
    hint: 'Nothing open: every feature row carries its live workers, under its epic and in Other features. No "N done" anywhere. A worker’s question shows on its row, not its feature’s.',
    make: lanesState,
  },
  {
    key: 'folded',
    label: 'Folded, needs you',
    hint: 'Dark mode is folded while Theme toggle asks: its question rolls up to the feature row, amber dot and Needs you words.',
    make: foldedState,
  },
  {
    key: 'epic',
    label: 'Worker in front',
    hint: 'Under the Checkout flow card, Coupon API’s chat is in front: the open feature’s card holds it, its row the card.',
    make: epicState,
  },
  {
    key: 'autopilot',
    label: 'Autopilot',
    hint: 'Checkout flow on autopilot: its features and their workers wear the lock; Badge design’s question goes to the epic, so no amber.',
    make: autopilotState,
  },
  { key: 'none', label: 'No workers', hint: 'Result ranking is open and has no workers: the row as today, no chevron.', make: noneState },
  { key: 'hover', label: 'Hover "+"', hint: 'The pointer on Search filters: "+" New worker and "…" replace the chevron’s neighbours.', make: hoverState },
]

/** Each state numbers its ids from 1, so a state built twice (StrictMode) seeds folds for the ids it renders. */
export const STATES = RAW_STATES.map((s) => ({
  ...s,
  make: () => {
    n = 0
    return s.make()
  },
}))

export { DAY, HOUR, MIN }
