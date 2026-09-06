import type { ReactNode } from 'react'
import type { FeatureFull } from '../../lib/api'
import { fmtDuration, relTimeAgo } from '../../lib/format'
import { sessionDoneState, sessionKindName } from '../../lib/feature-ui'
import { SessionStatusDot } from '../../ui'

type Session = FeatureFull['sessions'][number]

function doneText(full: FeatureFull | undefined, session: Session): string | null {
  if (!full) return null
  const state = sessionDoneState(full, session)
  if (state.kind === 'notDone') return null
  if (state.kind === 'mapComplete') return 'Map complete — every waypoint is done. Converge from the bar above.'
  const lead = state.waypoint.status === 'dropped' ? 'Dropped' : 'Resolved'
  if (state.kind === 'awaitingResearch') return `${lead} ✓ — waiting on ${state.claimed} research run${state.claimed === 1 ? '' : 's'}`
  return `${lead} ✓${state.waypoint.summary ? ` — ${state.waypoint.summary}` : ''}`
}

/**
 * Which conversation this is and whether it is alive (decision #13).
 *
 * The ended line's age comes from `endedAt` and from nothing else: a session's
 * insert time answers "how old is this conversation", not "when did it stop",
 * and reading one as the other told a human who had just closed a two-hour
 * session that it ended two hours ago. Rows that stopped before the server
 * recorded endings have no age to give, so they say "ended" and leave it there.
 */
export function SessionStrip({ session, full, right }: { session: Session; full?: FeatureFull; right?: ReactNode }) {
  const id = session.ccSessionId ?? session.id
  const done = doneText(full, session)
  const active = session.status !== 'ended'
  return (
    <div className="flex min-h-12 items-center gap-2 border-b border-hairline px-3 font-mono text-sm" title={id}>
      <span className="font-semibold text-text">{sessionKindName(session)} session</span>
      {active ? <><span className="text-text-3">·</span><SessionStatusDot status={session.status} /><span className="text-text-2">{session.status === 'launching' ? 'starting…' : 'live'}</span>{session.createdAt && <span className="text-text-3">· {fmtDuration(session.createdAt, Date.now())}</span>}</> : <span className="text-text-3">· ended{session.endedAt === undefined ? '' : ` ${relTimeAgo(session.endedAt)}`}</span>}
      {done && <span className="min-w-0 flex-1 truncate text-text-2" title={done}>{done}</span>}
      {!done && <span className="flex-1" />}
      {right}
    </div>
  )
}
