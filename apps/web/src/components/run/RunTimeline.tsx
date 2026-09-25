import type { EventRow } from '@runcastle/core'
import { eventLevel, eventWarns } from '../../lib/activity'
import { fmtTime } from '../../lib/format'
import { DimLine, Disclosure, StatusDot, cx } from '../../ui'
import type { StatusTone } from '../../ui'
import { IconActivity } from '../../icons'

/** An event's level as a 6px dot — colour confirms, the words say it. */
const LEVEL_TONE: Record<string, StatusTone> = {
  error: 'danger',
  ok: 'success',
  active: 'neutral',
  info: 'neutral',
}

/**
 * The run's coarse timeline — run start, the docs digest, per-ticket landmarks,
 * the run summary — collapsed under the lanes (decision #13d): a quiet vertical
 * list of time, dot, message, and the event's type in mono at the end.
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
  // read while it sat behind a closed panel. Keyed on it, so a warning that
  // arrives mid-run opens the panel too (the disclosure's `open` is initial).
  const warned = events.some(eventWarns)
  return (
    <Disclosure
      key={warned ? 'warned' : 'quiet'}
      defaultOpen={warned}
      title="Run timeline"
      icon={<IconActivity />}
      aside={<span className="tabular-nums">{events.length}</span>}
    >
      {events.length === 0 && <DimLine>Waiting for events…</DimLine>}
      <ol className="@container m-0 flex max-h-96 list-none flex-col overflow-y-auto p-0">
        {events.map((e) => {
          const warns = eventWarns(e)
          return (
            <li key={e.id} className="flex min-h-7 items-start gap-3 py-1 text-sm">
              <span className="w-20 shrink-0 pt-px text-xs whitespace-nowrap text-text-tertiary tabular-nums">{fmtTime(e.ts)}</span>
              <span className="inline-flex h-5 w-2 shrink-0 items-center justify-center">
                <StatusDot tone={warns ? 'warning' : (LEVEL_TONE[eventLevel(e)] ?? 'neutral')} />
              </span>
              {/* One line each, so the record stays scannable — except a row
                  carrying a warning, which wraps: it is the only kind whose text
                  is worth more than the density it costs. */}
              <span
                className={cx('min-w-0 flex-1', warns ? 'break-words text-warning' : 'truncate text-text-secondary')}
              >
                {e.message}
              </span>
              <span className="hidden w-40 shrink-0 truncate pt-px text-right font-mono text-xs text-text-tertiary @xl:block">
                {e.type}
              </span>
            </li>
          )
        })}
      </ol>
    </Disclosure>
  )
}
