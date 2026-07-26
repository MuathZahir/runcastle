import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { SessionStatusDot } from '../ui'
import type { FeatureFull } from '../lib/api'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

type Session = FeatureFull['sessions'][number]

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
 */
export function SessionPanel({
  featureId,
  sessions,
  className,
  showResume = true,
}: {
  featureId: string
  sessions: Session[]
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
    return (
      <div className={`grill-panel${className ? ` ${className}` : ''}`}>
        <div className="grill-strip">
          <span className="grill-kind">{session.kind}</span>
          <SessionStatusDot status={session.status} />
          <span className="grill-live-label">
            {session.status === 'launching' ? 'launching…' : 'live'}
          </span>
          <span className="grill-strip-spacer" />
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
