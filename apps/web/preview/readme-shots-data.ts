import type { ProjectNote, ReviewPackage } from '@runcastle/core'
import type { FeatureListItem, RouterOutputs } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import { listItem } from '../test/fixtures'

/**
 * Sample data for the README's pictures (readme-shots.tsx): shiplog, a tiny
 * ship-journal app, in a project called runcastle-demo. Every feature, ticket,
 * chat, note and picture here is made up.
 */

const now = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const PROJECT_NAME = 'runcastle-demo'
export const REPO_PATH = '/home/you/code/shiplog'

type Full = RouterOutputs['feature']['get']
type Ticket = Full['tickets'][number]
type Need = NonNullable<FeatureListItem['need']>

const need = (kind: Need['kind'], words: string, ago: number): Need => ({ kind, words, held: false, since: now - ago }) as Need

const counts = (total: number, done: number, burning = 0) => ({
  total,
  pending: total - done - burning,
  burning,
  done,
  failed: 0,
  cancelled: 0,
})

// ---------------------------------------------------------------------------
// Realtime team collaboration — the feature in Planning, then building.

export const RT = { id: 'feat_rt', slug: 'realtime-team-collaboration', title: 'Realtime team collaboration' }

/** Ten tickets in dependency order, each with a model picked for it. */
const RT_TICKETS: { title: string; after: number[]; model: string }[] = [
  { title: 'Move entries into SQLite behind an injectable driver port', after: [], model: 'claude-opus-5-5' },
  { title: 'EventBus with a durable allowlist, and entry lifecycle events', after: [1], model: 'claude-sonnet-5-5' },
  { title: 'Feed history read: keyset pagination with actor and type filters', after: [2], model: 'gpt-6-sol' },
  { title: 'Retention pruning for the event log and the notification inbox', after: [2], model: 'claude-sonnet-5-5' },
  { title: 'WebSocket transport, identity minting, and the pure message router', after: [2], model: 'gpt-6-sol' },
  { title: 'Presence: heartbeat, idle, liveness, and the avatar stack', after: [5], model: 'claude-sonnet-5-5' },
  { title: 'Mentions: canonical tokens, recipient fan-out, and the composer typeahead', after: [2, 5], model: 'gpt-6-sol' },
  { title: 'Notification inbox: bell, unread count, live toast, and read state', after: [5, 7], model: 'claude-sonnet-5-5' },
  { title: 'Activity tab: live feed push, infinite scroll, filters, and gap-fill', after: [3, 5], model: 'gpt-6-sol' },
  { title: 'Backpressure and reconnect: drop-and-resync, no outbox', after: [5], model: 'claude-haiku-5-5' },
]

function ticket(featureId: string, seq: number, title: string, status: Ticket['status'], over: Partial<Ticket> = {}): Ticket {
  return {
    id: `${featureId}_t${seq}`,
    featureId,
    seq,
    title,
    goal: '',
    context: '',
    acceptanceCriteria: [],
    seams: [],
    blockedBy: [],
    kind: 'implementation',
    status,
    commits: status === 'done' ? [`${seq}e4f1a9c0b2d7`] : [],
    ...over,
  } as unknown as Ticket
}

export type RtStage = 'planning' | 'building'

export function rtTickets(stage: RtStage): Ticket[] {
  return RT_TICKETS.map((t, i) => {
    const seq = i + 1
    const status: Ticket['status'] = stage === 'planning' ? 'pending' : seq <= 2 ? 'done' : seq <= 5 ? 'burning' : 'pending'
    return ticket(RT.id, seq, t.title, status, { blockedBy: t.after, model: t.model })
  })
}

const RT_DOCS = [
  { relPath: 'brief.md', title: 'Brief', updatedAt: now - 2 * HOUR },
  { relPath: 'decisions.md', title: 'Decisions', updatedAt: now - 40 * MIN },
  { relPath: 'spec.md', title: 'Spec', updatedAt: now - 30 * MIN },
]

