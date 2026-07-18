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
