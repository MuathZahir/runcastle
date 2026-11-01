import { useEffect, useRef, useState } from 'react'
import { trpc } from '../../trpc'
import { DEFAULT_PREVIEW_WIDTH, frameSize } from '../../lib/preview-width'
import { Button } from '../../ui'
import { designFrameUrl, DesignServerDown, useDesignServer } from '../design/DesignView'
import { PhoneViewScreen } from './PhoneChatBar'

/**
 * Where the phone's frame loads the design: through the pass-through's entry
 * path when the app itself is open on the phone link's machine, so the frame is
 * same-site and gets its cookie; else, on plain localhost at phone width, the
 * design server directly, as the desktop does.
 */
export function phoneDesignSrc(
  serverUrl: string,
  path: string | undefined,
  featureId: string,
  designUrl: string | undefined,
  pageHost: string,
): string {
  if (designUrl && new URL(designUrl).hostname === pageHost) {
    return `${designUrl}/__runcastle/open/${encodeURIComponent(featureId)}?path=${encodeURIComponent(path ?? '/')}`
  }
  return designFrameUrl(serverUrl, path)
}

/**
 * A feature's Design on the phone (docs/features/runcastle-on-your-phone
 * decision 5): its real page, tappable and updating as the agent changes it,
 * laid out at the width it was designed for and scaled to the phone, or at the
 * phone's own. No Select area: the human says what to change in the chat.
 * The server is held as the desktop view holds it — started from its recorded
 * command, kept alive by heartbeat.
 */
export function PhoneDesignView({
  featureId,
  path,
  width,
  title,
  sub,
  onBack,
}: {
  featureId: string
  path?: string
  /** The screen width `show_panel` asked for; Desktop is 1440 without one. */
  width?: number
  title: string
  sub?: string
  onBack: () => void
}) {
  const server = useDesignServer(featureId, path)
  const link = trpc.phoneLink.status.useQuery(undefined, { refetchOnWindowFocus: false })
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
  }, [server.url])
  const size = frameSize(wide ? (width ?? DEFAULT_PREVIEW_WIDTH) : 'fit', pane)

  return (
    <PhoneViewScreen
      title={title}
      {...(sub ? { sub } : {})}
      onBack={onBack}
      trailing={
        server.url && (
          <Button variant="ghost" onClick={() => setWide(!wide)} aria-label={wide ? 'Show at the phone’s width' : 'Show at desktop width'}>
            {wide ? 'Desktop' : 'Phone'}
          </Button>
        )
      }
    >
      {server.url ? (
        <>
          <div ref={stage} className="relative min-h-0 flex-1 overflow-hidden bg-surface-inset">
            <iframe
              title="The design"
              src={phoneDesignSrc(server.url, server.shownPath, featureId, link.data?.designUrl, window.location.hostname)}
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
