/**
 * The live event stream at its edge, for rendering `App` (whose `useLiveSync`
 * opens `/api/stream`): a stream that opens and never sends, so nothing reaches
 * a server. Not even the server's `ready` handshake: the app answers that with
 * a full resync (lib/live.ts), which would refetch the data seeded into the
 * cache over a real `fetch`. So the app keeps reading the stream as connecting,
 * and its polls tick against the fakes, in the page.
 */
class SilentEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2
  readonly withCredentials = false
  readonly url: string
  readyState = SilentEventSource.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    setTimeout(() => {
      if (this.readyState === SilentEventSource.CLOSED) return
      this.readyState = SilentEventSource.OPEN
      const open = new Event('open')
      this.onopen?.(open)
      this.dispatchEvent(open)
    })
  }

  close(): void {
    this.readyState = SilentEventSource.CLOSED
  }
}

/** Replace the page's `EventSource` with the silent stand-in. */
export function installSilentEventSource(): void {
  // The stand-in's shape is EventSource's; the cast is only for its generic
  // listener overloads, which EventTarget's plain ones already accept.
  globalThis.EventSource = SilentEventSource as unknown as typeof EventSource
}
