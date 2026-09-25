/**
 * WebSocket client for the embedded terminal (UI-SPEC §5). Talks the symmetric
 * framing the server (`packages/server/src/pty/ws.ts`) speaks:
 * - **data** frames are binary — PTY output arrives as an `ArrayBuffer`, and
 *   keystrokes are sent as bytes.
 * - **control** frames are text JSON — `{t:'status',status,exitCode?}` inbound,
 *   `{t:'resize',cols,rows}` outbound.
 *
 * Handles reconnect with capped exponential backoff on close AND on the two
 * silent-loss modes the E2E run hit: a socket that never finishes its handshake
 * (connect timeout) and a half-open socket that stays `OPEN` while the peer is
 * gone — detected by outbound bytes stalling in `bufferedAmount` after a send,
 * then force-closed so the normal reconnect path takes over. Keystrokes are
 * dropped (never queued) unless the socket is verifiably open; the view renders
 * the disconnected state so that drop is obvious. On reconnect the server
 * replays its scrollback ring, so `onReset` fires first to clear the stale
 * screen. When the server reports the session `ended`, reconnection stops (the
 * PTY is gone — a new session gets a new id).
 */

export type TerminalStatus = 'connecting' | 'live' | 'reconnecting' | 'ended'

export interface TerminalClientOptions {
  sessionId: string
  /** WS origin, e.g. `ws://localhost:4512`. Defaults to the page's own origin. */
  wsBase?: string
  onData: (bytes: Uint8Array) => void
  onStatus: (status: TerminalStatus) => void
  /**
   * Fired when a RE-connected socket opens, before any replayed data arrives —
   * the view clears its screen here so the server's scrollback replay doesn't
   * duplicate what's already rendered.
   */
  onReset?: () => void
}

const BACKOFF_MIN = 250
const BACKOFF_MAX = 5000
/** Give a handshake this long before treating the attempt as dead. */
const CONNECT_TIMEOUT = 8000
/** Outbound bytes still buffered this long after a send ⇒ half-open socket. */
const STALL_TIMEOUT = 3000

/**
 * WS origin for a page location. Derives host+port from the page rather than
 * hardcoding 4512 so the terminal works from whatever port the app is served on:
 * in production the server serves the SPA and the WS from one origin (any port);
 * in dev Vite (4513) proxies `/ws` to the server. `location.host` carries the
 * port, so a non-default server port just works.
 */
