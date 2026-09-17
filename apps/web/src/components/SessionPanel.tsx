import { useEffect, useState, type ReactNode } from 'react'
import type { EventRow } from '@runcastle/core'
import { useEventLog } from '../lib/events'
import { awaitingCheckIn, sessionActive, sessionNotReady } from '../lib/feature-ui'
import { sessionAgentName } from '../lib/vocabulary'
import type { FeatureFull } from '../lib/api'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'
import { SessionStrip } from './session/SessionStrip'

type Session = FeatureFull['sessions'][number]

/**
 * The one terminal panel every phase body renders (ideation / tickets / run /
 * review / shipped). A live or launching session shows the strip + inline PTY
 * terminal; an ended one is a quiet status line. Session actions live in the
 * next-step bar, so the ended line never duplicates them.
 *
 * Pass `full` where the feature's waypoints are known (mapped ideation) and the
 * strip additionally flips from "live" to a done state once this session's
 * waypoint goes terminal — a status label, never another action: the
 * terminal below stays mounted and usable, because the agent may resolve while
 * the human still has things to say to that session.
 */
export function SessionPanel({
  featureId,
  sessions,
  full,
  className,
  right,
}: {
  featureId: string
  sessions: Session[]
  /** The feature payload, when the caller has it — enables the done state. */
  full?: FeatureFull
  /** Extra class on the live panel (bodies scope their own terminal sizing). */
  className?: string
  /** Extra controls owned by the embedding surface, before End session. */
  right?: ReactNode
}) {
  const session = pickPanelSession(sessions)
  if (!session) return null

  if (sessionActive(session)) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-panel-2${className ? ` ${className}` : ''}`}>
        <SessionStrip session={session} full={full} right={<>{right}<EndSessionButton featureId={featureId} sessionId={session.id} /></>} />
        <SessionNotices featureId={featureId} session={session} />
        <div className="min-h-0 flex-1" id="session-terminal">
          <ErrorBoundary label="terminal">
            <TerminalView sessionId={session.id} />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  return <SessionStrip session={session} full={full} />
}

/**
 * What the live panel has to say about the session above the terminal itself.
 * One event-log read feeds both notices — each `useEventLog` carries its own
 * cursor and so its own query key, and a second one here would be a second poll
 * for facts this one already has.
 */
function SessionNotices({ featureId, session }: { featureId: string; session: Session }) {
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
 * A session is active from the moment its PTY spawns ({@link sessionActive}),
 * so nothing here is withheld or retried — End session in the strip is the
 * affordance, and the terminal is right there. This only names what an otherwise
 * silent "launching…" means once it has gone on longer than a launch should.
 */
function CheckInHint({ session, events }: { session: Session; events: EventRow[] }) {
  // The hint is derived from elapsed time, so nothing would re-render it into
  // view on its own — the panel is otherwise driven by session and event data.
  const now = useNow(CHECK_IN_TICK_MS)
  if (!awaitingCheckIn(session, events, now)) return null
  return (
    <div className="border-b border-hairline px-3 py-1.5 text-xs text-text-3">
      agent hasn’t checked in yet
    </div>
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
    <div className="border-b border-warn/35 bg-warn/8 px-3 py-2 text-sm text-warn">
      This terminal has not reported ready — {sessionAgentName(session)} has not started on its
      briefing. Answer anything waiting in it (a trust or login prompt).
    </div>
  )
}

/**
 * The strip's done label: a check and one line of text in place of the live dot
 * (decision #9). The map-complete case deliberately points at the next-step bar
 * rather than growing a second Converge button.
 */
/**
 * The session a body should render: a live/launching one, else simply the most
 * recent.
 *
 * It used to prefer the most recent RESUMABLE ended session — one that reached
 * `live` and so recorded a `ccSessionId` — because the card carried its own
 * Resume button and had to name the conversation the server would actually
 * reopen. Decision #3 moved every resume into the next-step bar, and the strip
 * that remains reports which conversation this is and when it stopped. Under
 * that job the preference was a lie: end a terminal that never got past its
 * trust prompt and the strip would quietly report the previous conversation
 * instead, ageing the line from an ending the human never watched.
 */
function pickPanelSession(sessions: Session[]): Session | undefined {
  const ordered = [...sessions].reverse()
  return ordered.find(sessionActive) ?? ordered[0]
}

/** True when this session's runtime-side conversation can be picked back up. */
