import { useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { activityLine, eventLevel, isLapDivider, type EventLevel } from '../../lib/activity'
import { relTime } from '../../lib/format'

/** Event level → the dot's colour; keeps the feed scannable without mono codes. */
const DOT_BG: Record<EventLevel, string> = {
  error: 'bg-danger',
  ok: 'bg-ok',
  active: 'bg-accent',
  info: 'bg-text-4',
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
      <div className="text-sm leading-relaxed text-pretty text-text-3">
        Everything that happens to this feature shows up here.
      </div>
    )
  return (
    <div className="flex flex-col">
      {recent.map((e) =>
        isLapDivider(e.type) ? (
          <LapDivider key={e.id} event={e} />
        ) : (
          <ActivityRow key={e.id} event={e} />
        ),
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
    <div
      className="my-1.5 flex items-center gap-2 px-1 font-mono text-xs tracking-[0.06em] text-accent-2 uppercase"
      role="separator"
    >
      <span>{activityLine(event).summary}</span>
      <span className="h-px flex-1 bg-accent-line" />
      <span className="text-text-4">{relTime(event.ts)}</span>
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
    <div className="flex gap-2.5 px-0.5 py-2">
      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${DOT_BG[eventLevel(event)]}`} />
      <div className="min-w-0 flex-1">
        {line.detail ? (
          // No preflight (apps/web/STYLE.md): a button keeps the UA's face and
          // size unless the surface names them, so the toggle states the same
          // type as the plain summary beside it.
          <button
            type="button"
            className="m-0 w-full cursor-pointer border-0 bg-transparent p-0 text-left font-sans text-sm leading-snug text-text-2 hover:text-text"
            aria-expanded={open}
            title={open ? 'Show less' : 'Show the whole event'}
            onClick={() => setOpen((v) => !v)}
          >
            {line.summary}
            <span className="ml-1.5 text-text-4" aria-hidden="true">
              {open ? '−' : '+'}
            </span>
          </button>
        ) : (
          <div className="text-sm leading-snug text-text-2">{line.summary}</div>
        )}
        {open && line.detail && (
          // `pre` arrives with the UA's margin and 13.33px face — no preflight
          // (apps/web/STYLE.md), so the detail box states both.
          <pre className="m-0 mt-1.5 max-h-[260px] overflow-auto rounded-md border border-hairline bg-panel-inset px-2 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-text-2">
            {line.detail}
          </pre>
        )}
        <div className="mt-0.5 flex items-baseline gap-2 text-xs text-text-4">
          <span className="truncate">{humanType(event.type)}</span>
          <span className="ml-auto shrink-0">{relTime(event.ts)}</span>
        </div>
      </div>
    </div>
  )
}
