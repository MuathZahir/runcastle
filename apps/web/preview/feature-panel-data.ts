import type { RouterOutputs } from '../src/lib/api'
import { listItem } from '../test/fixtures'
import briefMd from '../../../docs/features/the-whole-app-matches-the-sidebar/brief.md?raw'
import decisionsMd from '../../../docs/features/the-whole-app-matches-the-sidebar/decisions.md?raw'
import specMd from '../../../docs/features/the-whole-app-matches-the-sidebar/spec.md?raw'
import previewHtml from '../../../docs/features/the-whole-app-matches-the-sidebar/preview.html?raw'
import outcomeMd from '../../../docs/features/the-whole-app-matches-the-sidebar/outcome.md?raw'

/**
 * One feature, "The whole app matches the sidebar", standing at each step a
 * feature passes through, for the feature page's right panel
 * (docs/features/the-feature-s-right-panel-step-by-step). Its docs are the real
 * shipped feature's, read as text; the tickets, rounds and runs are made up.
 */

export const SLUG = 'the-whole-app-matches-the-sidebar'
export const FEATURE_ID = 'feat_panel'
export const TITLE = 'The whole app matches the sidebar'

export type Step = 'early' | 'plan' | 'docs' | 'reader' | 'tickets' | 'round' | 'ready' | 'shipped'

export const STEPS: { key: Step; label: string; view: string; doc?: string }[] = [
  { key: 'early', label: 'Plan, early', view: 'plan' },
  { key: 'plan', label: 'Plan', view: 'plan' },
  { key: 'docs', label: 'Details', view: 'details' },
  { key: 'reader', label: 'A doc open', view: 'details', doc: 'Menus today' },
  { key: 'tickets', label: 'Tickets', view: 'work' },
  { key: 'round', label: 'Round 2 running', view: 'work' },
  { key: 'ready', label: 'Ready', view: 'work' },
  { key: 'shipped', label: 'Shipped', view: 'details' },
]

const now = Date.now()
const min = 60_000

type Full = RouterOutputs['feature']['get']
type Ticket = Full['tickets'][number]

export const DOCS: Record<string, string> = {
  'brief.md': briefMd,
  'decisions.md': decisionsMd,
  'spec.md': specMd,
  'preview.html': previewHtml,
  'outcome.md': outcomeMd,
  'research/menus-today.md':
    '# Menus today\n\nEvery dropdown in the app measured on 2026-10-28.\n\n| Menu | Rows | Tallest |\n|---|---|---|\n| Scenarios | 31 | 980px |\n| Threads | 14 | 450px |\n| Models | 9 | 290px |\n\nThe scenarios menu ran off a 900px screen.\n',
}

const ticket = (seq: number, title: string, status: Ticket['status'], over: Partial<Ticket> = {}): Ticket =>
  ({
    id: `tkt_${seq}`,
    featureId: FEATURE_ID,
    seq,
    title,
    goal: '',
    context: '',
    acceptanceCriteria: [],
    seams: [],
    blockedBy: [],
    kind: 'implementation',
    status,
    commits: status === 'done' ? [`${seq}a1b2c3d4e5f6`] : [],
    ...over,
  }) as unknown as Ticket

const GOAL: Record<number, Partial<Ticket>> = {
  1: {
    goal: 'Hover and selection become see-through shades of the text colour, a selected row wears the card, and rows read at 14px, all from `theme.css`.',
    acceptanceCriteria: ['`surface-hover` and `surface-selected` are see-through in both themes', 'A `card` utility draws the fill and the hairline edge', 'A `md` 14/20 type step exists'],
    digest: 'Moved hover and selection onto see-through shades and named the card once. The contrast test now blends a see-through ground over the canvas before it measures.',
  },
  5: {
    goal: 'The design guide states the panel’s tabs, the panel column, the view bar and the reader.',
    acceptanceCriteria: ['DESIGN.md describes the panel’s tabs instead of the switcher menu', 'STYLE.md lists `PanelViewBar` and `DocReader`'],
  },
  7: {
    digest: 'Drove every screen beside the sidebar in both themes. Two findings: the scenarios menu still clips at 900px tall, and the light theme’s selected tab loses its edge on hover.',
  },
}

/**
 * The feature's tickets at each step: round 1 (four tickets) and round 2 (two
 * fixes and the review), so a step past round 1 shows a round folded above the
 * current one (decision 18).
 */
