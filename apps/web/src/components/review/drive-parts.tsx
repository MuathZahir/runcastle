import { useState, type ReactNode } from 'react'
import { Button, Disclosure, StatusLabel } from '../../ui'
import { IconAlert, IconRefresh, IconTerminal } from '../../icons'
import { trpc } from '../../trpc'
import { openApp, openAppWaitingLabel, type DriveFailure } from '../../lib/feature-ui'
import { DRIVE_INSTRUCTIONS_SCOPE_NOTE } from '../../lib/settings'
import { useToast } from '../../lib/toast'
import { useLandOnChat } from '../../lib/land-on-chat'
import { ErrorBoundary } from '../ErrorBoundary'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { Markdown } from '../Markdown'
import { TerminalView } from '../TerminalView'

/**
 * The test drive's pieces that are not the app itself: the project's drive
 * instructions, the setup failure, the moments a drive passes through, and the
 * status line under the app (decision 20). The stage that lays them out from
 * the server's one drive-state value is `DriveStage`.
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
 * The setup-failure state, rendered where the app would be (decision 20).
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
}: {
  featureId: string
  failure: DriveFailure
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  // The fix session lands on the Chat tab, like every session launch.
  const landOnChat = useLandOnChat(featureId)
  const fix = trpc.feature.fixDrive.useMutation({
    onSuccess: () => {
      void utils.feature.get.invalidate({ id: featureId })
      void utils.events.invalidate()
      landOnChat()
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
      {failure.canFix && (
        <Button
          className="self-start"
          icon={<IconRefresh />}
          loading={fix.isPending}
          onClick={() => fix.mutate({ featureId })}
        >
          Fix drive
        </Button>
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
    // Left-aligned in the centred window: a command and its output read
    // down a margin, not around a centre line.
    <div className="flex w-full max-w-[64ch] flex-col gap-3 self-center">
      <div className="flex flex-col gap-1.5">
        <StatusLabel tone="danger" icon={<IconAlert />} size="sm" strong>
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
 * The drive window's status line, under the page (test-drive-looks-the-part
 * decision 2): which server, which branch, the address, and its output one
 * click away — the output opening as a drawer between the page and this line.
 *
 * The dev-server mark only claims a server when one was really spawned — a mark
 * over a process that was never started is the lie findings F22 is about — and
 * the address stays plain text until the readiness poll says something answered.
 *
 * `where` is a project drive's checkout folder and identity (decision 5),
 * moved here from under the page title.
 */
export function DriveFooter({
  branch,
  drive,
  where,
}: {
  branch: string
  drive?: {
    devPaneId?: string
    devUrl?: string
    devReady?: boolean
    devReadyTimedOut?: boolean
  }
  where?: { text: string; title: string }
}) {
  const [expanded, setExpanded] = useState(false)
  const open = openApp(drive)

  return (
    <>
      {expanded && drive?.devPaneId && (
        <div className="relative h-60 shrink-0 overflow-hidden border-t border-border-subtle bg-surface-inset animate-fade-in">
          <ErrorBoundary label="dev terminal">
            <TerminalView sessionId={drive.devPaneId} />
          </ErrorBoundary>
        </div>
      )}
      <div className="flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-border-subtle px-3 text-xs text-text-tertiary">
        {drive?.devPaneId && (
          <span className="shrink-0">
            <StatusLabel tone="live">Dev server</StatusLabel>
          </span>
        )}
        <span className="max-w-48 shrink-0 truncate font-mono" title={branch}>
          {branch}
        </span>
        {open && (
          <span className="min-w-0 shrink-[2] truncate font-mono" title={open.state === 'ready' ? open.url : undefined}>
            {open.state === 'ready' ? open.url : openAppWaitingLabel(open)}
          </span>
        )}
        {where && (
          <span className="min-w-0 shrink-[3] truncate font-mono" title={where.title}>
            {where.text}
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
            {expanded ? 'Hide output' : 'Output'}
          </Button>
        )}
      </div>
    </>
  )
}

/**
 * The drive window while there is no page to show (decision 3): the same head
 * the app will have, naming the state, the moment itself centred where the app
 * will appear, and the status line under
 * it. The feature drive and the project drive both draw every in-between state
 * through this, so the two read as one product.
 */
export function DriveStateWindow({
  state,
  leading,
  trailing,
  footer,
  children,
}: {
  /** The head's words: a `StatusLabel`. */
  state: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  footer?: ReactNode
  /** The moment: a {@link DriveMoment}, or a failure report. */
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-1 border-b border-border-subtle px-2">
        {leading}
        <span className="min-w-0 truncate px-1.5">{state}</span>
        <span className="flex-1" />
        {trailing}
      </div>
      <div className="flex min-h-65 flex-1 flex-col items-center justify-center overflow-auto bg-surface-inset px-8 py-10">
        {children}
      </div>
      {footer}
    </div>
  )
}

/** One in-between moment, centred in the window: an icon, what is happening, what to do, at most one action. */
export function DriveMoment({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex max-w-[52ch] flex-col items-center gap-2 text-center">
      <span className="mb-1 text-icon [&>svg]:size-5">{icon}</span>
      <div className="text-md font-medium text-text">{title}</div>
      {children && <div className="text-sm text-pretty text-text-secondary">{children}</div>}
      {action && <div className="mt-3 flex items-center gap-2">{action}</div>}
    </div>
  )
}
