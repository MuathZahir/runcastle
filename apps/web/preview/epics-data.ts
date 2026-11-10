import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { Epic, EpicHolder } from '../src/lib/feature-ui/epics'
import { listItem } from '../test/fixtures'

/**
 * Sample projects for /preview/epics.html (orchestrator-chats-become-epics):
 * each state is the project's orchestrator chats as epics, the features each
 * cut (by origin chat, with who runs each now), the features with no epic, the
 * shelves with the epic each shelved feature came from, and what is open.
 */

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

let n = 0

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

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

function chat(title: string, createdAgo: number, over: Partial<ThreadEntry> = {}): ThreadEntry {
  n += 1
  return {
    id: `chat_${n}`,
    title,
    role: 'project',
    state: 'idle',
    createdAt: now - createdAgo,
    updatedAt: now - Math.min(createdAgo, (over.state === 'working' ? 2 : 10 + n * 7) * MIN),
    runtime: 'claude-code',
    ...over,
  }
}

const tickets = (total: number, done: number) => ({ total, pending: total - done, burning: 0, done, failed: 0, cancelled: 0 })

/** What a feature is doing, as the server's fields say it. */
const is = {
  /** The human's to answer: an amber row. */
  needs: (words: string, kind: 'plan' | 'design' | 'answer' | 'test' | 'merge' | 'conflict' = 'plan'): Partial<FeatureListItem> => ({
    need: { kind, words, held: false, since: now - 20 * MIN },
  }),
  /** Its chat holds the next move: "With <chat> · <words>". */
  held: (chatTitle: string, words: string): Partial<FeatureListItem> => ({
    need: { kind: 'answer', words: `With ${chatTitle} · ${words}`, held: true, since: now - 12 * MIN },
  }),
  /** The human's own feature consulting its chat: "Asking <chat> · <first line>", in the working colour. */
  consulting: (chatTitle: string, line: string): Partial<FeatureListItem> => ({
    need: { kind: 'answer', words: `Asking ${chatTitle} · ${line}`, held: true, since: now - 4 * MIN },
  }),
  lead: (): Partial<FeatureListItem> => ({ liveSession: { status: 'live', awaitingInput: false } }),
  workers: (k: number, total = 6, done = 2): Partial<FeatureListItem> => ({ workersWorking: k, ticketCounts: tickets(total, done) }),
  quiet: (total = 5, done = 3): Partial<FeatureListItem> => ({ ticketCounts: tickets(total, done) }),
  upNext: (after: string): Partial<FeatureListItem> => ({
    status: 'draft',
    upNext: true,
    dependsOn: [{ featureId: 'feat_dep', slug: after, title: after, status: 'active', upNext: false, satisfied: false }],
  }),
}

const EPIC: EpicHolder = { kind: 'epic' }
const YOU: EpicHolder = { kind: 'you' }
const other = (title: string): EpicHolder => ({ kind: 'chat', title })

// ---------------------------------------------------------------------------
// The sample's shape
// ---------------------------------------------------------------------------

/** A feature on a shelf, with the epic it came from (decision 21). */
export interface Shelved {
  feature: FeatureListItem
  epic: string | null
}

/** What the content panel has in front. */
export type Open = { kind: 'epic'; id: string } | { kind: 'feature'; id: string }

export interface Sample {
  epics: Epic[]
  other: FeatureListItem[]
  backlog: Shelved[]
  shipped: Shelved[]
  archived: Shelved[]
  /** Every epic the project has: "All N epics". */
  total: number
  open: Open
}

/**
 * The "Epics, every chat named" Tweak: what a question chat would call itself
 * on its first reply (decision 12's challenge), in place of its sentence title.
 */
export const EVERY_CHAT_NAMED: Record<string, string> = {
  'What shipped this week?': 'Weekly Recap',
  'Why did the burn fail on Monday?': 'Monday Burn',
  'Can people pay with Apple Pay?': 'Apple Pay',
}

// ---------------------------------------------------------------------------
// Shelves, shared by the samples
// ---------------------------------------------------------------------------

