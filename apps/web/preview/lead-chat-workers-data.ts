import type { ThreadItem, ToolCall } from '../src/lib/chat-thread'
import type { Handback } from '../src/components/workers/WorkerParts'
import { workerLine } from '../src/components/workers/WorkerParts'
import type { WorkerStartedRow } from '../src/components/workers/WorkersStartedCard'

/**
 * Sample data for /preview/lead-chat-workers.html (calmer-worker-chats
 * decisions 2, 6, 10, 12): the "Agents see the tweaks you picked" lead's chat
 * after the human said yes to its plan. It starts two workers; later one hands
 * back a long report and the lead starts the Review worker. Made up.
 */

export const FEATURE = 'Agents see the tweaks you picked'
export const BRANCH = 'feature/agents-see-the-tweaks-you-picked'

export type StateKey = 'started' | 'handed-back' | 'report-open'

export const STATES: { key: StateKey; label: string; hint: string }[] = [
  { key: 'started', label: 'Started', hint: 'The human says yes; the lead’s turn ends with one card for the two workers it started.' },
  { key: 'handed-back', label: 'Handed back', hint: 'The rows say where each worker is now; the handback shows only its first paragraph.' },
  { key: 'report-open', label: 'Report open', hint: '“Show more” opens the rest of the report in a box that scrolls at the cap.' },
]

let n = 0
const call = (kind: ToolCall['kind'], title: string): ToolCall => ({ id: `c${++n}`, kind, title, status: 'completed' })

/** The two workers the plan names; the purpose line falls back to the goal's first line when it is empty. */
const STORAGE = {
  workerId: 'worker_storage',
  label: 'Design report storage',
  kind: 'on-its-own' as const,
  purpose: workerLine({ purpose: 'Store each design’s state and tweaks, and hand them to the lead on Approve' }),
}
const TAB = {
  workerId: 'worker_tab',
  label: 'Design tab tweaks',
  kind: 'with-you' as const,
  purpose: workerLine({
    purpose: '',
    goal: 'Show the reported state and tweaks under the design, and let the human tweak them live.\n\nRead first: …',
  }),
}
const REVIEW = {
  workerId: 'worker_review',
  label: 'Review worker',
  kind: 'review' as const,
  purpose: 'Review the storage half against the spec and try it in the app',
}

/** One entry of the lead's chat: a thread item, a workers card, or a handback. */
export type LeadEntry =
  | { kind: 'item'; item: ThreadItem }
  | { kind: 'workers'; id: string; rows: WorkerStartedRow[] }
  | { kind: 'handback'; id: string; handback: Handback }

const item = (i: ThreadItem): LeadEntry => ({ kind: 'item', item: i })

const REPORT = [
  'Built the storage half: the core schema and its migration, the `design.report` mutation, and the stored state and tweaks copied into Approve and into the line you get. The root typecheck and the server tests pass, and one thing needs your call before the Design tab worker lands.',
  '## What I built',
  '- **Core:** `DesignReport` in `packages/core/src/schemas.ts` (`{ type, state, tweaks }`), exported from the index.',
  '- **Migration 0072:** adds `last_report` (JSON text, nullable) to `designs`. Generated with drizzle-kit and renamed so it sorts after 0071.',
  '- **Server:** `design.report` stores the newest report per design, emits `design.reported`, and refuses a design that is not open. It keeps no history.',
  '- **Approve:** copies the stored report into the approval event and into the line you get: "Approved at state `folded` with tweaks time=shown." A design with no report says "no state or tweaks reported".',
  '## What I tested',
  '- The schema with good and bad shapes (a nested object in `tweaks` is refused).',
  '- The migration on an empty and a filled database.',
  '- The mutation: it stores, replaces, and refuses a closed design.',
  '- The approval line in both shapes.',
  '## For you',
  'The plan said "refuse a report for a design that is not open", but a design closed in the same second as its last report loses that report. I kept the refusal as written; if you would rather keep the last report, it is a one-line change in `reportDesign`.',
  'The Design tab worker reads `last_report` through `design.get`; I added the field there but left its UI alone, as the plan asked.',
].join('\n\n')

/** The whole chat for a state: the same opening, then what has happened since. */
export function entriesFor(state: StateKey): LeadEntry[] {
  const later = state !== 'started'
  const opening: LeadEntry[] = [
    item({ kind: 'user', id: 'u1', text: 'Yes' }),
    item({
      kind: 'work',
      id: 'w1',
      seconds: 9,
      steps: [
        {
          kind: 'tools',
          id: 't1',
          calls: [call('other', 'mcp__runcastle__start_worker'), call('other', 'mcp__runcastle__start_worker')],
        },
      ],
    }),
    item({
      kind: 'agent',
      id: 'a1',
      model: 'Opus 5.5',
      text: 'Started both workers. **Design report storage** works on its own and hands back when its tests pass; **Design tab tweaks** makes a first pass, then waits for you in its chat.',
    }),
    {
      kind: 'workers',
      id: 'cw1',
      rows: [
        { ...STORAGE, status: later ? 'handed-back' : 'working' },
        { ...TAB, status: later ? 'needs-you' : 'working' },
      ],
    },
  ]
  if (!later) return opening
  return [
    ...opening,
    {
      kind: 'handback',
      id: 'hb1',
      handback: {
        workerId: STORAGE.workerId,
        workerLabel: STORAGE.label,
        kind: STORAGE.kind,
        summary: REPORT,
        commits: 4,
        files: [
          { path: 'packages/core/src/schemas.ts', added: 24, removed: 0 },
          { path: 'packages/core/drizzle/0072_design_reports.sql', added: 1, removed: 0 },
          { path: 'packages/server/src/services/designs.ts', added: 61, removed: 8 },
          { path: 'packages/server/src/trpc/routers/design.ts', added: 14, removed: 1 },
          { path: 'packages/server/test/designs.test.ts', added: 132, removed: 0 },
        ],
      },
    },
    item({
      kind: 'work',
      id: 'w2',
      seconds: 14,
      steps: [{ kind: 'tools', id: 't2', calls: [call('other', 'mcp__runcastle__start_review')] }],
    }),
    item({
      kind: 'agent',
      id: 'a2',
      model: 'Opus 5.5',
      text: 'Storage is back and its tests pass. I started the Review worker on it while **Design tab tweaks** waits on you.',
    }),
    { kind: 'workers', id: 'cw2', rows: [{ ...REVIEW, status: 'working' }] },
  ]
}
