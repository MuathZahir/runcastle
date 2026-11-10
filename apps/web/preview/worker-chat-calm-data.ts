import type { ThreadItem, ToolCall } from '../src/lib/chat-thread'
import type { WorkerAssignment } from '../src/lib/workers'

/**
 * Sample data for /preview/worker-chat-calm.html (calmer-worker-chats
 * decisions 1, 3, 7, 8, 10, 11): an "on its own" worker of "Agents see the
 * tweaks you picked", part-way through its run. Every file and command is made up.
 */

export const FEATURE = 'Agents see the tweaks you picked'
export const BRANCH = 'feature/agents-see-the-tweaks-you-picked'

let n = 0
const call = (kind: ToolCall['kind'], title: string, over: Partial<ToolCall> = {}): ToolCall => ({ id: `c${++n}`, kind, title, status: 'completed', ...over })
const read = (path: string) => call('read', `Read ${path}`)
const edit = (path: string) => call('edit', `Edit ${path}`)
const run = (cmd: string) => call('execute', cmd)

export const ASSIGNMENT: WorkerAssignment = {
  label: 'Design report storage',
  purpose: 'Store each design’s state and tweaks, and hand them to the lead on Approve',
  kind: 'on-its-own',
  goal: [
    'Read first: docs/features/agents-see-the-tweaks-you-picked/spec.md (sections 2–4), decisions.md (decisions 3, 5, 8 and 11) and packages/server/src/services/designs.ts.',
    '',
    'Build the storage half of the feature:',
    '',
    '1. Core: a `DesignReport` schema in packages/core/src/schemas.ts — `{ type, state, tweaks }`, where `state` is a string or null and `tweaks` a flat record of strings, numbers and booleans. Export it from the package index.',
    '2. A migration that adds `last_report` (JSON text, nullable) to `designs`. Generate it with drizzle-kit, then rename it to the next free number so it sorts after 0071.',
    '3. Server: `design.report` (tRPC mutation) stores the latest report per design, emits `design.reported`, and refuses a report for a design that is not open. Keep only the newest; never keep a history.',
    '4. On Approve, copy the stored report into the approval event and into the line runcastle sends the lead: "Approved at state `<state>` with tweaks a=1, b=2." A design with no report says "no state or tweaks reported".',
    '5. Tests: the schema (good and bad shapes), the migration on an empty and a filled database, the mutation (stores, replaces, refuses), and the approval line in both shapes.',
    '',
    'Do not touch apps/web: the Design tab’s side of this is another worker’s. Do not change how designs are recorded or listed.',
    '',
    'When you are done, run the root typecheck and the server tests, commit with a conventional message, and hand back with what you built, what you tested and anything the lead should know.',
  ].join('\n'),
  doneWhen: 'The root typecheck and the server tests pass, and Approve hands the lead the stored state and tweaks.',
  model: 'Opus 5.5',
  startedBy: 'lead',
}

const KICKOFF =
  'Start your assignment: Build the storage half of docs/features/agents-see-the-tweaks-you-picked/spec.md.\n\n' +
  ASSIGNMENT.goal +
  '\n\nDone when: ' +
  ASSIGNMENT.doneWhen

