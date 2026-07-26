/**
 * In-process live-update bus — the push side of the UI's data flow.
 *
 * Every mutating service function already emits a timeline event (SPEC §12);
 * this bus turns that emit into a *notification* so the web app learns about it
 * the moment it happens instead of on the next poll tick. `routes/stream.ts`
 * fans the signals out to browsers over SSE.
 *
 * Deliberately dumb and IO-free: a `Set` of callbacks in the server process.
 * There is exactly one runcastle server per machine, so there is nothing to
 * coordinate across processes. Signals carry *what changed*, never the changed
 * data — the client re-reads through the normal tRPC procedures, so there is
 * one source of truth and no cache-coherence problem to get wrong.
 *
 * A signal is a hint, not a guarantee. Anything that drops one (a disconnected
 * stream, a browser asleep) still converges via the client's fallback polling
 * and its refetch-on-focus. That is why publishing can never throw: a broken
 * subscriber must not break the service call that emitted the event.
 */

/** What changed. `kind` is the client's invalidation switch. */
export type LiveSignal =
  | {
      kind: 'event'
      /** Project the event belongs to. */
      projectId: string
      /** Feature it was scoped to, absent for project-level events. */
      featureId?: string
      /** `events.id` of the row — monotonic, useful for debugging/ordering. */
      eventId: number
    }
  | {
      kind: 'transcript'
      /** Ticket whose in-memory agent transcript grew or changed state. */
      ticketId: string
    }

type Subscriber = (signal: LiveSignal) => void

const subscribers = new Set<Subscriber>()

/** Register a listener; call the returned function to detach it. */
export function subscribeLive(fn: Subscriber): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/**
 * Notify every subscriber. Never throws — a subscriber that blows up is
 * isolated and logged, because callers are mid-mutation and a failed
 * notification must not roll back real work.
 */
export function publishLive(signal: LiveSignal): void {
  // Snapshot: a subscriber may unsubscribe itself while being notified.
  for (const fn of [...subscribers]) {
    try {
      fn(signal)
    } catch (err) {
      console.error('live bus subscriber threw', err)
    }
  }
}

/** Number of attached subscribers — for tests and the health endpoint. */
export function liveSubscriberCount(): number {
  return subscribers.size
}
