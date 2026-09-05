import { useState } from 'react'
import type { RunStatus } from '@runcastle/core'
import { fmtDateTime, relTimeAgo } from '../../lib/format'
import { RunStatusChip } from '../../ui'

/** One past run, as `run.listByFeature` reports it. */
export interface RunOption {
  id: string
  status: RunStatus
  startedAt: number
  endedAt?: number
  lap: number
  ticketIds: string[]
}

/**
 * The feature's run history, as a disclosure over the run header (decision
 * #15b).
 *
 * A feature accumulates one run per burn and only the latest was ever
 * renderable — the counter said "3 runs" and went nowhere, so the two earlier
 * accounts of what happened to this feature existed but could not be read.
 * Picking one renders it in the same lanes-as-spine layout, terminal.
 *
 * A disclosure rather than a floating menu: the list is short, it opens
 * downward into the page above lanes that are themselves disclosures, and it
 * needs no outside-click or focus-trap machinery to behave.
 */
export function RunPicker({
  runs,
  selectedId,
  latestId,
  onPick,
}: {
  /** Newest first, as the server returns them. */
  runs: readonly RunOption[]
  /** The run currently on screen. */
  selectedId: string | null
  /** The feature's current run — the one the live view follows. */
  latestId: string | null
  onPick: (runId: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (runs.length === 0) return null

  return (
    <details
      className="rounded-md border border-hairline bg-panel-2"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-2.5 py-1 font-mono text-xs text-text-3 [&::-webkit-details-marker]:hidden">
        {runs.length} run{runs.length === 1 ? '' : 's'} <span aria-hidden>▾</span>
      </summary>
      <div className="flex flex-col gap-0.5 border-t border-hairline-soft p-1">
        {runs.map((run) => {
          const lanes = run.ticketIds.length
          const current = run.id === selectedId
          return (
            <button
              key={run.id}
              type="button"
              aria-current={current || undefined}
              title={fmtDateTime(run.startedAt)}
              className={`flex cursor-pointer items-center gap-2 rounded-sm border-0 px-2 py-1.5 text-left hover:bg-accent-soft ${current ? 'bg-accent-soft text-text' : 'bg-transparent text-text-2'}`}
              onClick={() => {
                onPick(run.id)
                setOpen(false)
              }}
            >
              <span className="w-20 shrink-0 font-mono text-xs text-text-3">
                {relTimeAgo(run.startedAt)}
              </span>
              <RunStatusChip status={run.status} />
              <span className="min-w-0 flex-1 truncate text-sm">
                Lap {run.lap} · {lanes} lane{lanes === 1 ? '' : 's'}
              </span>
              {run.id === latestId && (
                <span className="shrink-0 font-mono text-xs text-text-3">latest</span>
              )}
            </button>
          )
        })}
      </div>
    </details>
  )
}
