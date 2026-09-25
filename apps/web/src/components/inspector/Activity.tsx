import { useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { activityLine, eventLevel, isLapDivider, type EventLevel } from '../../lib/activity'
import { relTime } from '../../lib/format'
import { IconActivity, IconChevronRight } from '../../icons'
import { EmptyState, StatusDot, cx } from '../../ui'
import type { StatusTone } from '../../ui'

/** Event level → the dot's tone; keeps the feed scannable without mono codes. */
const LEVEL_TONE: Record<EventLevel, StatusTone> = {
  error: 'danger',
  ok: 'success',
  active: 'accent',
  info: 'neutral',
}

/** `session.pty_exited` → `session · pty exited` */
function humanType(type: string): string {
  return type.replace(/_/g, ' ').replace('.', ' · ')
}

/** How far back the feed reads. Older than this and the docs are the record. */
const FEED_DEPTH = 50

export function Activity({ events }: { events: EventRow[] }) {
  const recent = events.slice(-FEED_DEPTH).reverse()
  if (recent.length === 0)
    return (
      <EmptyState
        compact
        icon={<IconActivity />}
        title="Nothing yet"
        hint="Everything that happens to this feature shows up here."
      />
    )
  return (
    <div className="flex flex-col">
      {recent.map((e) =>
        isLapDivider(e.type) ? <LapDivider key={e.id} event={e} /> : <ActivityRow key={e.id} event={e} />,
      )}
    </div>
  )
}

/**
 * A lap boundary, drawn ACROSS the feed rather than listed in it (decisions.md
 * #6). Every row above and below belongs to one side of this line, which is
 * exactly what a flat feed could not say — the user reported not knowing there
 * was another lap at all.
 */
export function LapDivider({ event }: { event: EventRow }) {
  return (
    <div className="my-2 flex items-center gap-2 text-xs font-medium text-accent-text" role="separator">
      <span className="first-letter:uppercase">{activityLine(event).summary}</span>
      <span className="h-px flex-1 bg-border-subtle" />
      <span className="font-normal text-text-tertiary tabular-nums">{relTime(event.ts)}</span>
    </div>
  )
}

/**
 * One event, as a sentence. The summary is plain text whatever the event
 * carried — a tool call is named by its tool, agent prose is stripped of its
 * markdown, an event whose message was its own type slug is read back as words
 * (decision 5) — and anything the summary dropped is one click away instead of
 * cut off by CSS (F10.5/F18).
 */
export function ActivityRow({ event }: { event: EventRow }) {
  const [open, setOpen] = useState(false)
  const line = activityLine(event)

  return (
    <div className="flex gap-3 py-2">
      <span className="flex h-5 w-1.5 shrink-0 items-center">
        <StatusDot tone={LEVEL_TONE[eventLevel(event)]} />
      </span>
      <div className="min-w-0 flex-1">
        {line.detail ? (
          <button
            type="button"
            className="group/ev m-0 flex w-full cursor-pointer items-start gap-1 bg-transparent p-0 text-left text-sm text-text-secondary transition-colors duration-(--dur-1) ease-app hover:text-text"
            aria-expanded={open}
            title={open ? 'Show less' : 'Show the whole event'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="min-w-0 flex-1">{line.summary}</span>
            <IconChevronRight
              size={14}
              aria-hidden="true"
              className={cx(
                'mt-0.5 shrink-0 text-icon transition-transform duration-(--dur-2) ease-app',
                open && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <div className="text-sm text-text-secondary">{line.summary}</div>
        )}
        {open && line.detail && (
          <pre className="m-0 mt-2 max-h-[260px] overflow-auto rounded-md bg-surface-inset px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary animate-fade-in">
            {line.detail}
          </pre>
        )}
        <div className="mt-0.5 flex items-baseline gap-2 text-xs text-text-tertiary">
          <span className="truncate">{humanType(event.type)}</span>
          <span className="ml-auto shrink-0 tabular-nums">{relTime(event.ts)}</span>
        </div>
      </div>
    </div>
  )
}