/** The run so far: settled rows with words between them, then a stretch still running. */
export const ITEMS: ThreadItem[] = [
  { kind: 'user', id: 'k1', from: 'runcastle', text: KICKOFF },
  {
    kind: 'work',
    id: 'w1',
    seconds: 17,
    steps: [
      { kind: 'thought', id: 'th1', seconds: 3, text: 'Spec first, then the designs service and the schemas around it.' },
      {
        kind: 'tools',
        id: 't1',
        calls: [
          read('docs/features/agents-see-the-tweaks-you-picked/spec.md'),
          read('docs/features/agents-see-the-tweaks-you-picked/decisions.md'),
          read('packages/server/src/services/designs.ts'),
          call('search', 'Search designs.report'),
          read('packages/core/src/schemas.ts (1 - 400)'),
          read('packages/core/src/schemas.ts (400 - 820)'),
          call('search', 'Search design_approved'),
          read('packages/core/src/db/schema.ts'),
        ],
      },
    ],
  },
  { kind: 'agent', id: 'a1', model: 'Opus 5.5', text: 'Reading the code is done; I’m starting the core schema and helper now.' },
  {
    kind: 'work',
    id: 'w2',
    seconds: 32,
    steps: [
      {
        kind: 'tools',
        id: 't2',
        calls: [
          edit('packages/core/src/schemas.ts'),
          edit('packages/core/src/index.ts'),
          edit('packages/core/src/db/schema.ts'),
          run('bunx drizzle-kit generate'),
          read('packages/core/drizzle/0072_tidy_reports.sql'),
          call('move', 'Move packages/core/drizzle/0072_tidy_reports.sql packages/core/drizzle/0072_design_reports.sql'),
          run('bun run --filter @runcastle/core typecheck'),
          read('packages/core/drizzle/meta/_journal.json'),
          run('bunx vitest run packages/core/test/schemas.test.ts'),
        ],
      },
    ],
  },
  { kind: 'agent', id: 'a2', model: 'Opus 5.5', text: 'Core schema and migration are generated; renaming the migration and writing core tests next.' },
  {
    kind: 'work',
    id: 'w3',
    seconds: 81,
    steps: [
      {
        kind: 'subagent',
        id: 'sa1',
        title: 'Find every place an approval line is built',
        status: 'completed',
        calls: [
          call('search', 'Search Approved at'),
          read('packages/server/src/services/designs.ts'),
          read('packages/server/src/mcp/server.ts'),
          read('packages/server/src/services/outcome.ts'),
          call('search', 'Search design_approved'),
        ],
      },
      { kind: 'tools', id: 't3', calls: [read('packages/server/src/trpc/routers/design.ts'), read('packages/server/test/designs.test.ts')] },
    ],
  },
  { kind: 'agent', id: 'a3', model: 'Opus 5.5', text: 'The approval line is built in one place, `approveDesign`. Now the server: storing reports, copying at Approve, and the line.' },
  {
    kind: 'work',
    id: 'w4',
    seconds: 21,
    steps: [
      {
        kind: 'tools',
        id: 't4',
        calls: [
          call('other', 'mcp__runcastle__get_feature_context'),
          call('other', 'mcp__runcastle__read_feature_doc'),
          run('git log --oneline -5'),
        ],
      },
    ],
  },
  { kind: 'agent', id: 'a4', model: 'Opus 5.5', text: 'The other worker owns the Design tab, as the plan says, so I leave apps/web alone.' },
  {
    kind: 'work',
    id: 'w5',
    seconds: 8,
    steps: [
      {
        kind: 'thought',
        id: 'th2',
        seconds: 8,
        text: 'Keep only the newest report: an upsert on the design row, not a table of reports. A report for a closed design is refused, not stored for later.',
      },
    ],
  },
  { kind: 'agent', id: 'a5', model: 'Opus 5.5', text: 'One report per design, replaced each time; a closed design refuses it.' },
  {
    kind: 'work',
    id: 'w6',
    seconds: 49,
    steps: [
      {
        kind: 'tools',
        id: 't6',
        calls: [
          edit('packages/server/src/services/designs.ts'),
          edit('packages/server/src/trpc/routers/design.ts'),
          run('bun run --filter @runcastle/server typecheck'),
          edit('packages/server/src/services/designs.ts'),
          run('bun run --filter @runcastle/server typecheck'),
          run('bunx vitest run packages/server/test/designs.test.ts'),
          run('git add -A && git commit -m "feat(server): store design reports"'),
        ],
      },
    ],
  },
  { kind: 'agent', id: 'a6', model: 'Opus 5.5', text: 'Server code is in; adding its tests now.' },
  {
    kind: 'work',
    id: 'w7',
    seconds: 6,
    live: true,
    steps: [
      {
        kind: 'tools',
        id: 't7',
        calls: [read('packages/server/test/designs.test.ts (300 - 420)'), call('edit', 'Edit packages/server/test/designs.test.ts', { status: 'in_progress' })],
      },
    ],
  },
]

export type StateKey = 'folded' | 'assignment-open'

export const STATES: { key: StateKey; label: string; hint: string }[] = [
  { key: 'folded', label: 'Folded', hint: 'The assignment card starts folded to one line; each work row says what ran, then its time.' },
  { key: 'assignment-open', label: 'Assignment open', hint: 'A click on the line opens the card: the goal scrolls inside the same cap as a handback report.' },
]
