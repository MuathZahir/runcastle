import { useState, type ReactNode } from 'react'
import { Button, Disclosure, StatusLabel } from '../../ui'
import { IconRefresh, IconStop, IconTerminal } from '../../icons'
import { trpc } from '../../trpc'
import { openApp, openAppWaitingLabel, type DriveFailure } from '../../lib/feature-ui'
import { DRIVE_INSTRUCTIONS_SCOPE_NOTE } from '../../lib/settings'
import { useToast } from '../../lib/toast'
import { ErrorBoundary } from '../ErrorBoundary'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { Markdown } from '../Markdown'
import { TerminalView } from '../TerminalView'

/**
 * The test drive's pieces that are not the app itself: the project's drive
 * instructions, the stop control, the setup failure, and the footer strip under
 * the stage (decision 20).
 *
 * They used to be cards stacked down the review page, each deriving what the
 * drive was doing for itself; they are now the contents of the evidence stage's
 * drive states, laid out from the server's one drive-state value. The app on the
 * stage is {@link DrivePanel}'s.
 */

/**
 * What this project says a driver needs to know, beside the control that starts
 * a drive (decision 6) — the same text every drive-mode review and verification
 * prompt is handed, so a human taking the wheel reads what the agent read.
 *
 * Read-only here and edited in settings, because that is the loop it exists to
 * close: instructions that fail a drive fail it in front of somebody watching,
 * and the fix is one click from where they saw it. Blank renders nothing at all
 * — a bordered box saying a project has recorded nothing is worse than silence.
 *
 * The scope note is fixed prose the field itself cannot displace: the value is
 * the operator pre-authorising a driving agent, and the risk being managed is
 * that permission being read wider than the app under test.
 */
export function DriveInstructions({ text }: { text?: string | null }) {
  const instructions = text?.trim()
  if (!instructions) return null

  return (
    <Disclosure
      title="How to drive this app"
      icon={<IconTerminal />}
      aside={
        <SettingsLink location={{ page: 'project', field: 'driveInstructions' }}>
          Edit in settings
        </SettingsLink>
      }
    >
      <Markdown source={instructions} />
      <p className="m-0 mt-2 text-xs text-text-tertiary">{DRIVE_INSTRUCTIONS_SCOPE_NOTE}</p>
    </Disclosure>
  )
}

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
      icon={<IconStop />}
      loading={stop.isPending}
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
    <DriveFailureReport
      failure={failure}
      explanation={
        <>
          The branch is checked out, but <code className="font-mono">{failure.command}</code>{' '}
          {failure.outcome} — so whatever it was meant to bring up is probably not running. An agent
          can read this failure on your machine, repair the environment and retry the drive.
        </>
      }
    >
      {!readonly && (
        <div className="flex items-center gap-2">
          {failure.canFix && (
            <Button
              icon={<IconRefresh />}
              loading={fix.isPending}
              onClick={() => fix.mutate({ featureId })}
            >
              Fix drive
            </Button>
          )}
          <StopDrive featureId={featureId} label="Stop test drive" />
        </div>
      )}
    </DriveFailureReport>
  )
}

/**
 * The setup failure as read: what the command was, how it ended, and its own
 * output behind a disclosure. The way out is the caller's — a feature drive
 * offers Fix drive, a project drive offers preparation.
 */
export function DriveFailureReport({
  failure,
  explanation,
  children,
}: {
  failure: DriveFailure
  explanation: ReactNode
  /** The actions under the report. */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <StatusLabel tone="danger" size="sm" strong>
          Drive setup failed
        </StatusLabel>
        <div className="text-sm text-pretty text-text-secondary">{explanation}</div>
      </div>
      {failure.output && (
        <Disclosure title="What the command printed" icon={<IconTerminal />}>
          <pre className="m-0 max-h-55 overflow-auto rounded-md bg-surface-inset px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-text-secondary">
            {failure.output}
          </pre>
        </Disclosure>
      )}
      {children}
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
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
        {drive?.devPaneId && <StatusLabel tone="live">Dev server</StatusLabel>}
        <span className="truncate font-mono">{branch}</span>
        {open && (
          <span className="truncate font-mono">
            {open.state === 'ready' ? open.url : openAppWaitingLabel(open)}
          </span>
        )}
        <span className="flex-1" />
        {drive?.devPaneId && (
          <Button
            size="sm"
            variant="ghost"
            icon={<IconTerminal />}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide output' : 'Show output'}
          </Button>
        )}
      </div>

      {expanded && drive?.devPaneId && (
        <div className="relative h-105 min-h-65 overflow-hidden rounded-md bg-surface-inset animate-rise-in">
          <ErrorBoundary label="dev terminal">
            <TerminalView sessionId={drive.devPaneId} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}
