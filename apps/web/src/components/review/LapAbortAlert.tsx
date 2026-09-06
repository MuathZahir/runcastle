import { Button, SectionTitle } from '../../ui'
import type { LapAbort } from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'

/**
 * An Iterate that could not start, in the alert slot (decision 26g).
 *
 * A lap whose terminal cannot be opened is rolled back whole — lap and phase
 * both — so the walked failure looked like nothing had happened at all: the same
 * review page came back, with the only account of it buried in the Activity
 * feed. The git error is what the human needs and never the first thing they
 * want to read, so it sits behind a disclosure under a sentence that says which
 * lap failed, and Retry takes the same door the bar's Iterate takes.
 *
 * Hook-free like {@link ConflictCard}, its neighbour in the slot; `readonly`
 * answers itself here for the same reason (decision 33a).
 */
export function LapAbortAlert({
  abort,
  lap,
  readonly,
  onRetry,
}: {
  abort: LapAbort
  /** The feature's lap — the rollback restored it, so the failed one is lap + 1. */
  lap: number
  /** Looking back at review on a shipped feature — history, never an action. */
  readonly: boolean
  onRetry: () => void
}) {
  if (readonly) return null

  return (
    <div className="rounded-lg border border-danger/45 bg-panel p-4" role="alert">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Lap {lap + 1} couldn’t start</SectionTitle>
        <span className="font-mono text-xs text-text-3" title={fmtDateTime(abort.at)}>
          {relTimeAgo(abort.at)}
        </span>
      </div>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-text-2">
        The lap was rolled back — this feature is still on lap {lap}, at review, with nothing
        lost. Retrying opens the same door.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer list-none text-sm text-text-3 underline decoration-dotted">
          What went wrong
        </summary>
        <div className="mt-1.5 font-mono text-xs break-words whitespace-pre-wrap text-danger">
          {abort.message}
        </div>
      </details>
      <Button variant="solid" className="mt-4" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
