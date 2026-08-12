import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PULSE_TIMEOUT_MS,
  getLiveStatus,
  livePollMs,
  startLiveSync,
  type LiveSyncHandlers,
} from '../src/lib/live'

/**
 * UI-state-management ticket 1 — the live stream's heartbeat watchdog.
 *
 * Tested at the live-status store seam: frames and silence are driven through a
 * stubbed `EventSource` (the only true system boundary here, alongside the clock
 * and the window's focus/online events) and the observable results are the
 * module status, the poll cadence that status picks, and which resyncs fired.
 */

type Listener = (ev: unknown) => void

/** One watchdog tick past the timeout is when the silence is acted on. */
const WATCHDOG_TICK = 5_000

/** Stand-in for the browser's `EventSource`; records what the client did to it. */
class StubEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: StubEventSource[] = []

  readyState = StubEventSource.CONNECTING
  closed = false
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(readonly url: string) {
    StubEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }

  close(): void {
    this.closed = true
    this.readyState = StubEventSource.CLOSED
  }

  /** Deliver a server frame. */
  emit(type: string, data = '{}'): void {
    this.readyState = StubEventSource.OPEN
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ data })
  }

  /** How many listeners are still attached — a released source has none. */
  listenerCount(): number {
    let n = 0
    for (const set of this.listeners.values()) n += set.size
    return n
  }
}

/** Minimal `window`/`document` stand-in that can dispatch the events we listen for. */
function makeEventHost() {
  const handlers = new Map<string, Set<Listener>>()
  return {
    visibilityState: 'visible',
    addEventListener(type: string, fn: Listener): void {
      const set = handlers.get(type) ?? new Set<Listener>()
      set.add(fn)
      handlers.set(type, set)
    },
    removeEventListener(type: string, fn: Listener): void {
      handlers.get(type)?.delete(fn)
    },
    dispatch(type: string): void {
      for (const fn of [...(handlers.get(type) ?? [])]) fn({ type })
    },
    listenerCount(): number {
      let n = 0
      for (const set of handlers.values()) n += set.size
      return n
    },
  }
}

const globals = globalThis as unknown as Record<string, unknown>
let windowStub: ReturnType<typeof makeEventHost>
let documentStub: ReturnType<typeof makeEventHost>
let handlers: { resyncAll: ReturnType<typeof vi.fn>; resyncTranscript: ReturnType<typeof vi.fn> }
let stop: () => void

/** The source the client is currently listening to. */
function current(): StubEventSource {
  const last = StubEventSource.instances.at(-1)
  if (!last) throw new Error('no EventSource was opened')
  return last
}

function start(): void {
  stop = startLiveSync(handlers as unknown as LiveSyncHandlers)
}

beforeEach(() => {
  vi.useFakeTimers()
  StubEventSource.instances = []
  windowStub = makeEventHost()
  documentStub = makeEventHost()
  globals.EventSource = StubEventSource
  globals.window = windowStub
  globals.document = documentStub
  handlers = { resyncAll: vi.fn(), resyncTranscript: vi.fn() }
  stop = () => {}
})

afterEach(() => {
  stop()
  vi.useRealTimers()
  delete globals.EventSource
  delete globals.window
  delete globals.document
})