export function wsBaseFrom(loc: Pick<Location, 'protocol' | 'host'>): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${loc.host}`
}

function defaultWsBase(): string {
  return wsBaseFrom(window.location)
}

export class TerminalClient {
  private ws: WebSocket | null = null
  private backoff = BACKOFF_MIN
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private ended = false
  /** A previous socket delivered data — a fresh open must reset before replay. */
  private receivedData = false
  private readonly url: string

  constructor(private readonly opts: TerminalClientOptions) {
    const base = opts.wsBase ?? defaultWsBase()
    this.url = `${base.replace(/\/$/, '')}/ws/terminal/${encodeURIComponent(opts.sessionId)}`
  }

  connect(): void {
    if (this.disposed || this.ended) return
    this.clearTimer()
    this.opts.onStatus(this.backoff === BACKOFF_MIN ? 'connecting' : 'reconnecting')

    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    // A handshake that hangs (server mid-restart, dead route) never fires
    // onclose by itself in a useful timeframe — force it so backoff continues.
    this.connectTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) this.forceClose(ws)
    }, CONNECT_TIMEOUT)

    ws.onopen = () => {
      this.clearConnectTimer()
      // Reconnected: the server will replay its whole scrollback ring — clear
      // the stale screen first so output isn't duplicated.
      if (this.receivedData) {
        this.receivedData = false
        this.opts.onReset?.()
      }
    }

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.handleControl(ev.data)
      } else {
        this.receivedData = true
        this.opts.onData(new Uint8Array(ev.data as ArrayBuffer))
      }
    }

    ws.onclose = () => {
      this.ws = null
      this.clearConnectTimer()
      this.clearStallTimer()
      if (this.disposed || this.ended) return
      this.opts.onStatus('reconnecting')
      this.scheduleReconnect()
    }

    // Errors surface as a close; let onclose drive the reconnect.
    ws.onerror = () => {
      this.forceClose(ws)
    }
  }

  /**
   * Send keystroke data to the PTY (binary frame). Dropped — never queued —
   * unless the socket is open; a send that then stalls in `bufferedAmount`
   * marks the socket half-open and force-closes it into the reconnect path.
   */
  send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(new TextEncoder().encode(data))
      this.watchForStall()
    }
  }

  /** Send a resize control frame (text JSON). */
  resize(cols: number, rows: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'resize', cols, rows }))
      this.watchForStall()
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.clearConnectTimer()
    this.clearStallTimer()
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
  }

  private handleControl(raw: string): void {
    let frame: { t?: string; status?: string }
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    if (frame.t !== 'status') return
    if (frame.status === 'live') {
      this.backoff = BACKOFF_MIN
      this.opts.onStatus('live')
    } else if (frame.status === 'ended') {
      this.ended = true
      this.opts.onStatus('ended')
    }
  }

  /**
   * Half-open detection: after an outbound frame, the bytes should drain to
   * the kernel almost instantly. If they are still buffered `STALL_TIMEOUT`
   * later the peer is gone without a close frame (server hard-restart, network
   * drop) — force-close so onclose schedules the reconnect. One pending check
   * at a time is enough; it re-arms itself while bytes remain.
   */
  private watchForStall(): void {
    if (this.stallTimer !== null) return
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (ws.bufferedAmount > 0) this.forceClose(ws)
    }, STALL_TIMEOUT)
  }

  private forceClose(ws: WebSocket): void {
    try {
      ws.close()
    } catch {
      // already closing
    }
    // Some agents fire neither onerror-close nor onclose for an aborted
    // CONNECTING socket — drive the reconnect path by hand if it's ours.
    if (this.ws === ws && ws.readyState === WebSocket.CLOSED) {
      ws.onclose = null
      this.ws = null
      if (this.disposed || this.ended) return
      this.opts.onStatus('reconnecting')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.clearTimer()
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX)
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer)
      this.stallTimer = null
    }
  }
}

// --- the terminal's colours ---------------------------------------------------

/** The subset of xterm's `ITheme` the embedded terminal sets. */
export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionInactiveBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

type Resolved = 'dark' | 'light'

/**
 * The design-system tokens the terminal wears, and what each falls back to
 * where no stylesheet is loaded (tests, a detached document). The fallbacks are
 * `theme.css`'s own values, restated only so a missing sheet never paints the
 * terminal black-on-black.
 */
const TOKEN_FALLBACK: Record<Resolved, Record<string, string>> = {
  dark: {
    '--color-surface-inset': '#0c0e14',
    '--color-text': '#eceef4',
    '--color-accent': '#4f8ef7',
    '--color-accent-subtle': '#16213a',
    '--color-surface-selected': '#212636',
    '--color-danger': '#f06363',
    '--color-success': '#46b67a',
    '--color-warning': '#e2a53b',
    '--color-accent-text': '#7aaafa',
  },
  light: {
    '--color-surface-inset': '#f4f6f9',
    '--color-text': '#161a24',
    '--color-accent': '#2f6fe4',
    '--color-accent-subtle': '#ecf2fe',
    '--color-surface-selected': '#e4e8f1',
    '--color-danger': '#c42828',
    '--color-success': '#1e8e53',
    '--color-warning': '#a86a06',
    '--color-accent-text': '#2463d6',
  },
}

/**
 * The ANSI colours the tokens have no name for, tuned per theme so an agent's
 * dim text, diffs and prompts stay readable on the inset ground: on light, the
 * "white" slots are dark greys (a CLI that prints white-on-default would
 * otherwise vanish) and every hue is deep enough for 4.5:1.
 */
const ANSI_EXTRA: Record<Resolved, Pick<TerminalTheme, 'black' | 'magenta' | 'cyan' | 'white' | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightMagenta' | 'brightCyan' | 'brightWhite'>> = {
  dark: {
    black: '#2a2a2f',
    magenta: '#c68af0',
    cyan: '#56c2d6',
    white: '#d4d4d8',
    brightBlack: '#6b6b74',
    brightRed: '#ff8a8a',
    brightGreen: '#72d49c',
    brightYellow: '#f2c46e',
    brightMagenta: '#d9a9f7',
    brightCyan: '#86dbe8',
    brightWhite: '#fafafa',
  },
  light: {
    black: '#18181b',
    magenta: '#9337be',
    cyan: '#0e7488',
    white: '#52525b',
    brightBlack: '#71717a',
    brightRed: '#d63a3a',
    brightGreen: '#1f9a5a',
    brightYellow: '#b57308',
    brightMagenta: '#a64ccf',
    brightCyan: '#128399',
    brightWhite: '#27272a',
  },
}

/** A token's live value on `<html>`, or its fallback. */
function tokenReader(resolved: Resolved): (name: string) => string {
  const style =
    typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
  return (name) => style?.getPropertyValue(name).trim() || TOKEN_FALLBACK[resolved][name] || ''
}

/**
 * The xterm palette for the painted theme, derived from the design tokens:
 * ground `surface-inset`, ink `text`, cursor `accent`, selection
 * `accent-subtle`, and the four status hues as red/green/yellow/blue. Read at
 * call time, so calling it again after `<html data-theme>` flips re-themes a
 * live terminal.
 */
export function terminalTheme(resolved: Resolved, read = tokenReader(resolved)): TerminalTheme {
  const ground = read('--color-surface-inset')
  return {
    background: ground,
    foreground: read('--color-text'),
    cursor: read('--color-accent'),
    cursorAccent: ground,
    selectionBackground: read('--color-accent-subtle'),
    selectionInactiveBackground: read('--color-surface-selected'),
    red: read('--color-danger'),
    green: read('--color-success'),
    yellow: read('--color-warning'),
    blue: read('--color-accent'),
    brightBlue: read('--color-accent-text'),
    ...ANSI_EXTRA[resolved],
  }
}
