import type { RunStatus } from '@runcastle/core'
import { fmtDateTime, relTimeAgo } from '../../lib/format'
import { IconClock } from '../../icons'
import { RunStatusChip } from '../../ui'
import { SELECT_GHOST, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'

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
 * The feature's run history, as a quiet select beside the run's facts
 * (decision #15b).
 *
 * A feature accumulates one run per burn and only the latest was ever
 * renderable — the counter said "3 runs" and went nowhere, so the two earlier
 * accounts of what happened to this feature existed but could not be read.
 * Picking one renders it in the same lanes-as-spine layout, terminal.
 *
 * Rendered only once there is a choice to make: a feature with one run has no
 * history to pick from, and the header already describes that run.
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
  if (runs.length < 2) return null
  const at = runs.findIndex((r) => r.id === selectedId)
  const shown = at >= 0 ? runs[at] : undefined
  const trigger = shown
    ? `${shown.id === latestId ? 'Latest' : relTimeAgo(shown.startedAt)} · ${runs.length} runs`
    : `${runs.length} runs`

  return (
    <Select value={selectedId ?? undefined} onValueChange={onPick}>
      <SelectTrigger
        aria-label="Run history"
        title={shown ? fmtDateTime(shown.startedAt) : undefined}
        className={SELECT_GHOST}
      >
        <IconClock size={14} className="shrink-0 text-icon" />
        <SelectValue>{trigger}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" aria-label="Run history" className="min-w-72">
        {runs.map((run) => (
          <SelectItem key={run.id} value={run.id} title={fmtDateTime(run.startedAt)}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-text-tertiary tabular-nums">{relTimeAgo(run.startedAt)}</span>
              <span className="w-24 shrink-0">
                <RunStatusChip status={run.status} />
              </span>
              <span className="min-w-0 truncate">
                Lap {run.lap} · {run.ticketIds.length} lane{run.ticketIds.length === 1 ? '' : 's'}
              </span>
              {run.id === latestId && <span className="shrink-0 text-xs text-text-tertiary">latest</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