describe('startLiveSync', () => {
  it('opens the stream and only reports live once a frame proves it', () => {
    start()
    expect(current().url).toBe('/api/stream')
    expect(getLiveStatus()).toBe('connecting')

    current().emit('ready')
    expect(getLiveStatus()).toBe('live')
    expect(handlers.resyncAll).toHaveBeenCalledTimes(1)
    expect(handlers.resyncTranscript).toHaveBeenCalledTimes(1)
  })

  it('keeps a quiet stream live — and its polls backed off — while pings arrive', () => {
    start()
    current().emit('ready')

    // Three heartbeat intervals of no news at all: each ping is a pulse, so the
    // watchdog never fires and the connection is never replaced.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(25_000)
      current().emit('ping')
    }

    expect(getLiveStatus()).toBe('live')
    expect(StubEventSource.instances).toHaveLength(1)
    expect(livePollMs(getLiveStatus())).toBe(30_000)
  })

  it('replaces a stream that goes silent past the pulse timeout', () => {
    start()
    const dead = current()
    dead.emit('ready')

    vi.advanceTimersByTime(PULSE_TIMEOUT_MS + WATCHDOG_TICK)

    expect(dead.closed).toBe(true)
    expect(dead.listenerCount()).toBe(0)
    expect(StubEventSource.instances).toHaveLength(2)
    expect(current()).not.toBe(dead)
    // Trust is gone the moment the connection is, which re-arms fast polling.
    expect(getLiveStatus()).toBe('connecting')
    expect(livePollMs(getLiveStatus())).toBe(1500)
  })

  it('resyncs everything on the replacement stream ready frame', () => {
    start()
    current().emit('ready')
    handlers.resyncAll.mockClear()
    handlers.resyncTranscript.mockClear()

    vi.advanceTimersByTime(PULSE_TIMEOUT_MS + WATCHDOG_TICK)
    current().emit('ready')

    expect(getLiveStatus()).toBe('live')
    expect(handlers.resyncAll).toHaveBeenCalledTimes(1)
    expect(handlers.resyncTranscript).toHaveBeenCalledTimes(1)
  })

  it('does not replace a stream whose pulse is still recent', () => {
    start()
    current().emit('ready')

    vi.advanceTimersByTime(PULSE_TIMEOUT_MS - 1000)

    expect(StubEventSource.instances).toHaveLength(1)
    expect(getLiveStatus()).toBe('live')
  })

  it.each(['focus', 'online'])(
    'reconnects immediately on window %s when the pulse is stale',
    (event) => {
      start()
      const dead = current()
      dead.emit('ready')

      // A backgrounded tab's timers are throttled or suspended, so the silence
      // is only noticed on the way back in — before the next watchdog tick.
      vi.setSystemTime(Date.now() + PULSE_TIMEOUT_MS + 1000)
      windowStub.dispatch(event)

      expect(dead.closed).toBe(true)
      expect(StubEventSource.instances).toHaveLength(2)
      expect(getLiveStatus()).toBe('connecting')
    },
  )

  it('reconnects when the tab becomes visible again with a stale pulse', () => {
    start()
    current().emit('ready')

    vi.setSystemTime(Date.now() + PULSE_TIMEOUT_MS + 1000)
    documentStub.dispatch('visibilitychange')

    expect(StubEventSource.instances).toHaveLength(2)
  })

  it('leaves a healthy stream alone on focus', () => {
    start()
    current().emit('ready')

    windowStub.dispatch('focus')

    expect(StubEventSource.instances).toHaveLength(1)
    expect(getLiveStatus()).toBe('live')
  })

  it('routes a transcript signal to the transcript resync only', () => {
    start()
    current().emit('ready')
    handlers.resyncAll.mockClear()
    handlers.resyncTranscript.mockClear()

    current().emit('live', JSON.stringify({ kind: 'transcript', ticketId: 't1' }))

    expect(handlers.resyncTranscript).toHaveBeenCalledTimes(1)
    expect(handlers.resyncAll).not.toHaveBeenCalled()
  })

  it('releases the stream, its timers and its window listeners on dispose', () => {
    start()
    const source = current()
    source.emit('ready')

    stop()

    expect(source.closed).toBe(true)
    expect(getLiveStatus()).toBe('connecting')
    expect(windowStub.listenerCount()).toBe(0)
    expect(documentStub.listenerCount()).toBe(0)

    // No watchdog left running: a disposed sync never opens another stream.
    vi.advanceTimersByTime(PULSE_TIMEOUT_MS * 2)
    expect(StubEventSource.instances).toHaveLength(1)
  })
})