export function rtFull(stage: RtStage): Full {
  const building = stage === 'building'
  return {
    feature: {
      ...listItem({ id: RT.id, slug: RT.slug, status: 'active', lastActivityAt: now - 3 * MIN }),
      title: RT.title,
      oneLiner: 'Everyone on the team posts to one shared feed, live.',
      branch: `feature/${RT.slug}`,
      createdAt: now - 3 * DAY,
      ...(building ? {} : { waitingReason: 'start round 1?' }),
    },
    tickets: rtTickets(stage),
    sessions: [],
    runs: building ? [{ id: 'run_rt1', featureId: RT.id, workflow: 'ticket-burner', status: 'running', startedAt: now - 23 * MIN }] : [],
    docs: RT_DOCS,
    preview: null,
    gate: { next: null, satisfied: false },
    dependsOn: [],
    blocks: [],
    upNextProblem: null,
    need: building ? null : need('plan', 'Plan to approve', 4 * MIN),
    leadAwaitsHuman: !building,
    leadInBackground: false,
  } as unknown as Full
}

export function rtRounds(stage: RtStage) {
  if (stage !== 'building') return []
  return [
    { round: 1, runId: 'run_rt1', status: 'running', ticketSeqs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], landed: [1, 2], failed: [], gates: null, startedAt: now - 23 * MIN, finishedAt: null },
  ]
}

// ---------------------------------------------------------------------------
// Entry tags — the feature in Review.

export const TAGS = { id: 'feat_tags', slug: 'entry-tags', title: 'Entry tags' }

export function tagsFull(): Full {
  return {
    feature: {
      ...listItem({ id: TAGS.id, slug: TAGS.slug, status: 'active', lastActivityAt: now - 6 * MIN }),
      title: TAGS.title,
      oneLiner: 'Tag an entry, and filter the feed by tag.',
      branch: `feature/${TAGS.slug}`,
      createdAt: now - 2 * DAY,
    },
    tickets: [
      ticket(TAGS.id, 1, 'Tags table and the entry-to-tag link', 'done', { model: 'claude-sonnet-5-5' }),
      ticket(TAGS.id, 2, 'Tag chips on an entry, with add, suggest and remove', 'done', { blockedBy: [1], model: 'gpt-6-sol' }),
      ticket(TAGS.id, 3, 'Filter the feed by one or more tags', 'done', { blockedBy: [1], model: 'claude-sonnet-5-5' }),
      ticket(TAGS.id, 4, 'Review: test drive tagging and filtering end to end', 'done', { blockedBy: [2, 3], kind: 'review', commits: [] }),
    ],
    sessions: [],
    runs: [{ id: 'run_tags1', featureId: TAGS.id, workflow: 'ticket-burner', status: 'succeeded', startedAt: now - 58 * MIN, finishedAt: now - 9 * MIN }],
    docs: [
      { relPath: 'brief.md', title: 'Brief', updatedAt: now - DAY },
      { relPath: 'decisions.md', title: 'Decisions', updatedAt: now - DAY },
      { relPath: 'spec.md', title: 'Spec', updatedAt: now - DAY },
    ],
    preview: null,
    gate: { next: null, satisfied: false },
    dependsOn: [],
    blocks: [],
    upNextProblem: null,
    need: need('merge', 'Ready to merge', 8 * MIN),
    leadAwaitsHuman: false,
    leadInBackground: false,
  } as unknown as Full
}

export const tagsRounds = [
  { round: 1, runId: 'run_tags1', status: 'succeeded', ticketSeqs: [1, 2, 3, 4], landed: [1, 2, 3, 4], failed: [], gates: { ok: true, failed: [] }, startedAt: now - 58 * MIN, finishedAt: now - 9 * MIN },
]

