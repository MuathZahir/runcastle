import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { TerminalClient, type TerminalStatus } from '../lib/terminal'

/**
 * Embedded terminal view (UI-SPEC §5). Renders a live Claude Code session over
 * the `/ws/terminal/:sessionId` PTY stream using `@xterm/xterm` + the fit addon.
 * Props are pinned (`{ sessionId, wsBase? }`) — W2 mounts this via
 * `components/TerminalView` and must not depend on anything else.
 *
 * Self-styled via inline styles (no external CSS class dependency) so it renders
 * correctly regardless of the surrounding shell stylesheet W2 owns. The terminal
 * background is #0A0C0F to match the app bg exactly (reads as native, not iframe).
 */
export interface TerminalViewProps {
  sessionId: string
  wsBase?: string
}

const THEME = {
  background: '#0A0C0F',
  foreground: '#C9D1D9',
  cursor: '#8B5CF6',
  cursorAccent: '#0A0C0F',
  selectionBackground: 'rgba(139,92,246,0.25)',
}

export function TerminalView({ sessionId, wsBase }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TerminalStatus>('connecting')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      theme: THEME,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    const doFit = (): void => {
      try {
        fit.fit()
      } catch {
        // container not laid out yet — the ResizeObserver will re-fit.
      }
    }
    doFit()
    const raf = requestAnimationFrame(doFit)

    let client: TerminalClient
    client = new TerminalClient({
      sessionId,
      wsBase,
      onData: (bytes) => term.write(bytes),
      onStatus: (s) => {
        setStatus(s)
        // Sync the server PTY to our current grid once the socket is live (the
        // initial fit's resize may have fired before the socket opened).
        if (s === 'live') client.resize(term.cols, term.rows)
      },
    })

    const dataSub = term.onData((d) => client.send(d))
    const resizeSub = term.onResize(({ cols, rows }) => client.resize(cols, rows))

    client.connect()

    const ro = new ResizeObserver(() => doFit())
    ro.observe(container)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      client.dispose()
      term.dispose()
    }
  }, [sessionId, wsBase])

  const showOverlay = status === 'connecting' || status === 'reconnecting'

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#0A0C0F',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-session-id={sessionId} />
      {showOverlay && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
            fontSize: 11,
            color: '#8B949E',
            background: 'rgba(14,17,22,0.85)',
            border: '1px solid #1A2028',
            borderRadius: 4,
            padding: '2px 8px',
            pointerEvents: 'none',
          }}
        >
          reconnecting…
        </div>
      )}
    </div>
  )
}