function shelves(): Pick<Sample, 'backlog' | 'shipped' | 'archived'> {
  const s = (title: string, epic: string | null, over: Partial<FeatureListItem>): Shelved => ({
    feature: feature(title, { lastActivityAt: now - (n + 3) * 3 * HOUR, ...over }),
    epic,
  })
  return {
    backlog: [
      s('Saved payment methods', 'Payment System', { status: 'draft' }),
      s('Invite a teammate', 'Onboarding', { status: 'draft' }),
      s('Dark terminal palette', null, { status: 'draft' }),
    ],
    shipped: [
      s('Stripe webhook retries', 'Payment System', { status: 'shipped' }),
      s('Status words tell the truth', 'Feature Ownership', { status: 'shipped' }),
      s('Sign in with GitHub', 'Onboarding', { status: 'shipped' }),
      s('Changelog file per release', null, { status: 'shipped' }),
      s('Sidebar shows only active chats', 'Sidebar Epics', { status: 'shipped' }),
      s('Command palette jumps', null, { status: 'shipped' }),
      s('Tax lines on receipts', 'Payment System', { status: 'shipped' }),
    ],
    archived: [
      s('PayPal checkout', 'Payment System', { status: 'archived' }),
      s('Violet theme', null, { status: 'archived' }),
    ],
  }
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** Busy: one epic asking, one with a feature waiting on you, one working, one at rest, a question chat, a loose feature. */
function busy(): Sample {
  const checkout = feature('Checkout', is.held('Payment System', 'asking you'))
  const refunds = feature('Refunds', is.lead())
  const firstRun = feature('First-run checklist', is.quiet(6, 4))
  const epics: Epic[] = [
    {
      chat: chat('Payment System', 20 * HOUR, { state: 'waiting' }),
      asksAbout: 'Checkout',
      features: [
        { feature: checkout, holder: EPIC },
        { feature: refunds, holder: EPIC },
        { feature: feature('Invoice PDFs', is.upNext('checkout')), holder: EPIC },
      ],
    },
    {
      chat: chat('Feature Ownership', 1 * DAY + 3 * HOUR),
      asksAbout: null,
      features: [
        { feature: feature('Hand-back button', is.workers(2, 7, 3)), holder: EPIC },
        { feature: feature('Owner control in the header', is.needs('Plan to approve')), holder: EPIC },
        { feature: feature('Typing warning strip', is.quiet(4, 1)), holder: EPIC },
      ],
    },
    {
      chat: chat('Sidebar Epics', 5 * HOUR, { state: 'working' }),
      asksAbout: null,
      features: [
        { feature: feature('Epic rows in the sidebar', is.lead()), holder: EPIC },
        { feature: feature('Epic crumb on the feature page', is.upNext('epic-rows-in-the-sidebar')), holder: EPIC },
      ],
    },
    { chat: chat('What shipped this week?', 2 * HOUR), asksAbout: null, features: [] },
    {
      chat: chat('Onboarding', 3 * DAY),
      asksAbout: null,
      features: [
        { feature: firstRun, holder: EPIC },
        { feature: feature('Sample project on first open', is.workers(1, 5, 2)), holder: EPIC },
      ],
    },
  ]
  return {
    epics,
    other: [feature('Fix the flaky drive test', is.quiet(2, 1))],
    ...shelves(),
    total: 23,
    open: { kind: 'feature', id: firstRun.id },
  }
}

/** Asking: the chat asks about one of its features; that feature's row reads "Question above", so the epic row is the one yellow thing (decisions 2, 10). */
function asking(): Sample {
  const s = busy()
  const pay = s.epics[0]!
  const rest = s.epics.filter((e) => e.chat.title === 'Onboarding' || e.chat.title === 'Sidebar Epics')
  return { ...s, epics: [pay, ...rest], other: [], open: { kind: 'epic', id: pay.chat.id } }
}

/** Taken over: one feature is the human's ("Yours · …"), one is run by a different chat, one asks its epic's chat ("Asking above") (decision 10). */
function takenOver(): Sample {
  const owner = feature('Owner control in the header', is.needs('Plan to approve'))
  const epics: Epic[] = [
    {
      chat: chat('Feature Ownership', 1 * DAY, { state: 'working' }),
      asksAbout: null,
      features: [
        { feature: owner, holder: YOU },
        { feature: feature('Hand-back button', is.lead()), holder: other('Notes Triage') },
        { feature: feature('Owner in the row menu', is.consulting('Feature Ownership', 'Should Release also hand back?')), holder: YOU },
        { feature: feature('Typing warning strip', is.held('Feature Ownership', 'Plan to approve')), holder: EPIC },
      ],
    },
    {
      chat: chat('Notes Triage', 6 * HOUR, { state: 'working' }),
      asksAbout: null,
      features: [{ feature: feature('Note inbox sorts by age', is.workers(1, 4, 1)), holder: EPIC }],
    },
    {
      chat: chat('Payment System', 20 * HOUR),
      asksAbout: null,
      features: [{ feature: feature('Refunds', is.quiet(5, 2)), holder: EPIC }],
    },
  ]
  return { epics, other: [], ...shelves(), total: 23, open: { kind: 'feature', id: owner.id } }
}

/** A new chat the human just wrote in stays listed while a feature is open (decisions 3, 18). */
function newChat(): Sample {
  const s = busy()
  const refunds = s.epics[0]!.features[1]!.feature
  const fresh: Epic = {
    chat: chat('Can people pay with Apple Pay?', 1 * MIN, { state: 'working', lastHumanAt: now - MIN, updatedAt: now - 20_000 }),
    asksAbout: null,
    features: [],
  }
  return { ...s, epics: [fresh, ...s.epics], open: { kind: 'feature', id: refunds.id } }
}

/** Many: nine epics, 28 features in motion, to judge the list at scale. */
function many(): Sample {
  const named = (title: string, ago: number, state: ThreadEntry['state'], asksAbout: string | null, fs: [string, Partial<FeatureListItem>, EpicHolder?][]): Epic => ({
    chat: chat(title, ago, { state }),
    asksAbout,
    features: fs.map(([t, over, holder]) => ({ feature: feature(t, over), holder: holder ?? EPIC })),
  })
  const epics: Epic[] = [
    named('Payment System', 20 * HOUR, 'waiting', 'Checkout', [
      ['Checkout', is.held('Payment System', 'asking you')],
      ['Refunds', is.lead()],
      ['Invoice PDFs', is.upNext('checkout')],
      ['Coupon codes', is.quiet(4, 0)],
    ]),
    named('Feature Ownership', 1 * DAY, 'idle', null, [
      ['Owner control in the header', is.needs('Plan to approve'), YOU],
      ['Hand-back button', is.workers(2, 7, 3)],
      ['Typing warning strip', is.quiet(4, 1)],
      ['Owner in the row menu', is.held('Notes Triage', 'Agent working'), other('Notes Triage')],
    ]),
    named('Sidebar Epics', 5 * HOUR, 'working', null, [
      ['Epic rows in the sidebar', is.lead()],
      ['Epic crumb on the feature page', is.upNext('epic-rows-in-the-sidebar')],
      ['Name a chat at first cut', is.quiet(3, 1)],
    ]),
    named('Onboarding', 3 * DAY, 'idle', null, [
      ['First-run checklist', is.quiet(6, 4)],
      ['Sample project on first open', is.workers(1, 5, 2)],
      ['Welcome tour', is.needs('Design to approve', 'design')],
    ]),
    named('Notes Triage', 6 * HOUR, 'idle', null, [
      ['Note inbox sorts by age', is.workers(1, 4, 1)],
      ['Notes link to features', is.quiet(3, 0)],
      ['Pictures in notes', is.upNext('notes-link-to-features')],
    ]),
    named('Test Drives', 2 * DAY, 'waiting', null, [
      ['Drive setup scripts', is.held('Test Drives', 'Agent working')],
      ['Scenario fixtures', is.quiet(6, 4)],
      ['Phone-size drives', is.lead()],
    ]),
    named('Codex Runtime', 4 * DAY, 'idle', null, [
      ['Codex model picker', is.quiet(3, 2)],
      ['Codex permission prompts', is.needs('Ready to test', 'test')],
    ]),
    named('Launch Film', 5 * DAY, 'working', null, [
      ['Voice-over pass', is.workers(1, 3, 1)],
      ['Film cut for the site', is.quiet(2, 1)],
    ]),
    named('Phone App', 6 * DAY, 'idle', null, [
      ['Push when a chat asks', is.quiet(5, 2)],
      ['Phone sidebar drawer', is.lead()],
      ['Offline banner', is.upNext('phone-sidebar-drawer')],
    ]),
    { chat: chat('Why did the burn fail on Monday?', 3 * HOUR), asksAbout: null, features: [] },
  ]
  return {
    epics,
    other: [feature('Fix the flaky drive test', is.needs('Merge conflict', 'conflict')), feature('Bump Bun to 1.3', is.lead())],
    ...shelves(),
    total: 41,
    open: { kind: 'epic', id: epics[2]!.chat.id },
  }
}

/** Quiet: nothing in motion; the list is its "All N epics" and the shelves. */
function quiet(): Sample {
  const s = shelves()
  return { epics: [], other: [], ...s, total: 23, open: { kind: 'feature', id: s.shipped[0]!.feature.id } }
}

export type StateKey = 'busy' | 'asking' | 'taken-over' | 'new-chat' | 'many' | 'quiet'

export const STATES: { key: StateKey; label: string; make: () => Sample }[] = [
  { key: 'busy', label: 'Busy', make: busy },
  { key: 'asking', label: 'Asking', make: asking },
  { key: 'taken-over', label: 'Taken over', make: takenOver },
  { key: 'new-chat', label: 'New chat', make: newChat },
  { key: 'many', label: 'Many', make: many },
  { key: 'quiet', label: 'Quiet', make: quiet },
]
