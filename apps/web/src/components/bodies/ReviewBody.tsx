import { useState } from 'react'
import { SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import type { DriveState } from '../../lib/workspace'
import { latestRun } from '../../lib/feature-ui'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * The review phase body (app-redesign): a summary of the finished run on the
 * left (ticket tally, run outcome, commit count, branch) and the test-drive
 * panel on the right. All figures come from real wire data — the start/stop and
 * merge actions live in the workspace next-step bar. While a drive is active the
 * embedded dev pane + "Open app" link render full-width below the cards.
 */
export function ReviewBody({ full, driving }: { full: FeatureFull; driving: DriveState | null }) {
  const { feature, tickets, runs } = full
  const run = latestRun(runs)
  const total = tickets.length
  const done = tickets.filter((t) => t.status === 'done').length
  const failed = tickets.filter((t) => t.status === 'failed').length
  const commits = tickets.reduce((n, t) => n + t.commits.length, 0)
  const isDriving = driving?.featureId === feature.id

  const ticketTone = failed > 0 ? 'var(--danger)' : 'var(--ok)'
  const runTone =
    run?.status === 'succeeded'
      ? 'var(--ok)'
      : run?.status === 'failed'
        ? 'var(--danger)'
        : 'var(--text-3)'

  return (
    <div className="review-body">
      <div className="review-grid">
      <div className="review-card">
        <SectionTitle>Summary</SectionTitle>
        <div className="check-row">
          <span className="check-dot" style={{ background: ticketTone }} />
          <span className="check-k">tickets</span>
          <span className="check-v">
            {done}/{total} done{failed > 0 ? ` · ${failed} failed` : ''}
          </span>
        </div>
        <div className="check-row">
          <span className="check-dot" style={{ background: runTone }} />
          <span className="check-k">run</span>
          <span className="check-v">
            {run ? `${run.status}${run.summary ? ` · ${run.summary}` : ''}` : 'no run recorded'}
          </span>
        </div>
        <div className="check-row">
          <span className="check-dot" style={{ background: 'var(--ph-shipped)' }} />
          <span className="check-k">changes</span>
          <span className="check-v">
            {commits} commit{commits === 1 ? '' : 's'}
          </span>
        </div>
        <div className="review-foot">⎇ {feature.branch}</div>
      </div>

      <div className="review-card">
        <SectionTitle>Test drive</SectionTitle>
        {isDriving && driving ? (
          <>
            <div className="drive-live">
              <span className="drive-pulse" />
              <span className="drive-label">driving now</span>
              <span className="drive-loc">{driving.branch}</span>
            </div>
            <div className="drive-copy">
              Click through the feature. When it feels right, merge — or stop the drive and send
              feedback back through tickets.
            </div>
          </>
        ) : (
          <div className="drive-copy">
            Nothing is running yet. Start the test drive from the next step to boot this branch on
            its own port and click through the feature yourself — the merge gate wants a human
            behind the wheel.
          </div>
        )}
      </div>
      </div>

      {isDriving && <DrivePane featureId={feature.id} />}
    </div>
  )
}

/**
 * The test-drive dev pane: the project dev command runs in a drive-owned PTY the
 * server streams over `/ws/terminal/:devPaneId`. Collapsed to a status strip by
 * default (the terminal is only mounted — and only connects its WS — once
 * expanded), so boot output/errors are one click away. The "Open app" link
 * surfaces the moment the server sniffs a localhost URL from the output; both the
 * pane and the link disappear when the drive stops (driveInfo → null). Nothing
 * auto-opens — the human clicks the link.
 */
function DrivePane({ featureId }: { featureId: string }) {
  const [expanded, setExpanded] = useState(false)
  const info = trpc.feature.driveInfo.useQuery(undefined, { refetchInterval: 1500 })
  const drive = info.data
  // The drive is global (one at a time); only render for THIS feature's drive.
  if (!drive || drive.featureId !== featureId) return null

  return (
    <div className="drive-pane">
      <div className="drive-pane-strip">
        <span className="drive-pane-kind">dev server</span>
        <span className="drive-pane-loc">{drive.branch}</span>
        <span className="drive-pane-spacer" />
        {drive.devUrl && (
          <a className="drive-open" href={drive.devUrl} target="_blank" rel="noreferrer noopener">
            Open app ↗
          </a>
        )}
        {drive.devPaneId && (
          <button
            type="button"
            className="btn btn-xs btn-ghost drive-pane-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide output' : 'Show output'}
          </button>
        )}
      </div>

      {expanded &&
        (drive.devPaneId ? (
          <div className="drive-pane-term">
            <ErrorBoundary label="dev terminal">
              <TerminalView sessionId={drive.devPaneId} />
            </ErrorBoundary>
          </div>
        ) : (
          <div className="drive-pane-empty">no dev command configured for this project</div>
        ))}
    </div>
  )
}
