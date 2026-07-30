import { trpc } from '../trpc'
import { useToast } from '../lib/toast'
import { Button, DimLine, SessionStatusDot } from '../ui'
import { LogoMark } from '../icons'
import {
  HOST_ONLY_PREPARED,
  PREPARED_LABEL,
  describeFinding,
  isStale,
  relativeAge,
} from '../lib/settings'
import type { PrepView, ProjectFinding } from '../lib/api'
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
        <div className="ws-body-inner prep-stack">
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
          ) : view ? (
            // Only once the view has answered: `prepared` decides between two
            // headings that say opposite things, and guessing one flashes the
            // wrong sentence on every first paint.
            <PrepCallToAction
              prepared={view.prepared}
              preparedAt={view.preparedAt}
              pending={pending}
              findings={findings}
              staleCount={staleCount}
              starting={talk.isPending}
              onStart={() => talk.mutate({ projectId })}
              onStartFresh={() => talk.mutate({ projectId, fresh: true })}
            />
          ) : null}

          {/* While a conversation is open the call-to-action is gone, so what it
              carries has to stand on its own under the terminal. */}
          {session && <PrepEvidence findings={findings} staleCount={staleCount} />}
        </div>
      </div>
    </section>
  )
}

/**
 * The resting state — and it has two, because preparation does not end.
 *
 * Unprepared, this is the one thing to do: what is still open, and the button
 * that opens it. Prepared, it is the door back — what was established, when, and
 * the two ways to go again. That second state is the whole point of the change:
 * `prepared` is monotonic, so the screen used to congratulate the human by
 * removing every mention of preparation from the app, leaving a settings tooltip
 * that said "re-prepare to refresh it" and no way to.
 */
function PrepCallToAction({
  prepared,
  preparedAt,
  pending,
  findings,
  staleCount,
  starting,
  onStart,
  onStartFresh,
}: {
  prepared: boolean
  preparedAt: number | null
  pending: readonly string[]
  findings: readonly ProjectFinding[]
  staleCount: number
  starting: boolean
  onStart: () => void
  onStartFresh: () => void
}) {
  const anyEstablished = findings.length > 0

  if (prepared)
    return (
      <div className="prep-cta">
        <div className="prep-cta-logo">
          <LogoMark size={44} variant="outline" />
        </div>
        <div className="prep-cta-title">Re-prepare this project</div>
        <div className="prep-cta-sub">
          {preparedAt !== null
            ? `Prepared ${relativeAge(preparedAt)}. `
            : 'No preparation conversation on record — every field already had a value. '}
          Repo facts drift: commands get renamed, the test baseline moves, a new service needs a
          port. Going again re-measures them with you there.
        </div>

        {/* Hoisted above the buttons: on this screen the drifted baseline is the
            reason to act, not a footnote under the action. A stale one is the
            single actively harmful thing here — agents trust it and file their
            own breakage under "already red on main". */}
        <PrepEvidence findings={findings} staleCount={staleCount} />

        <div className="prep-cta-actions">
          <Button variant="solid" disabled={starting} onClick={onStart}>
            {starting ? 'Opening…' : 'Resume'}
          </Button>
          <Button disabled={starting} onClick={onStartFresh}>
            Start fresh
          </Button>
        </div>
        <DimLine>
          Resume picks your last preparation conversation back up. Start fresh opens one that has
          never seen it — the honest choice when what it concluded is what you are re-checking.
          Values you typed by hand are never overwritten either way.
        </DimLine>
      </div>
    )

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

      <PrepEvidence findings={findings} staleCount={staleCount} />
    </div>
  )
}

/**
 * What preparation has to show for itself, in the one order that reads: why to
 * act, then what is already there. Rendered under the terminal while a
 * conversation is open, under the button while there is still a job to do, and
 * above the buttons once there is not.
 */
function PrepEvidence({
  findings,
  staleCount,
}: {
  findings: readonly ProjectFinding[]
  staleCount: number
}) {
  return (
    <>
      {staleCount > 0 && <StaleWarning count={staleCount} />}
      {findings.length > 0 && <EstablishedFrame findings={findings} />}
    </>
  )
}

/** Why a re-prepare is worth the interruption: the baseline has gone off. */
function StaleWarning({ count }: { count: number }) {
  return (
    <div className="prep-warn">
      {count} finding{count === 1 ? ' has' : 's have'} not been re-measured in a long time. A stale
      test baseline is worse than none — agents trust it and file their own breakage under “already
      red on main”.
    </div>
  )
}

/** What preparation established, with the provenance that says whether to trust it. */
function EstablishedFrame({ findings }: { findings: readonly ProjectFinding[] }) {
  return (
    <div className="pw-frame">
      <div className="pw-frame-head">Established</div>
      <ul className="prep-findings">
        {findings.map((f) => (
          <li key={f.key} className={`prep-finding${isStale(f) ? ' is-stale' : ''}`}>
            <div className="prep-finding-head">
              <span className="prep-finding-key">{PREPARED_LABEL[f.key] ?? f.key}</span>
              {/* Three sources, and the distinction that matters is which ones a
                  later conversation may replace. Only `yours` is locked;
                  `verified` was established with you present but stays
                  improvable. `proposed`/`measured` are the retired headless
                  run's — kept because its rows outlive it, and a host-only key it
                  never executed must not now read as if someone watched it run. */}
              <span
                className={`settings-badge${f.source === 'human' ? '' : ' is-override'}`}
                title={
                  f.source === 'human'
                    ? 'You set this by hand — preparation will never overwrite it'
                    : f.source === 'session'
                      ? 'Established in a conversation on your own machine'
                      : HOST_ONLY_PREPARED.has(f.key)
                        ? 'Read from config by an older automatic run, not executed'
                        : 'Measured by an older automatic run, in a sandbox'
                }
              >
                {f.source === 'human'
                  ? 'yours'
                  : f.source === 'session'
                    ? 'verified'
                    : HOST_ONLY_PREPARED.has(f.key)
                      ? 'proposed'
                      : 'measured'}
              </span>
            </div>
            <div className="prep-finding-note">{describeFinding(f)}</div>
            {f.evidence && <div className="prep-finding-evidence mono">{f.evidence}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
