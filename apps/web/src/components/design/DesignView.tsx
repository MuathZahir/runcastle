import { useEffect, useState } from 'react'
import { trpc } from '../../trpc'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { Button, DimLine, EmptyState } from '../../ui'
import { IconPen } from '../../icons'
import { DrivePanel } from '../review/DrivePanel'

export interface DesignViewProps {
  featureId: string
  /** Where in the design server to point, as the agent's `show_panel` named it. */
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
  const { mutate: startMutate } = start

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

  if (running && status.data?.url) {
    return (
      <div className="flex h-full min-h-0 flex-col p-3">
        <DrivePanel featureId={featureId} sendTo="chat" url={designFrameUrl(status.data.url, path)} />
      </div>
    )
  }
  if (!status.data || start.isPending) {
    return (
      <div className="px-6 py-12 text-center">
        <DimLine>{start.isPending ? 'Starting the design server…' : 'Looking for the design server…'}</DimLine>
      </div>
    )
  }
  const again = hasRecordedCommand ? (
    <Button onClick={() => startMutate({ featureId })}>Start it again</Button>
  ) : undefined
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
