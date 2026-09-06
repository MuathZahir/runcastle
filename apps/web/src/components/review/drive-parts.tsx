import { useState } from 'react'
import { Button, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import { openApp, openAppWaitingLabel, type DriveFailure } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * The test drive's pieces that are not the app itself: the stop control, the
 * setup failure, and the footer strip under the stage (decision 20).
 *
 * They used to be cards stacked down the review page, each deriving what the
 * drive was doing for itself; they are now the contents of the evidence stage's
 * drive states, laid out from the server's one drive-state value. The app on the
 * stage is {@link DrivePanel}'s.
 */

/**
 * Stop, wherever the stage needs to offer it: a bare checkout the human is done
 * inspecting, a drive whose setup failed, or a drive the review agent is holding
 * (decisions #10 — `stop` is deliberately purpose-blind, so the human can
 * reclaim the slot from a review agent that died holding it).
 */
export function StopDrive({ featureId, label }: { featureId: string; label: string }) {
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
      className="self-start"
      disabled={stop.isPending}
      onClick={() => stop.mutate({ featureId, action: 'stop' })}
    >
      {label}
    </Button>
  )
}

/**
 * The setup-failure state, rendered where the video would be (decision 20).
 *
 * A drive whose setup command failed used to be a toast on the click that caused
 * it and then a panel claiming "driving now" — the human left mid-review holding
 * a hookFailure blob at the worst possible moment to start debugging an
 * environment. So the failure takes the stage with the command, how it ended,
 * its own output behind a disclosure, and one click that opens an agent already
 * holding all three. The drive is deliberately left running: it holds the
 * feature branch checked out, which is the state the fix session needs.
 */
export function DriveSetupFailed({
  featureId,
  failure,
  readonly,
}: {
  featureId: string
  failure: DriveFailure
  /** History explains what went wrong; it never offers to go and fix it. */
  readonly: boolean
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionTitle>Drive setup failed</SectionTitle>
        <div className="text-sm text-text-2">
          The branch is checked out, but <code className="font-mono">{failure.command}</code>{' '}
          {failure.outcome} — so whatever it was meant to bring up is probably not running. An agent
          can read this failure on your machine, repair the environment and retry the drive.
        </div>
      </div>
      {failure.output && (
        <details>
          <summary className="cursor-pointer text-sm text-text-3">
            What the command printed
          </summary>
          <pre className="mt-2 max-h-55 overflow-auto rounded-sm bg-danger/9 px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-text-2">
            {failure.output}
          </pre>
        </details>
      )}
      {!readonly && (
        <div className="flex items-center gap-2">
          {failure.canFix && (
            <Button
              variant="solid"
              disabled={fix.isPending}
              onClick={() => fix.mutate({ featureId })}
            >
              Fix drive
            </Button>
          )}
          <StopDrive featureId={featureId} label="Stop test drive" />
        </div>
      )}
    </div>
  )
}

/**
 * The strip under the stage while any drive is up: which server, which branch,
 * and its output one click away (decision 20's footer chrome).
 *
 * The dev-server chip only claims a server when one was really spawned — a chip
 * over a process that was never started is the lie findings F22 is about — and
 * the URL stays plain text until the readiness poll says something answered, so
 * a link here is always a link that loads.
 */
export function DriveFooter({
  branch,
  drive,
}: {
  branch: string
  drive?: {
    devPaneId?: string
    devUrl?: string
    devReady?: boolean
    devReadyTimedOut?: boolean
  }
}) {
  const [expanded, setExpanded] = useState(false)
  const open = openApp(drive)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {drive?.devPaneId && (
          <span className="inline-flex h-6 items-center rounded-pill border border-accent-line bg-accent-soft px-2 font-mono text-xs text-drive">
            dev server
          </span>
        )}
        <span className="font-mono text-xs text-text-3">{branch}</span>
        {open && (
          <span className="font-mono text-xs text-text-3">
            {open.state === 'ready' ? open.url : openAppWaitingLabel(open)}
          </span>
        )}
        <span className="flex-1" />
        {drive?.devPaneId && (
          <Button
            className="h-6 px-2 text-xs"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide output' : 'Show output'}
          </Button>
        )}
      </div>

      {expanded && drive?.devPaneId && (
        <div className="relative h-105 min-h-65 overflow-hidden rounded-md border border-hairline bg-bg">
          <ErrorBoundary label="dev terminal">
            <TerminalView sessionId={drive.devPaneId} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
