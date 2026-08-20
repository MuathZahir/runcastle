import { useEffect, useState } from 'react'
import type { EventRow } from '@runcastle/core'
import { trpc } from '../trpc'
import { useEventLog } from '../lib/events'
import { awaitingCheckIn, kickoffTrouble, sessionActive, sessionStatusLabel } from '../lib/feature-ui'
import { useToast } from '../lib/toast'
import { sessionAgentName } from '../lib/vocabulary'
import { SessionStatusDot } from '../ui'
import type { FeatureFull } from '../lib/api'
import {
  sessionDoneState,
  type KickoffTrouble,
  type SessionDoneState,
  type Waypoint,
} from '../lib/feature-ui'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

type Session = FeatureFull['sessions'][number]
/** The done cases of {@link SessionDoneState} — everything but `notDone`. */
type DoneState = Exclude<SessionDoneState, { kind: 'notDone' }>

/**
 * The one terminal panel every phase body renders (grill / tickets / run /
 * review / shipped). A live or launching session shows the strip + inline PTY
 * terminal; an ENDED one shows the quiet ended card — with a Resume control when
 * the conversation behind it is still resumable.
 *
 * Resume matters because a terminal is a real CLI process in a server-owned
 * PTY: quitting runcastle kills it and boot reconciliation marks the row ended,
 * so every session is "ended" on the next launch. The conversation itself
 * survives — the runtime keeps the transcript on disk and the row kept its
 * `ccSessionId` — and the launcher resumes the latest same-kind conversation
 * for the kind it is asked to open. So Resume is just "open this kind of
 * terminal again"; the server picks the target.
 *
 * Pass `full` where the feature's waypoints are known (mapped ideation) and the
 * strip additionally flips from "live" to a done state once this session's
 * waypoint goes terminal — a label plus at most one button, never a modal: the
 * terminal below stays mounted and usable, because the agent may resolve while
 * the human still has things to say to that session.
 */
export function SessionPanel({
  featureId,
  sessions,
  full,
  className,
  showResume = true,
}: {
  featureId: string
  sessions: Session[]
  /** The feature payload, when the caller has it — enables the done state. */
  full?: FeatureFull
  /** Extra class on the live panel (bodies scope their own terminal sizing). */
  className?: string
  /**
   * Set false where the body already offers a better-framed relaunch for this
   * exact state (the grill body's converge-recovery bar), so the two don't sit
   * side by side doing the same thing.
   */
  showResume?: boolean
}) {
  const session = pickPanelSession(sessions)
  if (!session) return null

  if (sessionActive(session)) {
    // Without `full` (the tickets / review / run bodies) there are no waypoints
    // to be done with, so those strips render exactly as they always have.
    const done: SessionDoneState = full ? sessionDoneState(full, session) : { kind: 'notDone' }

    return (
      <div className={`grill-panel${className ? ` ${className}` : ''}`}>
        <div className="grill-strip">
          <span className="grill-kind">{session.kind}</span>
          {done.kind === 'notDone' ? (
            <>
              <SessionStatusDot status={session.status} />
              <span className="grill-live-label">{sessionStatusLabel(session)}</span>
              <span className="grill-strip-spacer" />
            </>
          ) : (
            <StripDone state={done} />
          )}
          {done.kind === 'workNext' && <WorkNextButton featureId={featureId} next={done.next} />}
          <span className="grill-sid" title={session.ccSessionId ?? session.id}>
            {(session.ccSessionId ?? session.id).slice(0, 8)}
          </span>
          <EndSessionButton featureId={featureId} sessionId={session.id} />
        </div>
        <SessionNotices featureId={featureId} session={session} />
        <div className="grill-term" id="grill-term">
          <ErrorBoundary label="terminal">
            <TerminalView sessionId={session.id} />
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  return <EndedSessionCard featureId={featureId} session={session} showResume={showResume} />
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
function StripDone({ state }: { state: DoneState }) {
  const { lead, rest } = doneText(state)
  return (
    <div className="strip-done">
      <span className="done-check" aria-hidden="true">
        ✓
      </span>
      {/* The line is ellipsized — a summary is prose and can be long. */}
      <span className="done-txt" title={lead + rest}>
        <b>{lead}</b>
        {rest}
      </span>
    </div>
  )
}

function doneText(state: DoneState): { lead: string; rest: string } {
  // A waypoint can finish either way; saying "Resolved" over a dropped one lies.
  const lead = state.waypoint.status === 'dropped' ? 'Dropped' : 'Resolved'
  switch (state.kind) {
    case 'workNext':
      return { lead, rest: state.waypoint.summary ? ` — ${state.waypoint.summary}` : '' }
    case 'awaitingResearch':
      return {
        lead,
        rest: ` — waiting on ${state.claimed} research run${state.claimed === 1 ? '' : 's'}`,
      }
    case 'mapComplete':
      return {
        lead: 'Map complete',
        rest: ' — every waypoint is done. Converge from the bar above.',
      }
  }
}

/**
 * The one button the done state offers: claim the next frontier waypoint and open
 * its session. No `endLive` — this session's own waypoint is terminal, which is
 * exactly the proof `workWaypoint` needs to end it for us (decision #8), so the
 * whole handoff is this single mutation.
 */
function WorkNextButton({ featureId, next }: { featureId: string; next: Waypoint }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const work = trpc.feature.workWaypoint.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: featureId })
      void utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  return (
    <button
      type="button"
      className="btn btn-xs btn-solid strip-work-next"
      disabled={work.isPending}
      title={`end this finished session and work the next waypoint: ${next.title}`}
      onClick={() => work.mutate({ featureId, waypointId: next.id })}
    >
      {work.isPending ? 'Starting…' : `Work next: ${next.title}`}
    </button>
  )
}

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
function isResumable(session: Session): boolean {
  // A waypoint session's resume runs through `workWaypoint` (it must re-claim
  // the waypoint), so the map's own Resume button owns that path — offering a
  // second one here would spawn an unclaimed waypoint terminal.
  //
  // A drive-fix session is opened from a failed drive and briefed with that one
  // failure; the server refuses to launch it any other way. Its Resume is the
  // Fix drive button on whatever drive is failing NOW.
  return !!session.ccSessionId && session.kind !== 'waypoint' && session.kind !== 'drive-fix'
}

function EndedSessionCard({
  featureId,
  session,
  showResume,
}: {
  featureId: string
  session: Session
  showResume: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const launch = trpc.feature.launchSession.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: featureId })
      void utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })
  const resumable = showResume && isResumable(session)

  return (
    <div className="session-ended-card" id="grill-term">
      <span className="session-ended-dot" />
      <div className="session-ended-main">
        <div className="session-ended-title">Session ended</div>
        <div className="session-ended-sub">
          {resumable
            ? 'The conversation is still on disk — resume it to pick up where you left off.'
            : 'Decisions from this conversation were captured to Knowledge.'}
        </div>
      </div>
      {resumable && (
        <button
          type="button"
          className="btn btn-xs btn-ghost session-ended-resume"
          disabled={launch.isPending}
          title={`resume the ${session.kind} conversation in a new terminal`}
          onClick={() => launch.mutate({ featureId, kind: session.kind })}
        >
          {launch.isPending ? 'Resuming…' : 'Resume session'}
        </button>
      )}
    </div>
  )
}
