import { useState } from 'react'
import { Button, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import { driveWheel, openApp, openAppWaitingLabel, type DriveFailure } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * The test drive's own pieces, lifted out of `ReviewBody` unchanged (ticket 7).
 *
 * They used to be cards stacked down the review page; they are now the contents
 * of the evidence stage's drive states (decision 20), which is why they live
 * beside the stage rather than in the body that used to own them. Ticket 9
 * rebuilds them into the integrated Open-app panel with the video's annotation
 * tools (decision 39) — until it lands, the behaviour they carry is the drive
 * surface, so it is moved rather than deleted.
 */

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
 *
 * Who is driving is a separate question from what is running, and {@link
 * driveWheel} answers it: the live state reads "review agent driving" when the
 * drive is the review ticket's own (decisions #10), and is word-for-word the
 * human's when it is not.
 */
export function DriveStatus({
  branch,
  drive,
}: {
  branch: string
  drive:
    | { purpose?: 'human' | 'review'; devPaneId?: string; devConfigured: boolean }
    | null
    | undefined
}) {
  const wheel = driveWheel(drive)
  // While driveInfo is still in flight, say the one thing that is certainly true.
  if (!drive) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold text-drive">branch checked out</span>
        <span className="font-mono text-xs text-text-2">{branch}</span>
      </div>
    )
  }
  if (drive.devPaneId) {
    return (
      <>
        <div className="flex items-center gap-2.5">
          <span className="size-2 animate-pulse rounded-pill bg-drive" />
          <span className="text-sm font-semibold text-drive">{wheel.label}</span>
          <span className="font-mono text-xs text-text-2">{branch}</span>
        </div>
        <div className="mt-2 text-sm text-text-2">{wheel.copy}</div>
      </>
    )
  }
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold text-text-2">checked out — nothing started</span>
        <span className="font-mono text-xs text-text-2">{branch}</span>
      </div>
      <div className="mt-2 text-sm text-text-2">
        {drive.devConfigured
          ? 'Your repo is on this branch, but the dev server did not start — its output is in the timeline. Click through whatever you run yourself, then merge.'
          : 'Your repo is on this branch, but no server was started: this project has no dev command. Set one in Settings and the next drive boots the app here — or run it yourself and click through.'}
      </div>
    </>
  )
}

/**
 * Stop, for a drive the review agent is holding (decisions #10).
 *
 * The human's own Stop lives in the next-step bar and the status bar, and both
 * are driven by this browser's record of a drive IT started — so a review drive
 * has no stop control anywhere without this one. It needs one: lap 1
 * deliberately made `stop` purpose-blind so the human can reclaim the slot from
 * a review agent that died holding it, and a Stop the server honours but the UI
 * never offers is the same as no Stop at all.
 */
export function StopReviewDrive({ featureId }: { featureId: string }) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const stop = trpc.feature.testDrive.useMutation({
    onSuccess: () => {
      void utils.feature.driveInfo.invalidate()
      void utils.feature.get.invalidate({ id: featureId })
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <Button
      className="mt-3 self-start"
      disabled={stop.isPending}
      onClick={() => stop.mutate({ featureId, action: 'stop' })}
    >
      Stop the review drive
    </Button>
  )
}

/**
 * The setup-failure surface (multi-service decisions 4 and 9). A drive whose
 * setup command failed used to be a toast on the click that caused it and then a
 * panel claiming "driving now" — the human was left mid-review holding a
 * hookFailure blob, at the worst possible moment to start debugging an
 * environment.
 *
 * So the failure gets the command, how it ended, its own output, and one click
 * that opens an agent already holding all three. The drive is deliberately left
 * running — it holds the feature branch checked out, which is the state the fix
 * session needs.
 */
export function DriveFailureCard({
  featureId,
  failure,
}: {
  featureId: string
  failure: DriveFailure
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const fix = trpc.feature.fixDrive.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: featureId })
      void utils.events.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  return (
    <div className="flex flex-col">
      <SectionTitle>Drive setup failed</SectionTitle>
      <div className="mt-2 text-sm text-text-2">
        The branch is checked out, but <code>{failure.command}</code> {failure.outcome} — so
        whatever it was meant to bring up is probably not running. An agent can read this failure
        on your machine, repair the environment and retry the drive.
      </div>
      {failure.output && (
        <pre className="mt-3 max-h-55 overflow-auto rounded-sm bg-danger/9 px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-text-2">
          {failure.output}
        </pre>
      )}
      {failure.canFix && (
        <Button
          className="mt-4 self-start"
          disabled={fix.isPending}
          onClick={() => fix.mutate({ featureId })}
        >
          Fix drive
        </Button>
      )}
    </div>
  )
}

/**
 * The test-drive dev pane: the project dev command runs in a drive-owned PTY the
 * server streams over `/ws/terminal/:devPaneId`. Collapsed to a status strip by
 * default (the terminal is only mounted — and only connects its WS — once
 * expanded), so boot output/errors are one click away. The sniffed URL surfaces
 * as plain "starting…" text and only becomes the "Open app" link once the server
 * has polled it and something answered; both the pane and the link disappear
 * when the drive stops (driveInfo → null). Nothing auto-opens — the human clicks
 * the link.
 *
 * Rendered only when a dev pane really exists — a "dev server" chip over a
 * process that was never spawned is the lie findings F22 is about, and the
 * {@link DriveStatus} card says what happened instead.
 */
export function DrivePane({
  drive,
}: {
  drive: {
    branch: string
    devPaneId?: string
    devUrl?: string
    devReady?: boolean
    devReadyTimedOut?: boolean
  }
}) {
  const [expanded, setExpanded] = useState(false)
  if (!drive.devPaneId) return null
  const open = openApp(drive)

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hairline bg-panel-2">
      <div className="flex h-9.5 items-center gap-2.5 border-b border-hairline-soft bg-panel px-3">
        <span className="inline-flex h-4.5 items-center rounded-pill border border-accent-line bg-accent-soft px-2 font-mono text-xs text-drive">
          dev server
        </span>
        <span className="font-mono text-xs text-text-3">{drive.branch}</span>
        <span className="flex-1" />
        {open &&
          (open.state === 'ready' ? (
            <a
              className="rounded-pill border border-drive/40 bg-accent-soft px-2.5 py-1 font-mono text-xs font-semibold text-drive no-underline hover:border-drive"
              href={open.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open app ↗
            </a>
          ) : (
            <span className="rounded-pill border border-hairline px-2.5 py-1 font-mono text-xs text-text-3">
              {openAppWaitingLabel(open)}
            </span>
          ))}
        <Button className="h-6 px-2 text-xs" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide output' : 'Show output'}
        </Button>
      </div>

      {expanded && (
        <div className="relative h-105 min-h-65 bg-bg">
          <ErrorBoundary label="dev terminal">
            <TerminalView sessionId={drive.devPaneId} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
