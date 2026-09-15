import type { EventRow } from '@runcastle/core'
import { eventLevel, eventWarns } from '../../lib/activity'
import { fmtTime } from '../../lib/format'
import { DimLine } from '../../ui'

const LEVEL_TONE: Record<string, string> = {
  error: 'text-danger',
  ok: 'text-ok',
  active: 'text-ph-implementation',
  info: 'text-accent-hi',
}

/**
 * The run's coarse timeline — run start, the docs digest, per-ticket landmarks,
 * the run summary — collapsed under the lanes (decision #13d).
 *
 * It used to be a tab co-equal with the agent transcript, which put the
 * debugging record beside the work it describes and made the human choose
 * between them. Per-ticket detail now lives in each lane's own expansion; what
 * is left here is the record you open when something needs explaining.
 */
export function RunTimeline({ events }: { events: readonly EventRow[] }) {
  // A warning in the record opens the record. It is collapsed because most of
  // what is in here only matters when something needs explaining — and an event
  // that carries a warning IS something needing explaining, which no human ever
  // read while it sat behind a closed panel.
  const warned = events.some(eventWarns)
  return (
    <details open={warned} className="mt-6 rounded-md border border-hairline bg-panel-2">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold tracking-[0.07em] text-text-3 uppercase [&::-webkit-details-marker]:hidden">
        Run timeline · {events.length}
      </summary>
      <div className="max-h-96 overflow-y-auto border-t border-hairline-soft px-3 py-2 font-mono text-xs leading-relaxed">
        {events.length === 0 && <DimLine>waiting for events…</DimLine>}
        {events.map((e) => (
          <div key={e.id} className="flex gap-2.5">
            <span className="w-11 shrink-0 text-text-4">{fmtTime(e.ts)}</span>
            <span className={`w-30 shrink-0 truncate ${LEVEL_TONE[eventLevel(e)] ?? 'text-text-2'}`}>
              {e.type}
            </span>
            {/* One line each, so the record stays scannable — except a row
                carrying a warning, which wraps: it is the only kind whose text
                is worth more than the density it costs. */}
            <span
              className={
                eventWarns(e)
                  ? 'min-w-0 flex-1 break-words text-warn'
                  : 'min-w-0 flex-1 truncate text-text-2'
              }
            >
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}
