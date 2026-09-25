import type { ReactNode } from 'react'
import type { FeatureFull } from '../../lib/api'
import { fmtDuration, relTimeAgo } from '../../lib/format'
import { sessionDoneState, sessionKindName } from '../../lib/feature-ui'
import { StatusLabel, cx } from '../../ui'
import { IconCheck, IconTerminal } from '../../icons'

type Session = FeatureFull['sessions'][number]

function doneText(full: FeatureFull | undefined, session: Session): string | null {
  if (!full) return null
  const state = sessionDoneState(full, session)
  if (state.kind === 'notDone') return null
  if (state.kind === 'mapComplete') return 'Map complete — every waypoint is done. Converge from the bar above.'
  const lead = state.waypoint.status === 'dropped' ? 'Dropped' : 'Resolved'
  if (state.kind === 'awaitingResearch') return `${lead} — waiting on ${state.claimed} research run${state.claimed === 1 ? '' : 's'}`
  return `${lead}${state.waypoint.summary ? ` — ${state.waypoint.summary}` : ''}`
}

/**
 * Which conversation this is and whether it is alive (decision #13): a terminal
 * glyph and the session's kind, then its state as a status label — the live dot
 * breathes — with its age in tabular tertiary, and the embedding surface's
 * actions (End session) on the right.
 *
 * The ended line's age comes from `endedAt` and from nothing else: a session's
 * insert time answers "how old is this conversation", not "when did it stop",
 * and reading one as the other told a human who had just closed a two-hour
 * session that it ended two hours ago. Rows that stopped before the server
 * recorded endings have no age to give, so they say "ended" and leave it there.
 *
 * Once this session's waypoint goes terminal the state reads done — a check and
 * one line — in place of the live dot (decision #9). The map-complete case
 * points at the next-step bar rather than growing a second Converge button.
 */
export function SessionStrip({
  session,
  full,
  right,
  className,
}: {
  session: Session
  full?: FeatureFull
  right?: ReactNode
  className?: string
}) {
  const id = session.ccSessionId ?? session.id
  const done = doneText(full, session)
  const active = session.status !== 'ended'
  return (
    <div className={cx('flex min-h-10 min-w-0 items-center gap-3 text-sm', className)} title={id}>
      <span className="inline-flex shrink-0 items-center gap-2 font-medium text-text">
        <IconTerminal size={16} className="text-icon" />
        {sessionKindName(session)} session
      </span>
      {done ? (
        <StatusLabel tone="success" icon={<IconCheck />} className="min-w-0 flex-1" title={done}>
          {done}
        </StatusLabel>
      ) : active ? (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <StatusLabel tone={session.status === 'launching' ? 'warning' : 'live'}>
            {session.status === 'launching' ? 'Starting…' : 'Live'}
          </StatusLabel>
          {session.createdAt && (
            <span className="text-xs text-text-tertiary tabular-nums">{fmtDuration(session.createdAt, Date.now())}</span>
          )}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">
          Ended{session.endedAt === undefined ? '' : ` ${relTimeAgo(session.endedAt)}`}
        </span>
      )}
      {right && <span className="flex shrink-0 items-center gap-1">{right}</span>}
    </div>
  )
}
