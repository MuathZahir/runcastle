import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { TerminalClient, type TerminalStatus } from '../lib/terminal'
import { mapTerminalKey } from '../lib/terminal-keys'

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
      // A reconnected socket replays the server's whole scrollback ring —
      // clear the stale screen first so nothing is duplicated.
      onReset: () => term.reset(),
      onStatus: (s) => {
        setStatus(s)
        // Sync the server PTY to our current grid once the socket is live (the
        // initial fit's resize may have fired before the socket opened).
        if (s === 'live') client.resize(term.cols, term.rows)
      },
    })

    const dataSub = term.onData((d) => client.send(d))
    const resizeSub = term.onResize(({ cols, rows }) => client.resize(cols, rows))

    // Modifier+Enter must insert a newline in the Claude prompt, not submit.
    // Stock xterm emits a bare `\r` for it; intercept and send ESC+CR instead
    // (return false so xterm doesn't also process the event — see terminal-keys).
    term.attachCustomKeyEventHandler((ev) => {
      const action = mapTerminalKey(ev)
      if (!action.intercept) return true
      if (action.bytes) client.send(action.bytes)
      return false
    })

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

  // Anything but `live` gets a full-width strip — the E2E run showed the socket
  // can die silently, so the down state must be unmissable (and it doubles as
  // the "your keystrokes are being dropped" notice).
  const strip: { text: string; tone: 'dim' | 'down' } | null =
    status === 'connecting'
      ? { text: 'connecting…', tone: 'dim' }
      : status === 'reconnecting'
        ? { text: 'disconnected — reconnecting… keystrokes are dropped until the stream is back', tone: 'down' }
        : status === 'ended'
          ? { text: 'session stream ended — relaunch or end the session above', tone: 'dim' }
          : null

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
      {strip && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
            fontSize: 11,
            padding: '4px 10px',
            pointerEvents: 'none',
            color: strip.tone === 'down' ? '#F4594E' : '#8B949E',
            background: strip.tone === 'down' ? 'rgba(244,89,78,0.10)' : 'rgba(14,17,22,0.85)',
            borderBottom: `1px solid ${strip.tone === 'down' ? 'rgba(244,89,78,0.4)' : '#1A2028'}`,
          }}
        >
          {strip.text}
        </div>
      )}
    </div>
  )
}
