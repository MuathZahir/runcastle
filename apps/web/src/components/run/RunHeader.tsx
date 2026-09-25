import { useState } from 'react'
import type { RunStatus } from '@runcastle/core'
import { Button, MetaLine, RunStatusChip } from '../../ui'
import { IconArrowLeft, IconClock, IconCube, IconStop } from '../../icons'
import { ConfirmDialog } from './ConfirmDialog'
import { DANGER_GHOST } from './actions'
import { RunPicker } from './RunPicker'
import type { RunOption } from './RunPicker'

/**
 * The run's own header, over the lanes (decision #10): a heading, then one line
 * of facts — status, elapsed, how many tickets landed, the honest counts — and
 * the run-level controls on the heading's right. Nothing else: the lanes below
 * are the page's spine, and a header that grew a summary of them would be the
 * digest wall this redesign is removing from the review page.
 *
 * The counts are {@link runHeadline}'s, so a stopped lane is never reported as a
 * failure and a solo per-ticket retry says so instead of speaking whole-run
 * numbers (decisions #12b, #14c).
 *
 * The run history hangs off it (decision #15b): a quiet select opens the
 * feature's past runs, and picking one puts the header into record mode — the
 * run is named as history, with the way back to the latest beside it.
 */
export function RunHeader({
  headline,
  elapsed,
  status,
  landed,
  burning,
  busy,
  cancelling,
  onCancelRun,
  runs = [],
  selectedRunId = null,
  latestRunId = null,
  onPickRun,
  onBackToLatest,
}: {
  headline: string
  elapsed: string
  status?: RunStatus
  /** Tickets done out of the lanes shown. */
  landed?: { done: number; total: number }
  /** Lanes with a live agent — the blast radius Cancel run states. */
  burning: number
  busy?: boolean
  /**
   * The cancel is in flight. It resolves only once every agent of the run is
   * confirmed dead, so the button holds the wait instead of the run reading
   * cancelled while its containers are still burning.
   */
  cancelling?: boolean
  /** Set only while the run can still be cancelled. */
  onCancelRun?: () => void
  /** The feature's runs, newest first — what the history select offers. */
  runs?: readonly RunOption[]
  selectedRunId?: string | null
  latestRunId?: string | null
  onPickRun?: (runId: string) => void
  /** Set only in record mode — leaving it returns to the run in flight. */
  onBackToLatest?: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <header className="mb-4 flex flex-col gap-1.5">
      <div className="flex min-h-7 items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 text-lg font-semibold text-text">
          {onBackToLatest ? 'Past run' : 'Run'}
        </h2>
        {onPickRun && (
          <RunPicker runs={runs} selectedId={selectedRunId} latestId={latestRunId} onPick={onPickRun} />
        )}
        {onBackToLatest && (
          <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={onBackToLatest}>
            Back to latest
          </Button>
        )}
        {onCancelRun && (
          <Button
            variant="ghost"
            size="sm"
            icon={<IconStop />}
            loading={cancelling}
            disabled={busy}
            className={DANGER_GHOST}
            onClick={() => setConfirming(true)}
          >
            {cancelling ? 'Stopping…' : 'Cancel run'}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {status && <RunStatusChip status={status} />}
        <MetaLine
          items={[
            elapsed ? { icon: <IconClock />, text: <span className="tabular-nums">{elapsed}</span> } : null,
            landed && landed.total > 0
              ? { icon: <IconCube />, strong: `${landed.done} of ${landed.total}`, text: 'landed' }
              : null,
            { text: headline },
          ]}
        />
      </div>

      {onCancelRun && (
        <ConfirmDialog
          open={confirming}
          title="Cancel this run?"
          body={
            burning > 0
              ? `Stops ${burning} burning agent${burning === 1 ? '' : 's'}. Finished work is kept; the burn can resume later.`
              : 'Stops the run before its remaining tickets start. Finished work is kept; the burn can resume later.'
          }
          confirmLabel="Cancel run"
          confirmIcon={<IconStop />}
          busy={busy}
          onConfirm={onCancelRun}
          onClose={() => setConfirming(false)}
        />
      )}
    </header>
  )
}
