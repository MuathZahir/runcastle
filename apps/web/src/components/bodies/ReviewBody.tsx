import { useState } from 'react'
import { Button, CheckLine, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import type { DriveState } from '../../lib/workspace'
import {
  latestRun,
  mergeConflictKickoff,
  reviewChecks,
  unresolvedMergeConflict,
  type MergeConflictState,
} from '../../lib/feature-ui'
import { useEventLog } from '../../lib/events'
import { fmtDateTime, relTime } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { ErrorBoundary } from '../ErrorBoundary'
import { SessionPanel } from '../SessionPanel'
import { TerminalView } from '../TerminalView'

/**
 * The review phase body (app-redesign): a summary of the finished run on the
 * left (ticket tally, run outcome, commit count, branch) and the test-drive
 * panel on the right. All figures come from real wire data — the start/stop and
 * merge actions live in the workspace next-step bar. While a drive is active the
 * embedded dev pane + "Open app" link render full-width below the cards.
 *
 * An Iterate (`revisit`) session launched from the review bar renders as an
 * inline terminal above the cards — same pattern as GrillBody/TicketsBody — so
 * the human can drive the fix-ticket interview without leaving review.
 *
 * A conflicted Merge & ship surfaces the {@link ConflictCard} above the cards:
 * it lists the conflicting files and offers "Resolve with agent", which opens a
 * revisit session pre-briefed to merge the base branch into the feature branch
 * in the talk worktree. The conflict is read from the event feed, so it survives
 * a reload; the action is hidden while any session is live (one terminal per
 * feature — the server refuses a second one anyway).
 */
export function ReviewBody({ full, driving }: { full: FeatureFull; driving: DriveState | null }) {
  const { feature, tickets, runs } = full
  // Live-only: the conflict card's "Resolve with agent" spawns a terminal, and
  // one terminal per feature — an ENDED session (which the panel still renders,
  // with its Resume) must not hide it.
  const sessionLive = full.sessions.some((s) => s.status === 'live' || s.status === 'launching')
  const conflict = unresolvedMergeConflict(useEventLog(feature.id))
  const run = latestRun(runs)
  const isDriving = driving?.featureId === feature.id
  // Commits come from git, not from ticket commit rows (findings F23). Polled
  // slower than the 1.5s shell: a `rev-list --count` is cheap but this figure
  // only moves when a burn lands, and a human reads a card, not a ticker.
  const commits = trpc.feature.commitCount.useQuery({ featureId: feature.id }, { refetchInterval: 5000 })
  const drive = trpc.feature.driveInfo.useQuery(undefined, { refetchInterval: 1500 })
  const checks = reviewChecks({
    tickets,
    run,
    commitCount: commits.data?.count,
  })

  return (
    <div className="review-body">
      <SessionPanel featureId={feature.id} sessions={full.sessions} className="review-session" />

      {conflict && (
        <ConflictCard
          featureId={feature.id}
          branch={feature.branch}
          conflict={conflict}
          sessionLive={sessionLive}
        />
      )}

      <div className="review-grid">
      <div className="review-card">
        <SectionTitle>Summary</SectionTitle>
        {checks.map((row) => (
          <CheckLine key={row.key} row={row} />
        ))}
        <div className="review-foot">
          {feature.branch}
          {commits.data ? ` → ${commits.data.base}` : ''}
        </div>
      </div>

      <div className="review-card">
        <SectionTitle>Test drive</SectionTitle>
        {isDriving && driving ? (
          <DriveStatus branch={driving.branch} drive={drive.data} />
        ) : (
          <div className="drive-copy">
            Nothing is running yet. Start the test drive from the next step to boot this branch on
            its own port and click through the feature yourself — the merge gate wants a human
            behind the wheel.
          </div>
        )}
      </div>
      </div>

      {isDriving && drive.data?.featureId === feature.id && drive.data.devPaneId && (
        <DrivePane drive={drive.data} />
      )}
    </div>
  )
}

/**
 * What an active test drive actually is, said out loud (findings F22). A drive is
 * a `git checkout` plus — only if the project has a dev command — a dev server.
 * With no command configured the UI used to flip to "driving now" with a pulsing
 * dev-server chip over a checkout and nothing else, leaving the user waiting for
 * a URL that was never coming.
 *
 * Three states, because the three have different fixes: a server is up (drive
 * away), nothing was meant to start (set a dev command in Settings), or the spawn
 * failed (its output is in the timeline).
 */
function DriveStatus({
  branch,
  drive,
}: {
  branch: string
  drive: { devPaneId?: string; devConfigured: boolean } | null | undefined
}) {
  // While driveInfo is still in flight, say the one thing that is certainly true.
  if (!drive) {
    return (
      <div className="drive-live">
        <span className="drive-label">branch checked out</span>
        <span className="drive-loc">{branch}</span>
      </div>
    )
  }
  if (drive.devPaneId) {
    return (
      <>
        <div className="drive-live">
          <span className="drive-pulse" />
          <span className="drive-label">driving now</span>
          <span className="drive-loc">{branch}</span>
        </div>
        <div className="drive-copy">
          Click through the feature. When it feels right, merge — or stop the drive and send
          feedback back through tickets.
        </div>
      </>
    )
  }
  return (
    <>
      <div className="drive-live">
        <span className="drive-label is-quiet">checked out — nothing started</span>
        <span className="drive-loc">{branch}</span>
      </div>
      <div className="drive-copy">
        {drive.devConfigured
          ? 'Your repo is on this branch, but the dev server did not start — its output is in the timeline. Click through whatever you run yourself, then merge.'
          : 'Your repo is on this branch, but no server was started: this project has no dev command. Set one in Settings and the next drive boots the app here — or run it yourself and click through.'}
      </div>
    </>
  )
}

/**
 * The merge-conflict card (CONTEXT decision #9). Appears after a conflicted
 * Merge & ship, listing the conflicting files. "Resolve with agent" opens a
 * revisit session whose first message briefs the merge-into-feature resolution
 * (base branch + file list), so the agent resolves in the talk worktree and the
 * human retries Merge & ship. Hidden while a session is live — one terminal per
 * feature (the launcher's `assertSpawnable` refuses a second one regardless).
 */
function ConflictCard({
  featureId,
  branch,
  conflict,
  sessionLive,
}: {
  featureId: string
  branch: string
  conflict: MergeConflictState
  sessionLive: boolean
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const launch = trpc.feature.launchSession.useMutation({
    onSuccess: () => void utils.feature.get.invalidate({ id: featureId }),
    onError: (e) => toast.push(e.message),
  })

  return (
    <div className="review-card conflict-card">
      <div className="conflict-head">
        <SectionTitle>Merge conflict</SectionTitle>
        {/* When, because a red panel with no date reads as "right now" — the
            audit found one that was fifteen days stale (findings F8). */}
        <span className="conflict-when" title={fmtDateTime(conflict.at)}>
          recorded {relTime(conflict.at)} ago
        </span>
      </div>
      <div className="drive-copy">
        Merging <code>{conflict.base}</code> into <code>{branch}</code> hit conflicts. An agent can
        merge the base into this branch in the talk worktree, resolve with full spec context, and
        commit — then retry Merge &amp; ship.
      </div>
      {conflict.files.length > 0 && (
        <ul className="conflict-files">
          {conflict.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {!sessionLive && (
        <Button
          variant="solid"
          className="conflict-resolve"
          disabled={launch.isPending}
          onClick={() =>
            launch.mutate({
              featureId,
              kind: 'revisit',
              kickoffLine: mergeConflictKickoff(conflict.base, branch, conflict.files),
            })
          }
        >
          Resolve with agent
        </Button>
      )}
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
 *
 * Rendered only when a dev pane really exists — a "dev server" chip over a
 * process that was never spawned is the lie findings F22 is about, and the
 * {@link DriveStatus} card says what happened instead.
 */
function DrivePane({ drive }: { drive: { branch: string; devPaneId?: string; devUrl?: string } }) {
  const [expanded, setExpanded] = useState(false)
  if (!drive.devPaneId) return null

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
        <button
          type="button"
          className="btn btn-xs btn-ghost drive-pane-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide output' : 'Show output'}
        </button>
      </div>

      {expanded && (
        <div className="drive-pane-term">
          <ErrorBoundary label="dev terminal">
            <TerminalView sessionId={drive.devPaneId} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