export function ticketsAt(step: Step): Ticket[] {
  if (step === 'early' || step === 'plan' || step === 'docs' || step === 'reader') return []
  const r1 = step === 'tickets' ? 'pending' : 'done'
  const round1 = [
    ticket(1, 'Theme: see-through hover, the card and the 14px row step', r1, { model: 'claude-opus-5-5[1m]' }),
    ticket(2, 'Primitives: rows, tabs and the floating family on the new tokens', r1, { blockedBy: [1], model: 'claude-opus-5-5[1m]' }),
    ticket(3, 'Sidebar: its own recipe moved onto the shared tokens', r1, { blockedBy: [1] }),
    ticket(4, 'Guide: DESIGN.md and STYLE.md amended', r1, { model: 'claude-haiku-5-5' }),
  ]
  if (step === 'tickets') return round1.map((t) => ({ ...t, ...GOAL[t.seq], digest: undefined }) as Ticket)
  const r2 = (running: Ticket['status']): Ticket['status'] => (step === 'round' ? running : 'done')
  return [
    ...round1,
    ticket(5, 'Guide: the panel’s tabs, view bar and reader', r2('burning'), { model: 'claude-haiku-5-5' }),
    ticket(6, 'Menus: the scenarios menu stops at ten rows', r2('failed'), {
      error: ['agent made no commits', 'The worker ran out of turns before writing the cap.'].join('\n'),
    }),
    ticket(7, 'Review: drive every screen beside the sidebar', r2('pending'), { kind: 'review', blockedBy: [5, 6] }),
  ].map((t) => ({ ...t, ...(GOAL[t.seq] ?? {}), ...(step === 'round' && t.seq === 7 ? { digest: undefined } : {}) }) as Ticket)
}

const docSummaries = Object.keys(DOCS)
  .filter((path) => path.endsWith('.md'))
  .map((relPath) => ({
    relPath,
    title:
      relPath === 'brief.md'
        ? 'Brief'
        : relPath === 'decisions.md'
          ? 'Decisions'
          : relPath === 'spec.md'
            ? 'Spec'
            : relPath === 'outcome.md'
              ? 'Outcome'
              : 'Menus today',
    updatedAt: now - 40 * min,
  }))

export function fullAt(step: Step): Full {
  const shipped = step === 'shipped'
  const running = step === 'round'
  const ran = step === 'round' || step === 'ready' || step === 'shipped'
  const item = listItem({ id: FEATURE_ID, slug: SLUG, status: shipped ? 'shipped' : 'active', lastActivityAt: now - 4 * min })
  return {
    feature: {
      ...item,
      title: TITLE,
      oneLiner: 'Bring the sidebar’s roomier, calmer style to every screen.',
      branch: `feature/${SLUG}`,
      createdAt: now - 26 * 60 * min,
      ...(shipped ? { shippedAt: now - 3 * 60 * min } : {}),
    },
    tickets: ticketsAt(step),
    sessions: [],
    runs: ran
      ? [
          {
            id: 'run_1',
            featureId: FEATURE_ID,
            workflow: 'ticket-burner',
            status: running ? 'running' : 'succeeded',
            startedAt: now - 22 * min,
            ...(running ? {} : { finishedAt: now - 4 * min }),
          },
        ]
      : [],
    // Early in planning: the brief and the decisions so far, no spec and no preview.
    docs:
      step === 'early'
        ? docSummaries.filter((d) => d.relPath === 'brief.md' || d.relPath === 'decisions.md')
        : docSummaries.filter((d) => shipped || d.relPath !== 'outcome.md'),
    preview: step === 'early' ? null : { relPath: 'preview.html', updatedAt: now - 40 * min },
    gate: { next: null, satisfied: false },
    dependsOn: [
      { featureId: 'feat_tokens', slug: 'theme-tokens', title: 'Theme tokens in one file', status: 'shipped', satisfied: true },
    ],
    blocks: [{ featureId: 'feat_round', slug: 'the-panel-s-round-review-and-shipped-views', title: 'The panel’s round, review and shipped views', upNext: true }],
    upNextProblem: null,
    leadAwaitsHuman: step === 'tickets',
  } as unknown as Full
}

export function roundsAt(step: Step) {
  if (step !== 'round' && step !== 'ready' && step !== 'shipped') return []
  const running = step === 'round'
  return [
    { round: 1, runId: 'run_0', status: 'succeeded', ticketSeqs: [1, 2, 3, 4], landed: [1, 2, 3, 4], failed: [], gates: { ok: true, failed: [] }, startedAt: now - 70 * min, finishedAt: now - 52 * min },
    {
      round: 2,
      runId: 'run_1',
      status: running ? 'running' : 'succeeded',
      ticketSeqs: [5, 6, 7],
      landed: running ? [] : [5, 6, 7],
      failed: running ? [6] : [],
      gates: running ? null : { ok: true, failed: [] },
      startedAt: now - 22 * min,
      finishedAt: running ? null : now - 4 * min,
    },
  ]
}
