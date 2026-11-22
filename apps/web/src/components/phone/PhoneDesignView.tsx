import { useEffect, useRef, useState } from 'react'
import { IconCheck } from '../../icons'
import { designAddress, usePassReachable, type PageAddress } from '../../lib/design-address'
import { DEFAULT_PREVIEW_WIDTH, frameSize } from '../../lib/preview-width'
import { useDesignReport } from '../../lib/use-design-report'
import { useApproveAndNext, useDesignRecord, useMarkSeen } from '../../lib/use-designs'
import { trpc } from '../../trpc'
import { Button } from '../../ui'
import { DesignServerDown, PassCheck, useDesignServer } from '../design/DesignView'
import { PhoneViewScreen } from './PhoneChatBar'

/**
 * Where the phone's frame loads the design: through the pass-through on the
 * page's own host, as every design view does (decision 26) — whether or not
 * the phone link is set up, and never the design server's own localhost URL.
 */
export function phoneDesignSrc(page: PageAddress, passPort: number, featureId: string, path: string | undefined): string {
  return designAddress(page, passPort, featureId, path)
}

/**
 * A feature's Design on the phone (docs/features/runcastle-on-your-phone
 * decision 5): its real page, tappable and updating as the agent changes it,
 * laid out at the width it was designed for and scaled to the phone, or at the
 * phone's own. No Select area: the human says what to change in the chat.
 * The server is held as the desktop view holds it — started from its recorded
 * command, kept alive by heartbeat.
 *
 * A recorded design (designs-and-the-plan-get-their-own-place decisions 16,
 * 24) opens at its own width under its own title, is marked seen, and while it
 * waits offers Approve in the bar — "Approve & next" while others wait, which
 * moves on to the next of them (`onOpen`), plain "Approve" on the last, which
 * goes back to the chat. There is no list on the phone.
 */
export function PhoneDesignView({
  featureId,
  path,
  width,
  title,
  sub,
  onOpen,
  onBack,
}: {
  featureId: string
  path?: string
  /** The width asked for with no recorded design at `path`; Desktop is 1440 without one. */
  width?: number
  title: string
  sub?: string
  /** Open the design at this page: where Approve & next moves to. */
  onOpen: (path: string) => void
  onBack: () => void
}) {
  const server = useDesignServer(featureId, path)
  const pass = usePassReachable(server.url ? server.passPort : undefined)
  const utils = trpc.useUtils()
  const { designs } = useDesignRecord(featureId)
  const shownPath = path ?? server.shownPath
  const open = shownPath === undefined ? undefined : designs?.find((d) => d.path === shownPath)
  const { mutate: markSeen } = trpc.design.seen.useMutation({ onSettled: () => utils.design.list.invalidate({ featureId }) })
  useMarkSeen(open?.id, open?.isNew === true, () => open && markSeen({ designId: open.id }))
  const { approve, approving } = useApproveAndNext(featureId, designs, { onNext: onOpen, onDone: onBack })
  const othersWaiting = designs?.filter((d) => d.state === 'waiting' && d.id !== open?.id).length ?? 0
  // The page's state and tweaks, kept on the design it shows (agents-see-the-tweaks-you-picked decision 5).
  const frame = useRef<HTMLIFrameElement>(null)
  useDesignReport(frame, open?.id)

  const [wide, setWide] = useState(true)
  const stage = useRef<HTMLDivElement>(null)
  const [pane, setPane] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = stage.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPane({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [server.url, pass.reach])
  const size = frameSize(wide ? (open?.width ?? width ?? DEFAULT_PREVIEW_WIDTH) : 'fit', pane)
  // Approve is only ever on a design the human can see (decision 8).
  const showing = !!server.url && server.passPort !== undefined && pass.reach === 'reachable'

  return (
    <PhoneViewScreen
      title={open?.title ?? title}
      {...(sub ? { sub } : {})}
      onBack={onBack}
      trailing={
        server.url && (
          <>
            <Button variant="ghost" onClick={() => setWide(!wide)} aria-label={wide ? 'Show at the phone’s width' : 'Show at desktop width'}>
              {wide ? 'Desktop' : 'Phone'}
            </Button>
            {showing && open?.state === 'waiting' && (
              <Button variant="primary" icon={<IconCheck />} disabled={approving} onClick={() => approve(open)}>
                {othersWaiting > 0 ? 'Approve & next' : 'Approve'}
              </Button>
            )}
          </>
        )
      }
    >
      {server.url && server.passPort !== undefined && pass.reach !== 'reachable' ? (
        <PassCheck reach={pass.reach} passPort={server.passPort} onRetry={pass.retry} />
      ) : server.url && server.passPort !== undefined ? (
        <>
          <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden bg-surface-inset">
            <iframe
              ref={frame}
              title="The design"
              src={phoneDesignSrc(window.location, server.passPort, featureId, server.shownPath)}
              className="absolute top-0 left-0 origin-top-left border-0 bg-surface"
              style={{ width: size.width, height: size.height, transform: `scale(${size.scale})` }}
            />
          </div>
          <p className="m-0 shrink-0 border-t border-border-subtle bg-surface px-4 py-2.5 text-xs text-text-tertiary">
            Tap around it. Say what to change in the chat.
          </p>
        </>
      ) : (
        <DesignServerDown server={server} onRestart={() => server.restartServer()} />
      )}
    </PhoneViewScreen>
  )
}