/** A made-up screenshot of shiplog, at a desktop's proportions. */
function picture(heading: string, rows: { mood: 'win' | 'grind' | 'block'; tags?: string[] }[], extra = ''): string {
  const moodFill = { win: ['#173a26', '#5fd08a'], grind: ['#3b3214', '#e6c35c'], block: ['#3d1c1f', '#f08a8f'] }
  const cards = rows
    .map((r, i) => {
      const y = 330 + i * 130
      const [bg, fg] = moodFill[r.mood]
      const chips = (r.tags ?? [])
        .map((t, j) => `<rect x="${640 + j * 130}" y="${y + 24}" width="118" height="30" rx="15" fill="#22324d"/><text x="${699 + j * 130}" y="${y + 45}" fill="#8db4ff" font-size="17" text-anchor="middle">#${t}</text>`)
        .join('')
      return `<rect x="380" y="${y}" width="680" height="112" rx="14" fill="#1c1f26" stroke="#2c3039"/><rect x="404" y="${y + 24}" width="70" height="26" rx="6" fill="${bg}"/><text x="439" y="${y + 43}" fill="${fg}" font-size="14" font-weight="700" text-anchor="middle">${r.mood.toUpperCase()}</text>${chips}<rect x="404" y="${y + 66}" width="${420 - i * 40}" height="14" rx="4" fill="#3a4150"/>`
    })
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900" font-family="system-ui, sans-serif">
<rect width="1440" height="900" fill="#15171c"/>
<text x="380" y="118" fill="#e8e9ec" font-size="48" font-weight="700">${heading}</text>
<rect x="380" y="150" width="680" height="76" rx="12" fill="#1c1f26" stroke="#2c3039"/>
<rect x="380" y="244" width="130" height="48" rx="10" fill="#1c1f26" stroke="#2c3039"/>
<rect x="522" y="244" width="96" height="48" rx="10" fill="#3b82f6"/>
${cards}${extra}
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

let shotN = 0
const shot = (caption: string, src: string) => ({ id: `shot_${++shotN}`, src, caption })

const TAGGED = [
  { mood: 'win' as const, tags: ['release', 'export'] },
  { mood: 'grind' as const, tags: ['bug'] },
  { mood: 'block' as const },
]
const SUGGEST =
  '<rect x="640" y="354" width="260" height="150" rx="10" fill="#232731" stroke="#363b47"/><text x="664" y="392" fill="#e8e9ec" font-size="18">#release</text><text x="664" y="432" fill="#9aa0ab" font-size="18">#refactor</text><text x="664" y="472" fill="#9aa0ab" font-size="18">#research</text>'

export const TAGS_PACKAGE: ReviewPackage = {
  ticketId: `${TAGS.id}_t4`,
  featureId: TAGS.id,
  seq: 4,
  round: 1,
  passKind: 'review',
  verdict: 'Verified on a test drive: tags add, suggest and filter as the spec asks. Checks 2 of 2 passed. No defects found.',
  account:
    'Tagging an entry works from the entry itself, and typing a tag suggests the ones already in use. The feed filters by one tag or several, and the filter survives a reload. Both checks (unit tests, typecheck) passed on this build.',
  commitsSince: 0,
  hasWalkthrough: true,
  groups: [
    {
      id: 'g1',
      name: 'Tagging an entry',
      shots: [
        shot('An entry before tagging', picture('shiplog', [{ mood: 'win' }, { mood: 'grind' }, { mood: 'block' }])),
        shot('Typing a tag suggests the ones already in use', picture('shiplog', [{ mood: 'win', tags: ['re'] }, { mood: 'grind' }, { mood: 'block' }], SUGGEST)),
        shot('The tag shows as a chip on the entry', picture('shiplog', TAGGED)),
      ],
      calls: [],
    },
    {
      id: 'g2',
      name: 'Filtering the feed',
      shots: [
        shot('The feed filtered to #release', picture('#release', [{ mood: 'win', tags: ['release', 'export'] }, { mood: 'win', tags: ['release'] }])),
        shot('Two tags at once narrow the feed', picture('#release #export', [{ mood: 'win', tags: ['release', 'export'] }])),
      ],
      calls: [],
    },
    {
      id: 'g3',
      name: 'Other checks',
      shots: [shot('A tag with spaces is refused, with a line saying why', picture('shiplog', TAGGED))],
      calls: [],
    },
  ],
  findings: [],
  empty: null,
}

// ---------------------------------------------------------------------------
// The sidebar's features.

function f(id: string, title: string, over: Partial<FeatureListItem>, ago: number): FeatureListItem {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')
  return { ...listItem({ id, slug, lastActivityAt: now - ago, ...over }), title, branch: `feature/${slug}`, ...over } as FeatureListItem
}

export type Stage = 'planning' | 'building' | 'review'

/** Every feature of the project, with Realtime team collaboration at `stage`. */
export function features(stage: RtStage): FeatureListItem[] {
  const building = stage === 'building'
  return [
    f(
      RT.id,
      RT.title,
      building
        ? { workersWorking: 1, ticketCounts: counts(10, 2, 3) }
        : { ticketCounts: counts(10, 0), need: need('plan', 'Plan to approve', 4 * MIN), leadAwaitsHuman: true },
      3 * MIN,
    ),
    f('feat_empty', 'Clarify the empty entry error', { need: need('answer', 'Needs your answer · block an empty entry, or warn?', 12 * MIN), ticketCounts: counts(1, 1) }, 12 * MIN),
    f(TAGS.id, TAGS.title, { need: need('merge', 'Ready to merge', 8 * MIN), ticketCounts: counts(3, 3) }, 8 * MIN),
    f('feat_digest', 'Weekly digest email', { liveSession: { status: 'live', awaitingInput: false } as FeatureListItem['liveSession'] }, 26 * MIN),
    f('feat_search', 'Search entries by text', { status: 'draft' }, 2 * DAY),
    f('feat_csv', 'Export entries as CSV', { status: 'draft' }, 3 * DAY),
    ...['Streak counter', 'Keyboard shortcuts', 'Markdown export', 'Entry feed', 'Mood filter'].map((t, i) =>
      f(`feat_s${i}`, t, { status: 'shipped' }, (5 + i * 3) * DAY),
    ),
  ]
}

// ---------------------------------------------------------------------------
// Chats.

function chat(id: string, title: string, ago: number, state: ThreadEntry['state'] = 'idle', role: ThreadEntry['role'] = 'project'): ThreadEntry {
  return { id, title, role, state, createdAt: now - ago - 20 * MIN, updatedAt: now - ago, runtime: 'claude-code' }
}

export const ORCH_CHATS: ThreadEntry[] = [
  chat('c1', 'Shared team feed with a Friday recap', 2 * MIN, 'waiting'),
  chat('c2', 'Triage the notes from Tuesday’s drive', 3 * HOUR),
  chat('c3', 'Why does the feed jump on reload?', 26 * HOUR),
  chat('c4', 'Plan the tags rollout', 2 * DAY),
  chat('c5', 'Cut the v1 launch list', 4 * DAY),
  chat('c6', 'Streak counter: what counts as a day?', 9 * DAY),
]

type Ev = Record<string, unknown>
let evI = 0
const ev = (at: number, body: Ev): Ev => ({ i: evI++, at, ...body })
const tool = (at: number, id: string, kind: string, title: string): Ev => ev(at, { type: 'tool', call: { id, kind, title, status: 'completed' } })

/** The orchestrator, given an idea for a shared team feed with a Friday recap. */
export const ORCH_LOG: Ev[] = [
  ev(now - 4 * MIN, {
    type: 'prompt',
    id: 'p1',
    source: 'human',
    text: 'I want shiplog to work for small teams: everyone posts to one shared feed, you can see who did what, and on Friday the whole team gets a recap email of what shipped.',
  }),
  ev(now - 4 * MIN, { type: 'turn_started' }),
  tool(now - 4 * MIN, 't1', 'other', 'list_features'),
  tool(now - 4 * MIN, 't2', 'other', 'get_feature_context realtime-team-collaboration'),
  tool(now - 4 * MIN, 't3', 'other', 'get_feature_context weekly-digest-email'),
  tool(now - 3 * MIN, 't4', 'read', 'docs/features/realtime-team-collaboration/spec.md'),
  tool(now - 3 * MIN, 't5', 'read', 'docs/features/weekly-digest-email/decisions.md'),
  ev(now - 2 * MIN, {
    type: 'agent_text',
    messageId: 'm1',
    text: [
      'I checked what is built and in flight first: about two-thirds of this already exists.',
      '',
      '**What already covers it**',
      '',
      '- **The shared feed and "who did what"** is mostly *Realtime team collaboration* (in Build, round 1 running). It gives one workspace, a name and colour per person, and an Activity tab you can filter by person.',
      '- **The Friday email** sits next to *Weekly digest email* (in Planning, spec written). That one is a personal digest: one recipient, Tuesday 9 AM. Several recipients and a real email provider are both out of its scope.',
      '',
      '**What neither covers**',
      '',
      '1. Entries have no author. The Activity tab will say "Sam created an entry", but the feed itself still won’t show who posted what.',
      '2. Nobody has an email address. Realtime’s identity is just a name and a colour, so a recap has nowhere to go.',
      '3. A team recap is a different email from the personal digest, but it can share the sending code.',
      '',
      'First question, since it decides whether there is a big foundation feature in this: **what does "team" mean here?**',
      '',
      '- **One install is one team** (my recommendation). No login; each person adds an email to the name they already have. This matches Realtime’s "one workspace" and keeps the gap to a thin feature.',
      '- **Real accounts.** Signup, login, maybe several teams per install. That is its own large feature everything else would wait on.',
      '',
      'Which is it?',
    ].join('\n'),
  }),
  ev(now - 2 * MIN, { type: 'turn_ended', reason: 'end_turn' }),
]

/** Realtime team collaboration's own chat, at each stage. */
export function rtLog(stage: RtStage): Ev[] {
  const base: Ev[] = [
    ev(now - 50 * MIN, { type: 'prompt', id: 'rp1', source: 'human', text: 'The plan reads right. Cut it into tickets.' }),
    ev(now - 50 * MIN, { type: 'turn_started' }),
    tool(now - 48 * MIN, 'rt1', 'read', 'docs/features/realtime-team-collaboration/spec.md'),
    tool(now - 46 * MIN, 'rt2', 'other', 'emit_tickets'),
    ev(now - 45 * MIN, {
      type: 'agent_text',
      messageId: 'rm1',
      text: (stage === 'building'
        ? [
            'Ten tickets, in the order they can land. Each one waits only on the tickets it needs, so after #2 lands, #3, #4 and #5 build side by side. I picked a model for each.',
            '',
            'Say yes and I start round 1.',
          ]
        : [
        'Ten tickets, in the order they can land. Each one waits only on the tickets it needs, so after #2 lands, #3, #4 and #5 build side by side.',
        '',
        '- **#1** moves entries into SQLite first, since everything else writes through it.',
        '- **#5** is the WebSocket transport; presence, mentions and the inbox all sit on it.',
        '- **#9** and **#10** come last: the Activity tab, and what happens when a connection drops.',
        '',
        'I picked a model for each: the two foundation tickets on Opus and Sonnet, the mechanical ones on gpt-6-sol, and the small reconnect ticket on Haiku. Change any of them in the Tickets panel.',
        '',
        'Say yes and I start round 1.',
      ]).join('\n'),
    }),
    ev(now - 45 * MIN, { type: 'turn_ended', reason: 'end_turn' }),
  ]
  if (stage === 'planning') return [...base, ev(now - 44 * MIN, { type: 'suggestion', text: 'Yes, start round 1' })]
  return [
    ...base,
    ev(now - 24 * MIN, { type: 'prompt', id: 'rp2', source: 'human', text: 'Yes, start round 1.' }),
    ev(now - 24 * MIN, { type: 'turn_started' }),
    tool(now - 23 * MIN, 'rt3', 'other', 'dispatch_round'),
    ev(now - 23 * MIN, {
      type: 'agent_text',
      messageId: 'rm2',
      text: 'Round 1 is running. #1 and #2 go first, one after the other; the rest start as soon as what they need has landed. I’ll check each ticket as it lands and tell you if one fails. You can close the tab.',
    }),
    ev(now - 23 * MIN, { type: 'turn_ended', reason: 'end_turn' }),
    ev(now - 4 * MIN, { type: 'prompt', id: 'rp3', source: 'runcastle', text: 'Ticket #2 landed.' }),
    ev(now - 4 * MIN, { type: 'turn_started' }),
    ev(now - 3 * MIN, {
      type: 'agent_text',
      messageId: 'rm3',
      text: '#1 and #2 have landed and their tests pass. #3, #4 and #5 are building now, in parallel. Nothing needs you yet.',
    }),
    ev(now - 3 * MIN, { type: 'turn_ended', reason: 'end_turn' }),
  ]
}

/** Entry tags' chat: the review round's package, and the lead's word on it. */
export const TAGS_LOG: Ev[] = [
  ev(now - 70 * MIN, { type: 'prompt', id: 'tp1', source: 'human', text: 'Yes, start round 1.' }),
  ev(now - 70 * MIN, { type: 'turn_started' }),
  tool(now - 69 * MIN, 'tt1', 'other', 'dispatch_round'),
  ev(now - 69 * MIN, { type: 'agent_text', messageId: 'tm1', text: 'Round 1 is running: three tickets, then a review round that test drives the result.' }),
  ev(now - 69 * MIN, { type: 'turn_ended', reason: 'end_turn' }),
  ev(now - 9 * MIN, { type: 'prompt', id: 'tp2', source: 'runcastle', text: 'Round 1 finished.' }),
  ev(now - 9 * MIN, { type: 'turn_started' }),
  tool(now - 9 * MIN, 'tt2', 'other', 'show_review_package'),
  ev(now - 8 * MIN, { type: 'review_package', ticketId: TAGS_PACKAGE.ticketId }),
  ev(now - 8 * MIN, {
    type: 'agent_text',
    messageId: 'tm2',
    text: 'All three tickets landed and the review round verified them on a test drive: tagging, suggestions and the feed filter all work, and both checks passed. The walkthrough is in the package above. It’s ready to merge, or test drive it yourself first.',
  }),
  ev(now - 8 * MIN, { type: 'turn_ended', reason: 'end_turn' }),
]

export const FEATURE_CHATS: Record<string, ThreadEntry[]> = {
  [RT.id]: [chat('rt_main', 'Shape the live team feed', 3 * MIN, 'idle', 'main')],
  [TAGS.id]: [chat('tags_main', 'Tags on entries', 8 * MIN, 'waiting', 'main')],
}

// ---------------------------------------------------------------------------
// Notes.

const note = (id: string, text: string, ago: number, extra: Partial<ProjectNote> = {}): ProjectNote => ({
  id,
  projectId: 'proj_1',
  text,
  status: 'open',
  createdAt: now - ago,
  updatedAt: now - ago,
  ...extra,
})

/** Three open notes, from before today's drive. */
export const OPEN_NOTES: ProjectNote[] = [
  note('n1', 'The empty feed says "No entries" while it is still loading. Show a skeleton instead.', 33 * MIN, { driveBranch: 'main', driveCommit: '950d42c' }),
  note('n2', 'Mood chips wrap onto a second line at phone width.', 56 * MIN, { driveBranch: 'main', driveCommit: '950d42c' }),
  note('n3', 'Let me press N anywhere to start a new entry.', 3 * HOUR),
  note('n4', 'Streak counter resets at midnight UTC, not local midnight', 2 * DAY, { status: 'triaged', outcome: 'routed into' }),
]

/** The note just taken on this drive. */
export const DRIVE_NOTE: ProjectNote = note('n0', '"Log it" stays enabled with an empty box, and posting it adds a blank entry.', 1 * MIN, {
  driveBranch: 'main',
  driveCommit: '950d42c',
})

export const DRIVE_STARTED_AT = now - 9 * MIN
