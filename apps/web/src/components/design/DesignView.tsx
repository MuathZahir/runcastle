import { useEffect, useState } from 'react'
import { trpc } from '../../trpc'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { Button, DimLine, EmptyState, Spinner } from '../../ui'
import { IconArrowLeft, IconPen, IconRefresh, IconTerminal } from '../../icons'
import { DrivePanel } from '../review/DrivePanel'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

export interface DesignViewProps {
  featureId: string
  /** Where in the design server to point, as `show_panel` or Open in design named it; else the server's `lastPath`. */
  path?: string
}

/** How often a visible design view tells the server it is still being looked at. */
export const DESIGN_HEARTBEAT_MS = 60_000

/** The frame's address: the server's URL with the path appended, one slash between. */
export function designFrameUrl(url: string, path?: string): string {
  return path ? `${url.replace(/\/+$/, '')}${path}` : url
}

/**
 * The panel's design view (design-mode decisions 3, 4, 5): the live preview the
 * agent serves from the feature's talk worktree, in the drive's frame and
 * toolbar — Select area sends the crop to the chat rather than to a note.
 *
 * A server that is down but has a recorded command is started once on open
 * (Open in design, a reload); one that stops while the view is up shows that it
 * stopped and waits for the human, so an idle stop is never undone behind
 * their back. While the view is on screen it heartbeats, which is what keeps
 * the server from idling out; Close is the panel's, and leaves the server to
 * idle out on its own.
 *
 * The human is never stranded on a page the agent did not show: the line above
 * the frame goes Back to the agent's page (a link in the preview can take the
 * frame anywhere), restarts the server from its recorded command (a dev server
 * wedged on a build error), and shows what the server printed. A server that
 * dies says so, with its last output.
 */
export function DesignView({ featureId, path }: DesignViewProps) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const status = trpc.design.status.useQuery({ featureId }, { refetchInterval: useLivePoll() })
  const start = trpc.design.start.useMutation({
    onError: (e) => toast.push(e.message),
    onSettled: () => utils.design.status.invalidate({ featureId }),
  })
  const { mutate: beat } = trpc.design.heartbeat.useMutation()
  const { mutate: rememberPath } = trpc.design.showPath.useMutation({
    onSuccess: () => utils.design.status.invalidate({ featureId }),
  })
  const restart = trpc.design.restart.useMutation({
    onError: (e) => toast.push(e.message),
    onSettled: () => utils.design.status.invalidate({ featureId }),
  })
  const { mutate: startMutate } = start
  const { mutate: restartMutate } = restart
  // Bumped to remount the frame at the agent's page, wherever the frame has wandered.
  const [homeCount, setHomeCount] = useState(0)
  const home = () => setHomeCount((n) => n + 1)
  const [showOutput, setShowOutput] = useState(false)
  // An explicit path is told to the server, which remembers it per feature, so a
  // bare reopen — the topbar, another feature and back, a reload — lands there.
  const shownPath = path ?? status.data?.lastPath

  useEffect(() => {
    if (path) rememberPath({ featureId, path })
  }, [path, featureId, rememberPath])

  const running = status.data?.running === true
  const hasRecordedCommand = status.data?.hasRecordedCommand === true
  // Whether this view has seen its server up or asked for it: after that, a
  // server that is not running has stopped, and only the human starts it again.
  const [seen, setSeen] = useState(false)
  const loaded = status.data !== undefined

  useEffect(() => {
    if (running) setSeen(true)
  }, [running])

  useEffect(() => {
    if (!loaded || running || seen || !hasRecordedCommand) return
    setSeen(true)
    startMutate({ featureId })
  }, [loaded, running, seen, hasRecordedCommand, startMutate, featureId])

  useEffect(() => {
    if (!running) return
    const send = () => {
      if (document.visibilityState === 'visible') beat({ featureId })
    }
    send()
    const timer = setInterval(send, DESIGN_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [running, beat, featureId])

  const restartServer = () => restartMutate({ featureId }, { onSuccess: home })

  if (running && status.data?.url) {
    const paneId = status.data.paneId
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 p-3">
        <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
          <Button size="sm" variant="ghost" icon={<IconArrowLeft />} onClick={home}>
            Back to {shownPath ?? '/'}
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" icon={<IconRefresh />} onClick={restartServer}>
            Restart server
          </Button>
          {paneId && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconTerminal />}
              aria-expanded={showOutput}
              onClick={() => setShowOutput((v) => !v)}
            >
              {showOutput ? 'Hide output' : 'Show output'}
            </Button>
          )}
        </div>
        {showOutput && paneId && (
          <div className="relative h-60 min-h-40 shrink-0 overflow-hidden rounded-md bg-surface-inset animate-rise-in">
            <ErrorBoundary label="design server output">
              <TerminalView sessionId={paneId} />
            </ErrorBoundary>
          </div>
        )}
        <DrivePanel
          featureId={featureId}
          sendTo="chat"
          toolbarPlacement="bar"
          frameKey={String(homeCount)}
          url={designFrameUrl(status.data.url, shownPath)}
        />
      </div>
    )
  }
  if (!status.data || start.isPending || restart.isPending) {
    const starting = start.isPending || restart.isPending
    return (
      <div className="flex items-center justify-center gap-2 px-6 py-12">
        {starting && <Spinner size="sm" />}
        <DimLine>{starting ? 'Starting the design server…' : 'Looking for the design server…'}</DimLine>
      </div>
    )
  }
  const again = hasRecordedCommand ? (
    <Button onClick={() => startMutate({ featureId })}>Start it again</Button>
  ) : undefined
  const lastError = status.data.lastError
  if (lastError !== undefined && !start.isError) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-16">
        <EmptyState
          className="py-0"
          icon={<IconPen />}
          title="The design server stopped"
          hint="It exited on its own. What it printed last:"
          action={hasRecordedCommand ? <Button onClick={restartServer}>Restart server</Button> : undefined}
        />
        <pre className="m-0 max-h-60 w-full max-w-160 overflow-auto rounded-md bg-surface-inset px-3 py-2.5 font-mono text-xs whitespace-pre-wrap text-text-secondary">
          {lastError}
        </pre>
      </div>
    )
  }
  if (start.isError) {
    return (
      <EmptyState
        className="py-16"
        icon={<IconPen />}
        title="The design server didn’t start"
        hint={start.error.message}
        action={again}
      />
    )
  }
  if (seen) {
    return (
      <EmptyState
        className="py-16"
        icon={<IconPen />}
        title="The design server stopped"
        hint="It stops after 30 minutes out of sight, or when the chat ends."
        action={again}
      />
    )
  }
  return (
    <EmptyState
      className="py-16"
      icon={<IconPen />}
      title="No design server yet"
      hint="Ask the chat to show you a design. It starts the server."
    />
  )
}
