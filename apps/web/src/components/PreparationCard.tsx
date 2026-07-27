import { trpc } from '../trpc'
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

  const view = prep.data as PrepView | undefined
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
          </div>

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
                    <span
                      className={`settings-badge${f.source === 'human' ? '' : ' is-override'}`}
                      title={
                        f.source === 'human'
                          ? 'You set this by hand — preparation will never overwrite it'
                          : HOST_ONLY_PREPARED.has(f.key)
                            ? 'Read from config, not executed — this describes your machine, not the sandbox'
                            : 'Measured by running it in the sandbox'
                      }
                    >
                      {f.source === 'human'
                        ? 'yours'
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
