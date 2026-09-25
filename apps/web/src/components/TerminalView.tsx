import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { TerminalClient, terminalTheme, type TerminalStatus } from '../lib/terminal'
import { mapTerminalKey } from '../lib/terminal-keys'
import { useTheme } from '../lib/theme'
import { cx } from '../ui'

/**
 * Embedded terminal view (UI-SPEC §5). Renders a live Claude Code session over
 * the `/ws/terminal/:sessionId` PTY stream using `@xterm/xterm` + the fit addon.
 * Props are pinned (`{ sessionId, wsBase? }`) — W2 mounts this via
 * `components/TerminalView` and must not depend on anything else.
 *
 * It sits on the `surface-inset` ground and its palette is the design tokens'
 * ({@link terminalTheme}): ink `text`, cursor `accent`, selection
 * `accent-subtle`, the status hues as ANSI red/green/yellow/blue — re-read and
 * re-applied whenever the painted theme flips, so the terminal follows dark and
 * light live. Set in Geist Mono, the app's code face.
 */
export interface TerminalViewProps {
  sessionId: string
  wsBase?: string
  /**
   * The server reported the PTY's process gone — whatever its exit code. Held in
   * a ref so a caller passing an inline closure does not tear the terminal down
   * and reconnect on every render.
   */
  onEnded?: () => void
}

const FONT = '"Geist Mono Variable", "Cascadia Code", Consolas, monospace'

export function TerminalView({ sessionId, wsBase, onEnded }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const endedRef = useRef(onEnded)
  endedRef.current = onEnded
  const { resolved } = useTheme()
  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved
  const termRef = useRef<Terminal | null>(null)

  // The palette follows the painted theme without tearing the session down.
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = terminalTheme(resolved)
  }, [resolved])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      theme: terminalTheme(resolvedRef.current),
      fontFamily: FONT,
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    })
    termRef.current = term
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

    // xterm measures its cell once, at open. If Geist Mono was still loading
    // then, it measured the fallback face — re-set the family once the font is
    // in, so the grid is re-measured on the face it actually draws.
    let disposed = false
    const monoReady = typeof document !== 'undefined' && document.fonts?.check?.(`12px ${FONT}`)
    if (!monoReady) {
      void document.fonts?.load(`12px ${FONT}`).then(() => {
        if (disposed) return
        term.options.fontFamily = 'monospace'
        term.options.fontFamily = FONT
        doFit()
      })
    }

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
        // `ended` is terminal — the client stops reconnecting — so this fires
        // at most once per session.
        if (s === 'ended') endedRef.current?.()
      },
    })

    const dataSub = term.onData((d) => client.send(d))
    const resizeSub = term.onResize(({ cols, rows }) => client.resize(cols, rows))

    // Modifier+Enter must insert a newline in the Claude prompt rather than
    // submit, Ctrl+V must paste, and Alt+V must reach Claude Code's image paste
    // — stock xterm gets all three wrong (see terminal-keys for the whys).
    // Returning false stops xterm processing the event WITHOUT cancelling it,
    // which is what leaves the browser free to fire its own paste on Ctrl+V.
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
      disposed = true
      termRef.current = null
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
      ? { text: 'Connecting…', tone: 'dim' }
      : status === 'reconnecting'
        ? { text: 'Disconnected — reconnecting… keystrokes are dropped until the stream is back', tone: 'down' }
        : status === 'ended'
          ? { text: 'Session stream ended — relaunch or end the session above', tone: 'dim' }
          : null

  return (
    <div
      className={cx(
        'relative box-border h-full w-full overflow-hidden bg-surface-inset pt-2 pr-0.5 pb-1.5 pl-2.5',
        // xterm.css paints its viewport black (and, unlayered, beats a plain
        // utility); the ground is ours, so the viewport lets it through.
        '[&_.xterm-viewport]:bg-transparent!',
      )}
    >
      <div ref={containerRef} className="h-full w-full" data-session-id={sessionId} />
      {strip && (
        <div
          role="status"
          className={cx(
            'pointer-events-none absolute inset-x-0 top-0 px-2.5 py-1 text-xs animate-fade-in',
            strip.tone === 'down'
              ? 'bg-danger-subtle text-danger'
              : 'border-b border-border-subtle bg-surface-inset text-text-tertiary',
          )}
        >
          {strip.text}
        </div>
      )}
    </div>
  )
}
