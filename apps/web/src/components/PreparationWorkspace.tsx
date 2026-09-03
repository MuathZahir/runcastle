import { useState } from 'react'
import { trpc } from '../trpc'
import { openApp, openAppWaitingLabel, sessionStatusLabel, type OpenApp } from '../lib/feature-ui'
import { useLivePoll } from '../lib/live'
import { useToast } from '../lib/toast'
import { Button, DimLine, SessionStatusDot } from '../ui'
import { LogoMark } from '../icons'
import {
  HOST_ONLY_PREPARED,
  PREPARED_LABEL,
  describeFinding,
  isStale,
  relativeAge,
  verificationBadge,
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

  const prep = trpc.project.prep.useQuery({ projectId }, { refetchInterval: useLivePoll(3000) })

  // The open conversation, if there is one. Polled so the terminal appears when
  // a session is launched from anywhere (⌘K, another tab) and disappears when it
  // ends — the session row is the single source of truth, not local state.
  const sessionQ = trpc.project.prepSession.useQuery(
    { projectId },
    { refetchInterval: useLivePoll() },
  )

  const talk = trpc.project.talkToPrep.useMutation({
    onSuccess: () => void utils.project.prepSession.invalidate(),
    onError: (e) => toast.push(e.message),
  })

  // The dry run's stop half, by hand. It frees the singleton drive slot, so the
  // drive info every other surface polls has to be refetched too.
  const stopDryRun = trpc.project.dryRunStop.useMutation({
    onSuccess: () => {
      void utils.project.prep.invalidate()
      void utils.feature.driveInfo.invalidate()
    },
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
          <span className="inline-flex h-[18px] items-center rounded-pill border border-accent-line bg-accent-soft px-2 text-[9.5px] font-bold tracking-[0.09em] text-accent-hi">
            PREPARE
          </span>
          <span className="ws-title">{project?.name ?? 'This project'}</span>
          <span className="ws-title-spacer" />
          {onClose && (
            <button className="settings-clear" onClick={onClose}>
              Back
            </button>
          )}
        </div>
        <div className="mt-2 text-sm leading-6 text-text-3">
          Repo facts an agent establishes once — how to install, how to verify, what is already
          red — so no burn agent re-derives them per ticket.
        </div>
      </div>

      <div className="ws-body">
        <div className="ws-body-inner flex flex-col gap-[18px]">
          {prep.isLoading && <DimLine>loading…</DimLine>}
          {prep.error && <DimLine>could not load preparation: {prep.error.message}</DimLine>}

          {/* Above everything, session or not: what is up on this machine right
              now. A prep session that dies mid-run leaves a dev server and a temp
              database behind, and the teardown half has to be reachable without
              it (decision 9). */}
          {view?.dryRun && (
            <DryRunRow
              open={openApp(view.dryRun)}
              stopping={stopDryRun.isPending}
              onStop={() => stopDryRun.mutate({ projectId })}
            />
          )}

          {session ? (
            <div className="grill-panel">
              <div className="grill-strip">
                <span className="grill-kind">prepare</span>
                <SessionStatusDot status={session.status} />
                <span className="grill-live-label">{sessionStatusLabel(session)}</span>
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
              <div className="grill-term h-[clamp(300px,calc(100dvh-420px),1200px)]">
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
export function PrepCallToAction({
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
      <div className="flex flex-col items-center gap-3 py-7 pt-10 text-center">
        <div className="flex opacity-85">
          <LogoMark size={44} variant="outline" />
        </div>
        <div className="text-lg font-medium text-text">Re-prepare this project</div>
        <div className="max-w-[52ch] text-sm leading-6 text-text-3">
          {preparedAt !== null
            ? `Prepared ${relativeAge(preparedAt)}. `
            : 'No preparation conversation on record — every field already had a value. '}
          Repo facts drift; re-preparing measures them again with you there.
        </div>
        {staleCount > 0 && <StaleWarning count={staleCount} />}
        <div className="flex items-center gap-2">
          <Button variant="solid" disabled={starting} onClick={onStart}>
            {starting ? 'Opening…' : 'Resume'}
          </Button>
          <Button disabled={starting} onClick={onStartFresh}>
            Start fresh
          </Button>
        </div>
        <div className="max-w-[52ch] text-sm leading-6 text-text-3">
          Resume continues your last preparation conversation; Start fresh opens one that has never
          seen it — values you typed by hand are never overwritten.
        </div>
        {findings.length > 0 && <EstablishedFrame findings={findings} />}
      </div>
    )

  return (
    <div className="flex flex-col items-center gap-3 py-7 pt-10 text-center">
      <div className="flex opacity-85">
        <LogoMark size={44} variant="outline" />
      </div>
      <div className="text-lg font-medium text-text">
        {anyEstablished ? 'Finish preparing this project' : 'Prepare this project first'}
      </div>
      <div className="max-w-[52ch] text-sm leading-6 text-text-3">
        Opens a terminal session here with an agent in your own checkout — it runs this repo's
        commands, records the answers, and asks you the ones only you know.
      </div>

      {pending.length > 0 && (
        <ul className="m-0 flex max-w-[56ch] list-none flex-wrap justify-center gap-1.5 p-0 [&_li]:rounded-pill [&_li]:border [&_li]:border-hairline [&_li]:bg-panel-3 [&_li]:px-2 [&_li]:py-[3px] [&_li]:text-xs [&_li]:text-text-3">
          {pending.map((k) => (
            <li key={k}>{PREPARED_LABEL[k] ?? k}</li>
          ))}
        </ul>
      )}

      <Button variant="solid" disabled={starting} onClick={onStart}>
        {starting ? 'Opening…' : 'Start preparation'}
      </Button>
      <PrepEvidence findings={findings} staleCount={staleCount} />
    </div>
  )
}

/**
 * What preparation has to show for itself, in the one order that reads: why to
 * act, then what is already there. Rendered under the terminal while a
 * conversation is open and under the button while there is still a job to do;
 * the prepared call-to-action places those concerns separately around its actions.
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

/**
 * The preparation dry run, while it holds the drive slot (decision 9). It is a
 * real drive on the human's machine — services up, a temp database created — so
 * the row says so and offers the teardown, which is the half a dead prep session
 * never runs. The sniffed URL is shown when there is one: it is the same
 * evidence `devCommand`'s stamp is made of. It is a LINK only once the server
 * has watched it answer, exactly as the feature drive's pane behaves.
 */
function DryRunRow({
  open,
  stopping,
  onStop,
}: {
  open: OpenApp | null
  stopping: boolean
  onStop: () => void
}) {
  return (
    <div className="flex items-center gap-[9px] rounded-md border border-drive/35 bg-drive/10 px-[11px] py-2">
      <span className="drive-pulse" />
      <span className="text-sm font-semibold text-drive">Preparation dry-run in progress</span>
      {open &&
        (open.state === 'ready' ? (
          <a className="font-mono text-sm text-text-2" href={open.url} target="_blank" rel="noreferrer">
            {open.url}
          </a>
        ) : (
          <span className="font-mono text-sm text-text-3">
            {openAppWaitingLabel(open)}
          </span>
        ))}
      <span className="flex-1" />
      <Button className="btn-xs" disabled={stopping} onClick={onStop}>
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
    </div>
  )
}

/**
 * Whether a dry run has ever seen this value work, on the keys one can prove.
 * Nothing at all on the rest — `dbResetCommand` has no drive slot to prove it in
 * and a host drive never touches the sandbox keys, so silence is the honest
 * report (decision 10).
 */
function VerificationBadge({ finding }: { finding: ProjectFinding }) {
  const badge = verificationBadge(finding)
  if (!badge) return null
  const proven = finding.verifiedAt !== undefined
  return (
    <span
      className={`settings-badge${proven ? ' is-verified' : ' is-unverified'}`}
      title={
        proven
          ? 'A preparation dry run ran this value on the real drive machinery and it worked'
          : 'No dry run has ever proven this value — a drive that depends on it may fall over'
      }
    >
      {badge}
    </span>
  )
}

/** Why a re-prepare is worth the interruption: the baseline has gone off. */
function StaleWarning({ count }: { count: number }) {
  return (
    <div className="w-full max-w-[62ch] rounded-md border border-drive/35 bg-drive/10 px-[9px] py-[7px] text-left text-sm leading-5 text-text-2">
      {count} finding{count === 1 ? ' has' : 's have'} not been re-measured in a long time. A stale
      test baseline is worse than none — agents trust it and file their own breakage under “already
      red on main”.
    </div>
  )
}

/** What preparation established, with the provenance that says whether to trust it. */
export function EstablishedFrame({ findings }: { findings: readonly ProjectFinding[] }) {
  return (
    <div className="w-full max-w-[62ch] rounded-lg border border-hairline bg-panel-2 px-4 py-3.5 text-left">
      <div className="mb-2 text-xs font-bold tracking-[0.09em] text-text-3 uppercase">
        Established
      </div>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {findings.map((f) => {
          const label = PREPARED_LABEL[f.key] ?? f.key
          return <FindingRow key={f.key} finding={f} label={label} />
        })}
      </ul>
    </div>
  )
}

function FindingRow({ finding: f, label }: { finding: ProjectFinding; label: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline gap-[7px]">
        <span className="text-sm text-text">{label}</span>
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
              {/* The dry-run stamp, on the three keys a host drive can actually
                  prove (decision 10). Every other key shows nothing here —
                  absence of proof, not failure, and a badge reading "unverified"
                  on a key no dry run will ever touch would say the opposite. */}
              <VerificationBadge finding={f} />
      </div>
      <div className={`text-xs ${isStale(f) ? 'text-drive' : 'text-text-4'}`}>
        {describeFinding(f)}
      </div>
      {f.evidence && (
        <>
          <div className="rounded-r-md border-l-2 border-accent-line bg-panel-inset px-[7px] py-[5px]">
            <div
              className={`whitespace-pre-wrap break-words font-mono text-xs leading-[1.45] text-text-3 ${expanded ? '' : 'line-clamp-3'}`}
            >
              {f.evidence}
            </div>
          </div>
          <button
            className="self-start border-0 bg-transparent p-0 text-xs text-accent-hi hover:text-accent"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Show full'} evidence for ${label}`}
          >
            {expanded ? 'Show less' : 'Show full evidence'}
          </button>
        </>
      )}
    </li>
  )
}
