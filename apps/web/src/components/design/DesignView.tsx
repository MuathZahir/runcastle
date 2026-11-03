import { useEffect, useState } from 'react'
import { trpc } from '../../trpc'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { Button, DimLine, EmptyState, IconButton, Spinner } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import { IconArrowLeft, IconMore, IconPen, IconRefresh, IconTerminal } from '../../icons'
import { DrivePanel } from '../review/DrivePanel'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'
import { mainChatInbox, putInInbox } from '../../lib/composer-inbox'
import { designAddress, usePassReachable, type PassReach } from '../../lib/design-address'
import { PassUnreachable } from './PassUnreachable'

export interface DesignViewProps {
  featureId: string
  /** Where in the design server to point, as the open design names it; else the server's `lastPath`. */
  path?: string
  /** The screen width the design was shown at; else the width the human last picked. */
  width?: number
  /**
   * Told whether the design is on screen: the server up and its pass-through
   * reachable. The bar above shows Approve only then, so nothing is approved
   * unseen (decision 8), as the phone does.
   */
  onShowingChange?: (showing: boolean) => void
}

/** How often a visible design view tells the server it is still being looked at. */
export const DESIGN_HEARTBEAT_MS = 60_000


/**
 * A design view's hold on its feature's design server, shared by the desktop
 * panel and the phone's Design screen.
 *
 * A server that is down but has a recorded command is started once on open
 * (a design opened, a reload); one that stops while the view is up shows that it
 * stopped and waits for the human, so an idle stop is never undone behind
 * their back. While the view is on screen it heartbeats, which is what keeps
 * the server from idling out; closing the view leaves the server to idle out
 * on its own.
 */
export function useDesignServer(featureId: string, path?: string) {
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

  const passPort = status.data?.passPort
  return {
    status: status.data,
    /** The running server's URL, or undefined while it is not up. */
    url: running ? status.data?.url : undefined,
    /**
     * Where the frame loads the running design (decisions 23, 26): through the
     * pass-through on this page's own host, never the server's localhost URL.
     */
    address: running && passPort !== undefined ? designAddress(window.location, passPort, featureId, shownPath) : undefined,
    passPort,
    shownPath,
    seen,
    start,
    restart,
    startServer: () => startMutate({ featureId }),
    restartServer: (onSuccess?: () => void) => restartMutate({ featureId }, onSuccess ? { onSuccess } : {}),
  }
}

export type DesignServer = ReturnType<typeof useDesignServer>

/**
 * The panel's design view (design-mode decisions 3, 4, 5): the live design the
 * agent serves from the feature's talk worktree, in the drive's frame and
 * toolbar — Select area sends the crop to the chat rather than to a note.
 *
 * The human is never stranded on a page the agent did not show: the frame's one
 * toolbar row goes Back to the agent's page (a link in the design can take the
 * frame anywhere), and its server menu restarts the server from its recorded
 * command (a dev server wedged on a build error) and shows what the server
 * printed. A server that dies says so, with its last output.
 */
export function DesignView({ featureId, path, width, onShowingChange }: DesignViewProps) {
  const server = useDesignServer(featureId, path)
  const { shownPath } = server
  // Bumped to remount the frame at the agent's page, wherever the frame has wandered.
  const [homeCount, setHomeCount] = useState(0)
  const home = () => setHomeCount((n) => n + 1)
  const [showOutput, setShowOutput] = useState(false)
  const restartServer = () => server.restartServer(home)
  const pass = usePassReachable(server.address ? server.passPort : undefined)
  const showing = !!server.address && server.passPort !== undefined && pass.reach === 'reachable'
  useEffect(() => {
    onShowingChange?.(showing)
  }, [showing, onShowingChange])

  if (server.address && server.passPort !== undefined) {
    if (pass.reach !== 'reachable') return <PassCheck reach={pass.reach} passPort={server.passPort} onRetry={pass.retry} />
    const paneId = server.status?.paneId
    // The server's own controls ride the frame's one toolbar row, folded into a
    // menu so the row never wraps into a second bar.
    const serverMenu = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Design server" icon={<IconMore />} tooltipSide="bottom" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<IconRefresh />} onSelect={restartServer}>
            Restart server
          </DropdownMenuItem>
          {paneId && (
            <DropdownMenuItem icon={<IconTerminal />} onSelect={() => setShowOutput((v) => !v)}>
              {showOutput ? 'Hide output' : 'Show output'}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
    return (
      <div className="flex h-full min-h-0 flex-col">
        <DrivePanel
          copy="chat"
          // A request to the agent: the crop goes straight into the main chat's
          // composer as an image, and the human writes the message there
          // (chat-as-web-components decision 5).
          onCapture={(png) =>
            putInInbox(mainChatInbox(featureId), [new File([png], 'selection.png', { type: 'image/png' })])
          }
          frameKey={String(homeCount)}
          url={server.address}
          leading={
            <IconButton
              label={`Back to ${shownPath ?? '/'}`}
              icon={<IconArrowLeft />}
              tooltipSide="bottom"
              onClick={home}
            />
          }
          trailing={serverMenu}
          {...(width !== undefined ? { width } : {})}
        />
        {showOutput && paneId && (
          <div className="relative h-60 min-h-40 shrink-0 overflow-hidden border-t border-border-subtle bg-surface-inset animate-rise-in">
            <ErrorBoundary label="design server output">
              <TerminalView sessionId={paneId} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    )
  }
  return <DesignServerDown server={server} onRestart={restartServer} />
}

/**
 * A design view's frame before the pass-through answers: a quiet line while
 * the probe is out, the port to forward when it cannot be reached.
 */
export function PassCheck({ reach, passPort, onRetry }: { reach: PassReach; passPort: number; onRetry: () => void }) {
  if (reach === 'unreachable') return <PassUnreachable hostname={window.location.hostname} passPort={passPort} onRetry={onRetry} />
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-12">
      <DimLine>Opening the design…</DimLine>
    </div>
  )
}

/**
 * What a design view shows while its server is not up: looking or starting,
 * died with its last output, failed to start, stopped, or never started.
 */
export function DesignServerDown({ server, onRestart }: { server: DesignServer; onRestart: () => void }) {
  const { status, start, restart, seen, startServer } = server
  if (!status || start.isPending || restart.isPending) {
    const starting = start.isPending || restart.isPending
    return (
      <div className="flex items-center justify-center gap-2 px-6 py-12">
        {starting && <Spinner size="sm" />}
        <DimLine>{starting ? 'Starting the design server…' : 'Looking for the design server…'}</DimLine>
      </div>
    )
  }
  const { hasRecordedCommand, lastError } = status
  const again = hasRecordedCommand ? <Button onClick={startServer}>Start it again</Button> : undefined
  if (lastError !== undefined && !start.isError) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-16">
        <EmptyState
          className="py-0"
          icon={<IconPen />}
          title="The design server stopped"
          hint="It exited on its own. What it printed last:"
          action={hasRecordedCommand ? <Button onClick={onRestart}>Restart server</Button> : undefined}
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
