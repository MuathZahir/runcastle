import type { ModelEntry, Ticket } from '@runcastle/core'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import type { PanelView } from '../src/lib/feature-ui/panel'

/**
 * One feature, "Export notes as PDF", at each moment the feature page has to
 * say what is happening once there is no phase and no Go
 * (docs/features/tickets-and-review-are-tools-not-phases, decisions 7 and 8).
 */

export const TITLE = 'Export notes as PDF'

export const roster: ModelEntry[] = [
  { id: 'claude-opus-5-5[1m]', runtime: 'claude-code', note: 'UI/UX and involved work' },
  { id: 'claude-sonnet-5-5', runtime: 'claude-code', note: 'Most medium tasks' },
]

const ticket = (over: Partial<Ticket>): Ticket =>
  ({
    id: `t${over.seq}`,
    featureId: 'feat_pdf',
    lap: 1,
    goal: '',
    context: '',
    acceptanceCriteria: [],
    seams: [],
    blockedBy: [],
    kind: 'implementation',
    status: 'pending',
    commits: [],
    ...over,
  }) as Ticket

export function tickets(status: 'pending' | 'burning' | 'done'): Ticket[] {
  const at = (seq: number): Ticket['status'] =>
    status === 'done' ? 'done' : status === 'burning' ? (seq === 1 ? 'done' : 'burning') : 'pending'
  return [
    ticket({
      seq: 1,
      title: 'Export: render a note to PDF on the server',
      goal: 'A note renders to a PDF with its title and body, from one endpoint.',
      status: at(1),
    }),
    ticket({
      seq: 2,
      title: 'Export: the Export button and download',
      goal: 'The note menu offers Export as PDF and the browser downloads the file.',
      blockedBy: [1],
      status: at(2),
    }),
    ticket({
      seq: 3,
      title: 'Export: fonts and page breaks',
      goal: 'Long notes break across pages cleanly and keep the app font.',
      status: at(3),
    }),
  ]
}

export type Moment = 'talking' | 'asking' | 'working' | 'ready' | 'merged'

export interface MomentSample {
  key: Moment
  label: string
  status: FeatureStatus
  /** The views the panel offers at this moment, in switcher order. */
  views: PanelView[]
  /** The view open when the moment starts. */
  open: PanelView
  /** The agent's last words in the chat. */
  said: string
  /** The header's one button, if any. */
  action?: { label: string; danger?: boolean; secondary?: boolean }
  ledger?: 'pending' | 'burning' | 'done'
  /** How far this lap has landed, for the progress glyph. */
  progress: number
}


export const MOMENTS: MomentSample[] = [
  {
    key: 'talking',
    label: 'Talking',
    status: { kind: 'planning', label: 'Talking with you' },
    views: ['plan', 'design', 'details'],
    open: 'plan',
    said: 'Should the PDF carry the note’s tags, or only its title and body? I’d leave tags out: the brief asks for the note, not its filing.',
    progress: 0,
  },
  {
    key: 'asking',
    label: 'Asking to start',
    status: { kind: 'waiting', label: 'Waiting for you', why: 'start round 1?' },
    views: ['plan', 'work', 'design', 'details'],
    open: 'work',
    said: 'Three tickets are in Work, in the panel. Rendering and the button chain; fonts run beside them. Shall I start round 1?',
    ledger: 'pending',
    progress: 0,
  },
  {
    key: 'working',
    label: 'Working',
    status: { kind: 'working', label: 'Working · Round 1', round: 1 },
    views: ['plan', 'work', 'details'],
    open: 'work',
    said: 'Round 1 is out: three workers. I’ll check what comes back.',
    action: { label: 'Stop', danger: true },
    ledger: 'burning',
    progress: 1 / 3,
  },
  {
    key: 'ready',
    label: 'Ready',
    status: {
      kind: 'ready',
      label: 'Ready for you',
      why: 'Test drive ▸ Export a long note',
      scenario: 'Export a long note',
    },
    views: ['plan', 'work', 'review', 'drive', 'details'],
    open: 'review',
    said: 'Ready for you to drive. Notes now export to PDF: open the long sample note, choose Export as PDF from its menu, and open the file. The title heads page 1 and the body flows over three pages; a cut-off line or a missing page is broken. Checked: typecheck and tests green, and a review agent drove the export and found nothing.',
    action: { label: 'Start test drive' },
    ledger: 'done',
    progress: 1,
  },
  {
    key: 'merged',
    label: 'Merged',
    status: { kind: 'merged', label: 'Merged' },
    views: ['plan', 'work', 'review', 'details'],
    open: 'review',
    said: 'Merged to main.',
    ledger: 'done',
    progress: 1,
  },
]
