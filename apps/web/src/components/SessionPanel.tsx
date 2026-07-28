import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { SessionStatusDot } from '../ui'
import type { FeatureFull } from '../lib/api'
import { sessionDoneState, type SessionDoneState, type Waypoint } from '../lib/feature-ui'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

type Session = FeatureFull['sessions'][number]
/** The done cases of {@link SessionDoneState} — everything but `notDone`. */
type DoneState = Exclude<SessionDoneState, { kind: 'notDone' }>

/**
 * The one terminal panel every phase body renders (grill / tickets / run /
 * review). A live or launching session shows the strip + inline PTY terminal; an
 * ENDED one shows the quiet ended card — with a Resume control when the
 * conversation behind it is still resumable.
 *
 * Resume matters because a terminal is a real `claude` process in a server-owned
 * PTY: quitting runcastle kills it and boot reconciliation marks the row ended,
 * so every session is "ended" on the next launch. The conversation itself
 * survives — Claude Code keeps the transcript on disk and the row kept its
 * `ccSessionId` — and the launcher `--resume`s the latest same-kind conversation
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

  if (session.status !== 'ended') {
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
              <span className="grill-live-label">
                {session.status === 'launching' ? 'launching…' : 'live'}
              </span>
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
    ordered.find((s) => s.status === 'live' || s.status === 'launching') ??
    ordered.find((s) => s.status === 'ended' && !!s.ccSessionId) ??
    ordered[0]
  )
}

/** True when this session's Claude Code conversation can be picked back up. */
function isResumable(session: Session): boolean {
  // A waypoint session's resume runs through `workWaypoint` (it must re-claim
  // the waypoint), so the map's own Resume button owns that path — offering a
  // second one here would spawn an unclaimed waypoint terminal.
  return !!session.ccSessionId && session.kind !== 'waypoint'
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
