import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { type LiveSignal, subscribeLive } from '../services/bus'

/**
 * Live-update stream (`GET /api/stream`): server-sent events carrying the
 * `LiveSignal`s published on the in-process bus. This is what makes the UI
 * realtime — the web app invalidates the affected queries the instant a signal
 * lands rather than waiting for its next poll tick.
 *
 * Why SSE and not the existing WebSocket: this is one-way, it survives the
 * browser's background-tab timer throttling (which is what froze the polling
 * UI), and `EventSource` reconnects on its own — no client-side retry ladder to
 * maintain. The terminal keeps its WebSocket; that one is bidirectional.
 *
 * Signals are *hints*, never data. A client that misses some (asleep, dropped
 * connection, server restart) converges anyway: it refetches everything when
 * the stream reconnects, and the fallback polling never stopped.
 */
const stream = new Hono()

/**
 * Coalescing window. A burning agent appends transcript chunks per token, so
 * signals arrive far faster than any UI can use. Collapsing each flush to one
 * signal per dedupe key bounds the stream to a handful of messages a second
 * under full load while still feeling instantaneous.
 */
const FLUSH_MS = 120

/** Idle comment interval — keeps proxies from reaping the connection. */
const HEARTBEAT_MS = 25_000

/**
 * Signals that collapse onto each other. All event signals share one key: the
 * client re-reads through its own cursors, so it only needs to know that
 * *something* changed, not how many times.
 */
function dedupeKey(s: LiveSignal): string {
  return s.kind === 'transcript' ? `transcript:${s.ticketId}` : 'event'
}

stream.get('/', (c) =>
  streamSSE(c, async (sse) => {
    const pending = new Map<string, LiveSignal>()
    let done = false

    const stop = (): void => {
      done = true
    }
    const unsubscribe = subscribeLive((signal) => {
      pending.set(dedupeKey(signal), signal)
    })

    sse.onAbort(stop)
    // Belt and braces: `StreamingApi.write` swallows write errors, so a dead
    // socket is otherwise invisible and would leak this loop + its bus
    // subscription forever. The request signal aborts on client disconnect.
    c.req.raw.signal.addEventListener('abort', stop)

    try {
      // Tells the client the stream is up. It does a full refetch on this, so
      // reconnecting after a gap (server restart, laptop wake) resyncs
      // everything without a page reload.
      await sse.writeSSE({ event: 'ready', data: '{}' })

      let idleMs = 0
      while (!done && !sse.aborted && !sse.closed) {
        await sse.sleep(FLUSH_MS)
        if (done || sse.aborted || sse.closed) break

        if (pending.size === 0) {
          idleMs += FLUSH_MS
          if (idleMs >= HEARTBEAT_MS) {
            idleMs = 0
            await sse.writeSSE({ event: 'ping', data: '{}' })
          }
          continue
        }

        idleMs = 0
        const batch = [...pending.values()]
        pending.clear()
        for (const signal of batch) {
          await sse.writeSSE({ event: 'live', data: JSON.stringify(signal) })
        }
      }
    } finally {
      unsubscribe()
      c.req.raw.signal.removeEventListener('abort', stop)
    }
  }),
)

export default stream
