import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { Button, DimLine, SessionStatusDot } from '../ui'
import { LogoMark } from '../icons'
import {
  HOST_ONLY_PREPARED,
  PREPARED_LABEL,
  describeFinding,
  isStale,
} from '../lib/settings'
import type { PrepView } from '../lib/api'
import { EndSessionButton } from './EndSessionButton'
import { ErrorBoundary } from './ErrorBoundary'
import { TerminalView } from './TerminalView'

/**
 * The preparation workspace — the whole body, not a card in an overlay.
 *
 * Preparation fills in the fields nobody fills in — verify commands, the test
 * baseline, the install command — by establishing them once so no burn agent
 * re-derives them per ticket. It used to live behind the settings overlay,
 * which meant you had to already know it existed to find it, and it is the one
 * thing a fresh project needs before anything else works well. So it gets the
 * screen: an unprepared project with no features lands here, and one with
 * features reaches it from the rail's pinned nudge.
 *
 * It is one conversation on the human's own machine and nothing else. The
 * questions that block preparation — how this dev server starts, which database
 * a drive should point at — are answered by asking, and this session can
 * actually RUN the answers, which a sandbox never could.
 */
export function PreparationWorkspace({
  projectId,
  onClose,
}: {
  projectId: string
  /** Leave preparation, when there is somewhere to go back to. */
  onClose?: () => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()

  const projectsQ = trpc.project.list.useQuery()
  const project = projectsQ.data?.find((p) => p.id === projectId)

  const prep = trpc.project.prep.useQuery({ projectId }, { refetchInterval: 3000 })

  // The open conversation, if there is one. Polled so the terminal appears when
  // a session is launched from anywhere (⌘K, another tab) and disappears when it
  // ends — the session row is the single source of truth, not local state.
  const sessionQ = trpc.project.prepSession.useQuery({ projectId }, { refetchInterval: 1500 })

  const talk = trpc.project.talkToPrep.useMutation({
    onSuccess: () => void utils.project.prepSession.invalidate(),
    onError: (e) => toast.push(e.message),
  })

  const view = prep.data as PrepView | undefined
  const session = sessionQ.data ?? null
  const findings = view?.findings ?? []
  const pending = view?.pendingKeys ?? []
  const staleCount = findings.filter(isStale).length

  return (
    <section className="workspace">
      <div className="ws-head">
        <div className="ws-title-row">
          <span className="pw-tag">PREPARE</span>
          <span className="ws-title">{project?.name ?? 'This project'}</span>
          <span className="ws-title-spacer" />
          {onClose && (
            <button className="settings-clear" onClick={onClose}>
              Back
            </button>
          )}
        </div>
        <div className="pw-consequence">
          Repo facts an agent establishes once — how to install, how to verify, what is already
          red — so no burn agent re-derives them per ticket.
        </div>
      </div>

      <div className="ws-body">
        <div className="ws-body-inner">
          {prep.isLoading && <DimLine>loading…</DimLine>}
          {prep.error && <DimLine>could not load preparation: {prep.error.message}</DimLine>}

          {session ? (
            <div className="grill-panel pw-session">
              <div className="grill-strip">
                <span className="grill-kind">prepare</span>
                <SessionStatusDot status={session.status} />
                <span className="grill-live-label">
                  {session.status === 'launching' ? 'launching…' : 'live'}
                </span>
                <span className="grill-strip-spacer" />
                <span className="grill-sid" title={session.ccSessionId ?? session.id}>
                  {(session.ccSessionId ?? session.id).slice(0, 8)}
                </span>
                <EndSessionButton
                  sessionId={session.id}
                  onEnded={() => {
                    void utils.project.prepSession.invalidate()
                    void utils.project.prep.invalidate()
                  }}
                />
              </div>
              <div className="grill-term pw-term">
                <ErrorBoundary label="terminal">
                  <TerminalView sessionId={session.id} />
                </ErrorBoundary>
              </div>
            </div>
          ) : (
            <PrepCallToAction
              pending={pending}
              anyEstablished={findings.length > 0}
              starting={talk.isPending}
              onStart={() => talk.mutate({ projectId })}
            />
          )}

          {staleCount > 0 && (
            <div className="prep-warn">
              {staleCount} finding{staleCount === 1 ? ' has' : 's have'} not been re-measured in a
              long time. A stale test baseline is worse than none — agents trust it and file their
              own breakage under “already red on main”.
            </div>
          )}

          {findings.length > 0 && (
            <div className="pw-frame">
              <div className="pw-frame-head">Established</div>
              <ul className="prep-findings">
                {findings.map((f) => (
                  <li key={f.key} className={`prep-finding${isStale(f) ? ' is-stale' : ''}`}>
                    <div className="prep-finding-head">
                      <span className="prep-finding-key">{PREPARED_LABEL[f.key] ?? f.key}</span>
                      {/* Two sources, and the distinction that matters is which
                          one a later conversation may replace. Only `yours` is
                          locked; `verified` was established with you present but
                          stays improvable. */}
                      <span
                        className={`settings-badge${f.source === 'human' ? '' : ' is-override'}`}
                        title={
                          f.source === 'human'
                            ? 'You set this by hand — preparation will never overwrite it'
                            : HOST_ONLY_PREPARED.has(f.key)
                              ? 'Established on your own machine, where this key can actually be run'
                              : 'Established in a conversation, with evidence'
                        }
                      >
                        {f.source === 'human' ? 'yours' : 'verified'}
                      </span>
                    </div>
                    <div className="prep-finding-note">{describeFinding(f)}</div>
                    {f.evidence && <div className="prep-finding-evidence mono">{f.evidence}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** The resting state: what is still open, and the one button that opens it. */
function PrepCallToAction({
  pending,
  anyEstablished,
  starting,
  onStart,
}: {
  pending: readonly string[]
  anyEstablished: boolean
  starting: boolean
  onStart: () => void
}) {
  return (
    <div className="prep-cta">
      <div className="prep-cta-logo">
        <LogoMark size={44} variant="outline" />
      </div>
      <div className="prep-cta-title">
        {anyEstablished ? 'Finish preparing this project' : 'Prepare this project first'}
      </div>
      <div className="prep-cta-sub">
        A short conversation in your own checkout. It runs this repo’s commands, watches what they
        do, and records the answers — with you there to settle the ones only you know.
      </div>

      {pending.length > 0 && (
        <ul className="prep-cta-open">
          {pending.map((k) => (
            <li key={k}>{PREPARED_LABEL[k] ?? k}</li>
          ))}
        </ul>
      )}

      <Button variant="solid" disabled={starting} onClick={onStart}>
        {starting ? 'Opening…' : 'Start preparation'}
      </Button>
      <DimLine>
        {anyEstablished
          ? 'Opening it again resumes your last preparation conversation.'
          : 'It runs on your machine, and asks before touching anything stateful.'}
      </DimLine>
    </div>
  )
}
