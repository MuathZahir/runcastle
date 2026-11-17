import type { Need } from '@runcastle/core'
import type { FeatureListItem, RouterOutputs } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { listItem } from '../test/fixtures'

/**
 * Sample projects for /preview/calm-sidebar.html (docs/features/a-calmer-sidebar):
 * what the real `Sidebar` reads — features, epic chats, live workers — in each
 * state the design is judged in. Ids are fixed, so each state can seed the
 * folds it opens.
 */

export type ListedWorker = RouterOutputs['worker']['listLive'][number]

const now = Date.now()
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const tickets = { total: 0, pending: 0, burning: 0, done: 0, failed: 0, cancelled: 0 }

function feature(id: string, title: string, ago: number, over: Partial<FeatureListItem> = {}): FeatureListItem {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  return {
    ...listItem({ id, slug, lastActivityAt: now - ago, ticketCounts: tickets }),
    branch: `feature/${slug}`,
    title,
    ...over,
  } as FeatureListItem
}

function epic(id: string, title: string, color: ThreadEntry['color'], icon: ThreadEntry['icon'], over: Partial<ThreadEntry> = {}): ThreadEntry {
  return {
    id,
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

const need = (why: string, threadId: string, ago: number): Need => ({ why, since: now - ago, threadId, by: 'agent' })

type Shown = 'needs-you' | 'working' | 'idle' | 'queued' | 'failed' | 'landed' | 'handed-back'

function worker(id: string, f: FeatureListItem, label: string, shown: Shown, ago: number, born = 30 * MIN): ListedWorker {
  const status = shown === 'idle' ? 'working' : shown
  return {
    id,
    featureId: f.id,
    projectId: f.projectId,
    label,
    purpose: `${label} for ${f.title.toLowerCase()}`,
    kind: 'on-its-own',
    status,
    startedBy: 'lead',
    model: 'claude-opus-5-5',
    branch: `${f.branch}--${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    failure: shown === 'failed' ? 'the sandbox ran out of disk' : null,
    createdAt: now - born,
    updatedAt: now - ago,
    need: shown === 'needs-you' ? need('keep the old bundle split?', id, ago) : null,
    turnRunning: shown === 'working',
    heldBy: null,
    previewPath: null,
    passPort: 4514,
  } as unknown as ListedWorker
}

export interface Sample {
  features: FeatureListItem[]
  chats: ThreadEntry[]
  workers: ListedWorker[]
  /** The feature in front, with its lead chat, or null on the project's page. */
  open: { feature: FeatureListItem; lead: ThreadEntry } | null
  /** Epic folds (by chat id, or "other") and feature workers (by feature id) opened in this state. */
  epicsOpen: string[]
  workersOpen: string[]
  /** The row the page holds in its hover. */
  hover?: string
}

/** The project in the human's screenshot: Notes Triage with five features, another epic asking, one at rest. */
function project(opts: { calm?: boolean; workerAsks?: boolean; autopilot?: boolean } = {}) {
  const triage = epic('chat_triage', 'Notes Triage', 'blue', 'bug', { state: 'working' })
  const checkout = epic(
    'chat_checkout',
    'Checkout flow',
    'violet',
    'credit-card',
    opts.autopilot ? { autopilot: true, state: 'working' } : opts.calm ? {} : { need: need('Card fees or a flat price?', 'chat_checkout', 6 * MIN) },
  )
  const resting = epic('chat_billing', 'Billing export', 'amber', 'chart', { updatedAt: now - 2 * DAY })

  const approval = feature('feat_approval', 'Agents never stop for approval', 55 * MIN, {
    chatId: triage.id,
    ...(opts.calm ? { working: true } : { need: need('Ready to test · A lead runs a whole plan without stopping', 'lead_approval', 55 * MIN) }),
  })
  const fable = feature('feat_fable', 'Fable 5.2 in the model picker', 30 * MIN, {
    chatId: triage.id,
    ...(opts.calm ? {} : { need: need('Ready to test · Pick Fable 5.2 for a worker', 'lead_fable', 30 * MIN) }),
  })
  const busy = feature('feat_busy', 'Epic messages reach a busy agent at once', 59 * SEC, { chatId: triage.id, working: true })
  const faster = feature('feat_faster', 'A faster web app', 5 * SEC, { chatId: triage.id, working: true, workersWorking: 1 })
  const scenarios = feature('feat_scenarios', 'Features set up scenarios themselves', 1 * MIN + 10 * SEC, { chatId: triage.id })
  const locked = opts.autopilot ? { autopilot: { epicId: checkout.id, epicName: checkout.title } } : {}
  const coupons = feature('feat_coupons', 'Checkout coupons', 12 * MIN, { chatId: checkout.id, working: true, ...locked })
  const receipts = feature('feat_receipts', 'Receipt emails', 2 * HOUR, {
    chatId: checkout.id,
    ...locked,
    ...(opts.calm || opts.autopilot ? {} : { need: need('Plain text or HTML receipts?', 'lead_receipts', 8 * MIN) }),
  })
  const darkMode = feature('feat_dark', 'Dark mode', 3 * HOUR)

  const backlog = ['Gift cards', 'Invite a teammate'].map((t, i) => feature(`feat_b${i}`, t, DAY, { status: 'draft' }))
  const shipped = ['Cart drawer', 'Project rail', 'Address autocomplete'].map((t, i) =>
    feature(`feat_s${i}`, t, (i + 1) * 5 * HOUR, { status: 'shipped', chatId: i < 2 ? triage.id : null }),
  )

  const fasterWorkers = [
    worker('w_bundle', faster, 'Bundle split', opts.workerAsks ? 'needs-you' : 'working', opts.workerAsks ? 3 * MIN : 20 * SEC),
    worker('w_images', faster, 'Image loading', 'idle', 6 * MIN),
    worker('w_cache', faster, 'Query cache', 'landed', 2 * HOUR, 5 * HOUR),
    worker('w_fonts', faster, 'Font subsetting', 'handed-back', 70 * MIN, 3 * HOUR),
  ]
  const couponWorkers = [worker('w_badge', coupons, 'Badge design', 'working', 40 * SEC)]
  if (opts.workerAsks) faster.need = need('keep the old bundle split?', 'w_bundle', 3 * MIN)

  const features = [approval, fable, busy, faster, scenarios, coupons, receipts, darkMode, ...backlog, ...shipped]
  return {
    triage,
    checkout,
    faster,
    features,
    chats: [triage, checkout, resting],
    workers: [...fasterWorkers, ...couponWorkers],
  }
}

function base(opts?: Parameters<typeof project>[0]): Sample & { p: ReturnType<typeof project> } {
  const p = project(opts)
  return { p, features: p.features, chats: p.chats, workers: p.workers, open: null, epicsOpen: [], workersOpen: [] }
}

const strip = ({ p: _p, ...s }: ReturnType<typeof base>): Sample => s

function lead(f: FeatureListItem): ThreadEntry {
  return { id: `lead_${f.id}`, title: f.title, role: 'main', state: 'working', createdAt: now - DAY, updatedAt: now - MIN, runtime: 'claude-code', need: null } as ThreadEntry
}

export type StateKey = 'folded' | 'unfolded' | 'workers' | 'in-front' | 'calm' | 'autopilot' | 'hover'

const RAW_STATES: { key: StateKey; label: string; hint: string; make: () => Sample }[] = [
  {
    key: 'folded',
    label: 'Needs you on top',
    hint: 'Your screenshot’s epic. Rows that need you sit on a tint of the epic’s colour, their mark (play = ready to test, bubble = asks you) in a tile and an unread dot at the end; the head counts them. They stay still: only the working spinner moves. No times; hover shows them.',
    make: () => strip(base()),
  },
  {
    key: 'unfolded',
    label: 'Fold opened',
    hint: 'The fold line opened: working features wear the spinner, the idle one nothing; the fold line drops its own spinner while open. Each epic remembers its fold on this browser.',
    make: () => strip({ ...base(), epicsOpen: ['chat_triage'] }),
  },
  {
    key: 'workers',
    label: 'Workers opened',
    hint: 'A faster web app’s arrow opened: its two live workers, one line each, on a guide line under the arrow. Bundle split asks, so it and its feature wear the “?” and the feature rises to the top; Image loading works, so it wears the spinner. Finished workers are not drawn.',
    make: () => strip({ ...base({ workerAsks: true }), workersOpen: ['feat_faster'] }),
  },
  {
    key: 'in-front',
    label: 'Feature in front',
    hint: 'A faster web app is open on the page: it stays visible above the closed fold, so the sidebar always shows where you are.',
    make: () => {
      const s = base()
      return strip({ ...s, open: { feature: s.p.faster, lead: lead(s.p.faster) } })
    },
  },
  {
    key: 'calm',
    label: 'Nothing needs you',
    hint: 'No needs anywhere: each epic is its head and one quiet fold line.',
    make: () => strip(base({ calm: true })),
  },
  {
    key: 'autopilot',
    label: 'Autopilot',
    hint: 'Checkout flow on autopilot: its features carry the lock and never the needs-you tint; they fold like any other.',
    make: () => strip({ ...base({ autopilot: true }), epicsOpen: ['chat_checkout'] }),
  },
  {
    key: 'hover',
    label: 'Hover',
    hint: 'The pointer on Fable 5.2: its tint deepens, and “+” New worker and “…” take the unread dot’s place.',
    make: () => strip({ ...base(), hover: 'feat_fable' }),
  },
]

export const STATES = RAW_STATES

export { DAY, HOUR, MIN }
