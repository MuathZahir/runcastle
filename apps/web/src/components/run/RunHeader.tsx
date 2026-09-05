import { useState } from 'react'
import type { RunStatus } from '@runcastle/core'
import { Button, RunStatusChip, SectionTitle } from '../../ui'
import { ConfirmDialog } from './ConfirmDialog'
import { RunPicker } from './RunPicker'
import type { RunOption } from './RunPicker'

/**
 * The run's own header, over the lanes (decision #10). It carries the three
 * things a returning human reads before anything else — what is burning, how
 * long it has been, and the one run-level control — and nothing else: the lanes
 * below are the page's spine, and a header that grew a summary of them would be
 * the digest wall this redesign is removing from the review page.
 *
 * The counts are {@link runHeadline}'s, so a stopped lane is never reported as a
 * failure and a solo per-ticket retry says so instead of speaking whole-run
 * numbers (decisions #12b, #14c).
 *
 * The run history hangs off it (decision #15b): the runs counter opens the
 * feature's past runs, and picking one puts the header into record mode — the
 * run is named as history, with the way back to the latest beside it.
 */
export function RunHeader({
  headline,
  elapsed,
  status,
  burning,
  busy,
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
  /** Lanes with a live agent — the blast radius Cancel run states. */
  burning: number
  busy?: boolean
  /** Set only while the run can still be cancelled. */
  onCancelRun?: () => void
  /** The feature's runs, newest first — what the counter opens. */
  runs?: readonly RunOption[]
  selectedRunId?: string | null
  latestRunId?: string | null
  onPickRun?: (runId: string) => void
  /** Set only in record mode — leaving it returns to the run in flight. */
  onBackToLatest?: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SectionTitle>{onBackToLatest ? 'Past run' : 'Run'}</SectionTitle>
        {status && <RunStatusChip status={status} />}
        <span className="flex-1" />
        {onPickRun && (
          <RunPicker
            runs={runs}
            selectedId={selectedRunId}
            latestId={latestRunId}
            onPick={onPickRun}
          />
        )}
        {onBackToLatest && <Button onClick={onBackToLatest}>Back to latest</Button>}
        {onCancelRun && (
          <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
            Cancel run
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-lg text-text">{headline}</span>
        <span className="font-mono text-sm text-text-3">{elapsed}</span>
      </div>

      {onCancelRun && (
        <ConfirmDialog
          open={confirming}
          title="Cancel this run?"
          body={
            burning > 0 ? (
              <>
                Stops {burning} burning agent{burning === 1 ? '' : 's'}. Finished work is kept; the
                burn can resume later.
              </>
            ) : (
              'Stops the run before its remaining tickets start. Finished work is kept; the burn can resume later.'
            )
          }
          confirmLabel="Cancel run"
          busy={busy}
          onConfirm={onCancelRun}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
