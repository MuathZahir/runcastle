/**
 * WebSocket client for the embedded terminal (UI-SPEC §5). Talks the symmetric
 * framing the server (`packages/server/src/pty/ws.ts`) speaks:
 * - **data** frames are binary — PTY output arrives as an `ArrayBuffer`, and
 *   keystrokes are sent as bytes.
 * - **control** frames are text JSON — `{t:'status',status,exitCode?}` inbound,
 *   `{t:'resize',cols,rows}` outbound.
 *
 * Handles reconnect with exponential backoff. When the server reports the
 * session `ended`, reconnection stops (the PTY is gone — a new session gets a new
 * id). `TerminalView` renders the status as the dim `reconnecting…` overlay.
 */

export type TerminalStatus = 'connecting' | 'live' | 'reconnecting' | 'ended'

export interface TerminalClientOptions {
  sessionId: string
  /** WS origin, e.g. `ws://localhost:4512`. Defaults to the runcastle server (4512). */
  wsBase?: string
  onData: (bytes: Uint8Array) => void
  onStatus: (status: TerminalStatus) => void
}

const BACKOFF_MIN = 250
const BACKOFF_MAX = 5000

/** Default WS origin: the runcastle server on 4512 (SPEC §0), same host. */
function defaultWsBase(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.hostname}:4512`
}

export class TerminalClient {
  private ws: WebSocket | null = null
  private backoff = BACKOFF_MIN
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private ended = false
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

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.handleControl(ev.data)
      } else {
        this.opts.onData(new Uint8Array(ev.data as ArrayBuffer))
      }
    }

    ws.onclose = () => {
      this.ws = null
      if (this.disposed || this.ended) return
      this.opts.onStatus('reconnecting')
      this.scheduleReconnect()
    }

    // Errors surface as a close; let onclose drive the reconnect.
    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        // already closing
      }
    }
  }

  /** Send keystroke data to the PTY (binary frame). */
  send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(new TextEncoder().encode(data))
    }
  }

  /** Send a resize control frame (text JSON). */
  resize(cols: number, rows: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'resize', cols, rows }))
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    if (this.ws) {
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
}
