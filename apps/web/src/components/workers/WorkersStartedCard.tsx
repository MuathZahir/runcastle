import { WORKER_STATUS_TONE } from '../../lib/workers'
import type { WorkerKind, WorkerStatus } from '../../lib/workers'
import { IconPlay } from '../../icons'
import { cx } from '../../ui'
import { StatusDot } from '../../ui/status'
import { FeatureRow } from '../chat/thread/FeatureCards'
import { WELL } from '../chat/thread/surfaces'
import { WORKER_KIND_ICON } from './WorkerParts'

/**
 * The workers a lead's turn started, as one card in its chat
 * (calmer-worker-chats decisions 6, 10, 12): the orchestrator's features card
 * with workers for features. A heading counts them; each row names the worker,
 * says its purpose on one line, shows where it is now in plain words, and
 * opens its chat. The Review worker gets a row like any other, and a worker
 * sent back keeps its row, back to working.
 */

/** One worker a turn started: one row of the card. */
export interface WorkerStartedRow {
  workerId: string
  label: string
  /** Its one line: the purpose its lead wrote, or the first line of its goal (`workerLine`). */
  purpose: string
  kind: WorkerKind
  /** Where it is now, live. */
  status: WorkerStatus
}

/** A worker's status in the card's plain words: every real state, so the row never lies once it lands or fails. */
export const WORKER_STATUS_PLAIN: Record<WorkerStatus, string> = {
  queued: 'Waiting to start',
  working: 'Working',
  'needs-you': 'Waiting on you',
  'handed-back': 'Handed back',
  landed: 'Landed',
  dropped: 'Dropped',
  failed: 'Failed',
}

/** The words that call the human: amber for a worker waiting on them, red for one that failed. */
const STATUS_TEXT: Partial<Record<WorkerStatus, string>> = {
  'needs-you': 'text-warning-text',
  failed: 'text-danger-text',
}

/** Where a worker is now: its dot and its word, as a feature row's live state reads. */
export function WorkerLiveState({ status }: { status: WorkerStatus }) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap', STATUS_TEXT[status] ?? 'text-text-tertiary')}>
      <StatusDot tone={WORKER_STATUS_TONE[status]} />
      <span className="truncate">{WORKER_STATUS_PLAIN[status]}</span>
    </span>
  )
}

export function WorkersStartedCard({ rows, onOpenWorker }: { rows: readonly WorkerStartedRow[]; onOpenWorker: (workerId: string) => void }) {
  if (rows.length === 0) return null
  return (
    <div className={cx(WELL, '@container/card flex w-full max-w-[520px] min-w-0 flex-col p-1 animate-rise-in')}>
      <div className="flex min-w-0 items-center gap-2 px-2.5 pt-2 pb-1.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-text">
          <IconPlay size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-md font-medium text-text">
          {rows.length === 1 ? 'Started a worker' : `Started ${rows.length} workers`}
        </span>
      </div>
      <div className="flex min-w-0 flex-col border-t border-border-subtle pt-1">
        {rows.map((row) => (
          <FeatureRow
            key={row.workerId}
            title={row.label}
            glyph={<span className="inline-flex text-icon">{WORKER_KIND_ICON[row.kind]}</span>}
            detail={
              <span className="block truncate" title={row.purpose}>
                {row.purpose}
              </span>
            }
            state={<WorkerLiveState status={row.status} />}
            onOpen={() => onOpenWorker(row.workerId)}
          />
        ))}
      </div>
    </div>
  )
}
