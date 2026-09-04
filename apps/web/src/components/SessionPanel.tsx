import { useEffect, useState, type ReactNode } from 'react'
import type { EventRow } from '@runcastle/core'
import { trpc } from '../trpc'
import { useEventLog } from '../lib/events'
import { awaitingCheckIn, kickoffTrouble, sessionActive } from '../lib/feature-ui'
import { useToast } from '../lib/toast'
import { sessionAgentName } from '../lib/vocabulary'
import type { FeatureFull } from '../lib/api'
import { type KickoffTrouble } from '../lib/feature-ui'
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
      <BriefingBanner
        featureId={featureId}
        session={session}
        trouble={kickoffTrouble(events, session.id)}
      />
    </>
  )
}

/** How often {@link CheckInHint} re-reads the clock. */
const CHECK_IN_TICK_MS = 5_000

/**
 * The quiet "the terminal is up, the agent hasn't said hello" line.
 *
 * A session is active from the moment its PTY spawns ({@link sessionActive}),
 * so nothing here is withheld or retried — the panel's own controls (Send
 * briefing below, End session in the strip) are the affordances, and the
 * terminal is right there. This only names what an otherwise silent
 * "launching…" means once it has gone on longer than a launch should.
 */
function CheckInHint({ session, events }: { session: Session; events: EventRow[] }) {
  // The hint is derived from elapsed time, so nothing would re-render it into
  // view on its own — the panel is otherwise driven by session and event data.
  const now = useNow(CHECK_IN_TICK_MS)
  if (!awaitingCheckIn(session, events, now)) return null
  return <div className="session-checkin-hint">agent hasn’t checked in yet</div>
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
 * The "this terminal was never told what it is here for" banner.
 *
 * runcastle opens every terminal with a briefing typed into it — the merge-conflict
 * resolution, the review iteration, the plain per-kind opening move — and waits
 * for the CLI to acknowledge it. When that acknowledgement never arrives (a
 * startup dialog swallowed the keystrokes, the session never reported ready, or
 * the human typed first), the terminal is live but the agent is working blind.
 * This is the visible half of that state: it says so, and Send briefing re-types
 * the exact same text, so the fix is one click instead of the human reconstructing
 * the instruction by hand.
 */
function BriefingBanner({
  featureId,
  session,
  trouble,
}: {
  featureId: string
  session: Session
  trouble: KickoffTrouble | null
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const resend = trpc.feature.resendKickoff.useMutation({
    onSuccess: () => {
      // A resend clears the trouble the banner is rendered from, and that only
      // reaches the panel through the queries that carry the session and its
      // events — waiting on the push pipe for it would leave the banner up over
      // a briefing that has already landed.
      void utils.feature.get.invalidate({ id: featureId })
      void utils.events.invalidate()
      toast.push('briefing sent to the terminal')
    },
    onError: (e) => toast.push(e.message),
  })
  if (!trouble) return null

  return (
    <div className="session-briefing-warn">
      <span className="session-briefing-text">
        {trouble === 'not-ready'
          ? 'This terminal has not reported ready — answer anything waiting in it (a trust or resume prompt), then send the briefing.'
          : `The opening briefing never reached ${sessionAgentName(session)} — this session has not been told what it is here for.`}
      </span>
      <button
        type="button"
        className="btn btn-xs btn-ghost"
        disabled={resend.isPending}
        onClick={() => resend.mutate({ sessionId: session.id })}
      >
        {resend.isPending ? 'Sending…' : 'Send briefing'}
      </button>
    </div>
  )
}

/**
 * The strip's done label: a check and one line of text in place of the live dot
 * (decision #9). The map-complete case deliberately points at the next-step bar
 * rather than growing a second Converge button.
 */
/**
 * The session a body should render. A live/launching one always wins; otherwise
 * the most recent RESUMABLE ended session (one that reached `live` and so
 * recorded a `ccSessionId`), falling back to the most recent session of any
 * kind. That fallback order mirrors the launcher's own resume target, so the
 * card never offers to resume a conversation the server would not pick — and a
 * session that died before starting still renders as plainly ended.
 */
function pickPanelSession(sessions: Session[]): Session | undefined {
  const ordered = [...sessions].reverse()
  return (
    ordered.find(sessionActive) ??
    ordered.find((s) => s.status === 'ended' && !!s.ccSessionId) ??
    ordered[0]
  )
}

/** True when this session's runtime-side conversation can be picked back up. */
