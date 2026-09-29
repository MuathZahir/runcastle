import { useEffect, useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { useEventLog } from '../../lib/events'
import { awaitingCheckIn, sessionNotReady } from '../../lib/feature-ui'
import { sessionAgentName } from '../../lib/vocabulary'
import type { FeatureFull } from '../../lib/api'
import { StatusLabel } from '../../ui'
import { IconAlert } from '../../icons'

type Session = FeatureFull['sessions'][number]

/**
 * What the feature's Chat tab has to say about the live session above the
 * terminal itself. One event-log read feeds both notices — each `useEventLog`
 * carries its own cursor and so its own query key, and a second one here would
 * be a second poll for facts this one already has.
 */
export function SessionNotices({ featureId, session }: { featureId: string; session: Session }) {
  const events = useEventLog(featureId)
  return (
    <>
      <CheckInHint session={session} events={events} />
      <NotReadyBanner session={session} notReady={sessionNotReady(events, session.id)} />
    </>
  )
}

/** How often {@link CheckInHint} re-reads the clock. */
const CHECK_IN_TICK_MS = 5_000

/**
 * The quiet "the terminal is up, the agent hasn't said hello" line.
 *
 * A session is active from the moment its PTY spawns, so nothing here is
 * withheld or retried — End session in the strip is the affordance, and the
 * terminal is right there. This only names what an otherwise silent
 * "launching…" means once it has gone on longer than a launch should.
 */
function CheckInHint({ session, events }: { session: Session; events: EventRow[] }) {
  // The hint is derived from elapsed time, so nothing would re-render it into
  // view on its own — the view is otherwise driven by session and event data.
  const now = useNow(CHECK_IN_TICK_MS)
  if (!awaitingCheckIn(session, events, now)) return null
  return (
    <p className="m-0 pb-1.5 text-xs text-text-tertiary animate-fade-in">
      The agent hasn’t checked in yet.
    </p>
  )
}

/** The wall clock, re-read every `intervalMs` so age-derived UI keeps up. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * The "this terminal has not started on its briefing" banner.
 *
 * Every terminal opens with its briefing already in the agent's argv, so there
 * is nothing here to re-send: a session that never reported ready is one held up
 * by something on its own screen — a trust prompt, a login, an update notice —
 * and only the human can clear it. Until this said so, the terminal looked
 * perfectly healthy while doing nothing at all.
 */
function NotReadyBanner({ session, notReady }: { session: Session; notReady: boolean }) {
  if (!notReady) return null

  return (
    <div className="flex items-start gap-1.5 pb-2 text-sm text-text-secondary animate-fade-in" role="status">
      <StatusLabel tone="warning" icon={<IconAlert />} size="sm" strong className="shrink-0">
        Not ready
      </StatusLabel>
      <span className="min-w-0">
        — {sessionAgentName(session)} has not started on its briefing. Answer anything waiting in the
        terminal (a trust or login prompt).
      </span>
    </div>
  )
}
