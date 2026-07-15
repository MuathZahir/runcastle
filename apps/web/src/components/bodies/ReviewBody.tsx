import { SectionTitle } from '../../ui'
import type { FeatureFull } from '../../lib/api'
import type { DriveState } from '../../lib/workspace'
import { latestRun } from '../../lib/feature-ui'

/**
 * The review phase body (app-redesign): a summary of the finished run on the
 * left (ticket tally, run outcome, commit count, branch) and the test-drive
 * panel on the right. All figures come from real wire data — the start/stop and
 * merge actions live in the workspace next-step bar.
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
  )
}
