import type { FileChange, ThreadItem, ToolCall } from '../src/lib/chat-thread'
import type { Handback } from '../src/components/workers/WorkerParts'

/**
 * Sample data for /preview/workers-handback.html (interactive-workers decisions
 * 4, 16, 21): the "Sidebar refresh" lead's chat after the human said yes to
 * its plan, with every way a handback ends and one failed worker. Made up.
 */

export const FEATURE = 'Sidebar refresh'
export const BRANCH = 'feature/sidebar-refresh'

const call = (over: Partial<ToolCall> & Pick<ToolCall, 'id' | 'kind' | 'title'>): ToolCall => ({ status: 'completed', ...over })
const file = (path: string, added: number, removed: number): FileChange => ({ path, added, removed, lines: [] })

/** One entry of the lead's chat: a thread item, or a worker's card the lead was woken by. */
export type LeadEntry =
  | { kind: 'item'; item: ThreadItem }
  | { kind: 'handback'; id: string; handback: Handback }
  | { kind: 'failed'; id: string; workerId: string; workerLabel: string; reason: string }

const item = (i: ThreadItem): LeadEntry => ({ kind: 'item', item: i })

export const ENTRIES: LeadEntry[] = [
  item({ kind: 'user', id: 'u1', text: 'The plan looks right. Go.' }),
  item({
    kind: 'agent',
    id: 'a1',
    model: 'Opus 5.5',
    text:
      'Started four workers:\n\n' +
      '- **Header** and **Thread list**, with you: each makes a first pass, then waits for you in the sidebar.\n' +
      '- **Worker list data** and **Amber dot rule**, on their own: they hand back when their tests pass.\n\n' +
      'I’ll land each handback as it comes.',
  }),
  {
    kind: 'handback',
    id: 'hb1',
    handback: {
      workerId: 'worker_header',
      workerLabel: 'Header',
      kind: 'with-you',
      summary:
        'Restyled the sidebar head to one 24px row: the project mark in its accent tile, search and "+" as quiet icon buttons. ' +
        'You asked for a **quieter search button** (it now sits on the canvas until hovered) and a **smaller switcher chevron** (10px, muted grey).',
      commits: 3,
      files: [file('apps/web/src/components/Sidebar.tsx', 18, 9), file('apps/web/src/components/ProjectSwitcher.tsx', 11, 6)],
      outcome: { kind: 'landed', into: BRANCH },
    },
  },
  item({
    kind: 'work',
    id: 'w2',
    seconds: 52,
    steps: [
      {
        kind: 'tools',
        id: 't2',
        calls: [
          call({ id: 'c1', kind: 'other', title: 'land_worker Header' }),
          call({ id: 'c2', kind: 'execute', title: 'bun run --cwd apps/web typecheck' }),
          call({ id: 'c3', kind: 'execute', title: 'bun run test apps/web/test/sidebar-row.test.ts' }),
        ],
      },
    ],
  }),
  item({ kind: 'agent', id: 'a2', model: 'Opus 5.5', text: 'Landed **Header**. Typecheck and the sidebar tests pass on the feature branch.' }),
  {
    kind: 'handback',
    id: 'hb2',
    handback: {
      workerId: 'worker_threads',
      workerLabel: 'Thread list',
      kind: 'with-you',
      summary:
        'The open feature’s rows are two lines now: the label, then the purpose in the muted grey, the status as the leading mark. ' +
        'You wanted the **Done fold closed by default** and the **count beside the word**, not in a well.',
      commits: 4,
      files: [
        file('apps/web/src/components/SidebarParts.tsx', 96, 22),
        file('apps/web/src/lib/workers.ts', 41, 0),
        file('apps/web/test/sidebar-row.test.ts', 38, 4),
        file('apps/web/preview/workers-sidebar.tsx', 120, 0),
      ],
      outcome: { kind: 'sent-back', note: 'Two rows overlap the Header worker’s changes to Sidebar.tsx; rebase on the feature branch and keep its head row as it landed.' },
    },
  },
  item({
    kind: 'agent',
    id: 'a3',
    model: 'Opus 5.5',
    text: 'Sent **Thread list** back to rebase on the landed Header; it will show "needs you" again when it is ready to look at.',
  }),
  {
    kind: 'failed',
    id: 'f1',
    workerId: 'worker_data',
    workerLabel: 'Worker list data',
    reason: 'container stopped unexpectedly',
  },
  item({
    kind: 'agent',
    id: 'a4',
    model: 'Opus 5.5',
    text: 'Its container ran out of memory during the server tests. I restarted **Worker list data** with the tests run one package at a time.',
  }),
  {
    kind: 'handback',
    id: 'hb3',
    handback: {
      workerId: 'worker_grain',
      workerLabel: 'Try a film grain behind the head',
      kind: null,
      summary: 'Swapped the halftone behind the sidebar head for a static grain at 4%. You looked at it and preferred the halftone, so **this is for the record only**.',
      commits: 1,
      files: [file('apps/web/src/components/SidebarParts.tsx', 14, 21)],
      outcome: { kind: 'dropped' },
    },
  },
  item({ kind: 'agent', id: 'a5', model: 'Opus 5.5', text: 'Dropped the grain worker, as you said — the halftone stays.' }),
]
