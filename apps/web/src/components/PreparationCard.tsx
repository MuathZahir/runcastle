import { trpc } from '../trpc'
import { TerminalView } from './TerminalView'
import { useToast } from '../lib/toast'
import { DimLine } from '../ui'
import {
  HOST_ONLY_PREPARED,
  PREPARED_LABEL,
  describeFinding,
  isStale,
  relativeAge,
} from '../lib/settings'
import type { PrepView } from '../lib/api'

/**
 * The preparation card in the settings overlay.
 *
 * Preparation fills in the fields nobody fills in — verify commands, the test
 * baseline, the install command — by measuring them in the same sandbox burn
 * agents get. This card is where that becomes legible: what was established,
 * who established it, what justified it, and how far the repo has moved since.
 *
 * The staleness line is the part that earns its space. A finding does not
 * announce that it has rotted, and a rotted test baseline is worse than an
 * absent one: an agent trusts it and files its own breakage under "already red
 * on main". Showing the distance, and nudging past a threshold, is what keeps
 * an automatically-established value honest over time.
 */
export function PreparationCard({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()

  // Polled while a run is live so the card follows it without a page action;
  // the detailed agent output lands in the project timeline as `prep.*` events.
  const prep = trpc.project.prep.useQuery(
    { projectId },
    { refetchInterval: (q) => ((q.state.data as PrepView | undefined)?.running ? 1500 : false) },
  )

  const start = trpc.project.prepare.useMutation({
    onSuccess: (res) => {
      void utils.project.prep.invalidate()
      if (res.keys.length === 0) toast.push('Nothing left to establish.')
    },
    onError: (e) => toast.push(e.message),
  })

  const cancel = trpc.project.cancelPrepare.useMutation({
    onSuccess: () => void utils.project.prep.invalidate(),
    onError: (e) => toast.push(e.message),
  })

  // The open conversation, if there is one. Polled so the terminal appears when
  // a session is launched from anywhere (⌘K, another tab) and disappears when it
  // ends — the session row is the single source of truth, not local state.
  const session = trpc.project.prepSession.useQuery({ projectId }, { refetchInterval: 3000 })

  const talk = trpc.project.talkToPrep.useMutation({
    onSuccess: () => void utils.project.prepSession.invalidate(),
    onError: (e) => toast.push(e.message),
  })

  const endTalk = trpc.feature.endSession.useMutation({
    onSuccess: () => {
      void utils.project.prepSession.invalidate()
      void utils.project.prep.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  const view = prep.data as PrepView | undefined
  const prepSession = session.data ?? null
  const running = view?.running ?? false
  const findings = view?.findings ?? []
  const pending = view?.pendingKeys ?? []
  const latest = view?.latest ?? null
  const staleCount = findings.filter(isStale).length

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h3 className="settings-section-title">Preparation</h3>
        <span className="settings-section-hint">
          Repo facts an agent measures once, so no burn agent re-derives them per ticket.
        </span>
      </div>

      {prep.isLoading && <DimLine>loading…</DimLine>}
      {prep.error && <DimLine>could not load preparation: {prep.error.message}</DimLine>}

      {view && (
        <>
          <div className="prep-status">
            <span className={`prep-dot${running ? ' is-running' : ''}`} aria-hidden="true" />
            <span className="prep-status-text">
              {running
                ? 'Preparing — measuring this repo in a sandbox…'
                : latest
                  ? `Last run ${relativeAge(latest.startedAt)} — ${latest.status}${latest.summary ? `: ${latest.summary}` : ''}`
                  : 'Never prepared.'}
            </span>
            {running ? (
              <button
                className="settings-clear"
                onClick={() => cancel.mutate({ projectId })}
                disabled={cancel.isPending}
              >
                Cancel
              </button>
            ) : (
              <button
                className="settings-clear"
                onClick={() =>
                  // `refresh` re-measures what a previous run established, not
                  // just the empty fields — otherwise a stale baseline can never
                  // be replaced. Human-set values are out of scope either way.
                  start.mutate({ projectId, refresh: findings.length > 0 })
                }
                disabled={start.isPending}
              >
                {findings.length > 0 ? 'Re-prepare' : 'Prepare now'}
              </button>
            )}
            {/* The conversation is a peer of the headless run, not a fallback:
                a sandbox cannot ask a question, and cannot verify anything about
                THIS machine. Offered whether or not a run has happened. */}
            {prepSession ? (
              <button
                className="settings-clear"
                onClick={() => endTalk.mutate({ sessionId: prepSession.id })}
                disabled={endTalk.isPending}
              >
                End conversation
              </button>
            ) : (
              <button
                className="settings-clear"
                onClick={() => talk.mutate({ projectId })}
                disabled={talk.isPending}
              >
                {talk.isPending ? 'Opening…' : 'Talk to preparation'}
              </button>
            )}
          </div>

          {prepSession && (
            <div className="prep-talk">
              <DimLine>
                A preparation agent is open in your real checkout — it can run the host-only
                commands a sandbox can only guess at. It will ask before touching anything
                stateful.
              </DimLine>
              <div className="prep-talk-terminal">
                <TerminalView sessionId={prepSession.id} />
              </div>
            </div>
          )}

          {!running && pending.length > 0 && (
            <DimLine>
              {pending.length} field{pending.length === 1 ? '' : 's'} not established:{' '}
              {pending.map((k) => PREPARED_LABEL[k] ?? k).join(', ')}
            </DimLine>
          )}

          {staleCount > 0 && (
            <div className="prep-warn">
              {staleCount} finding{staleCount === 1 ? ' has' : 's have'} not been re-measured in a
              long time. A stale test baseline is worse than none — agents trust it and file their
              own breakage under “already red on main”.
            </div>
          )}

          {findings.length === 0 ? (
            <DimLine>
              Nothing established yet. Preparation runs the repo’s own commands in a sandbox and
              records what it observed.
            </DimLine>
          ) : (
            <ul className="prep-findings">
              {findings.map((f) => (
                <li key={f.key} className={`prep-finding${isStale(f) ? ' is-stale' : ''}`}>
                  <div className="prep-finding-head">
                    <span className="prep-finding-key">{PREPARED_LABEL[f.key] ?? f.key}</span>
                    {/* Three sources, and the distinction that matters is which
                        ones a later automatic run may replace. Only `yours` is
                        locked; `verified` was established with you present but
                        stays improvable. A host-only key reads `proposed` only
                        while it is still the sandbox's guess — once a
                        conversation actually ran it, it is verified. */}
                    <span
                      className={`settings-badge${f.source === 'human' ? '' : ' is-override'}`}
                      title={
                        f.source === 'human'
                          ? 'You set this by hand — preparation will never overwrite it'
                          : f.source === 'session'
                            ? 'Established in a conversation on your own machine, not in a sandbox. A later run may still improve it.'
                            : HOST_ONLY_PREPARED.has(f.key)
                              ? 'Read from config, not executed — this describes your machine, not the sandbox'
                              : 'Measured by running it in the sandbox'
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
          )}
        </>
      )}
    </section>
  )
}
