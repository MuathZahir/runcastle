/**
 * The per-feature landing queue: everything that merges onto `feature/<slug>`
 * goes through one serial order (ADR-0002 §2, widened).
 *
 * The burner used to create this queue per RUN, which was enough while the run
 * was the only writer — but the feature chat commits its docs while a burn is in
 * flight (`one-chat-per-feature` decision 2), so chat landings and ticket
 * landings now share one target ref. The queue guards a per-FEATURE resource,
 * so it is keyed by feature id and lives for the process, not for the run.
 */

/** Submit a task; it runs once every task submitted before it has settled. */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>

/**
 * A promise-chain serializer: tasks run strictly one at a time in submission
 * order. A rejection propagates to ITS submitter only — the chain itself never
 * breaks, so later tasks still run.
 */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task)
    // Keep the chain alive past a rejection; the submitter still sees it via `next`.
    tail = next.catch(() => undefined)
    return next
  }
}

/**
 * One queue per feature, created on first use. Entries are never dropped: a
 * queue is a closure over one promise, the number of features a server has ever
 * landed for is small, and forgetting one mid-run would hand a second caller a
 * fresh chain that merges in parallel with the first — the exact race this
 * exists to prevent.
 */
const queues = new Map<string, SerialQueue>()

/** The serial queue every merge onto this feature's branch must run through. */
export function featureLandingQueue(featureId: string): SerialQueue {
  let queue = queues.get(featureId)
  if (!queue) {
    queue = createSerialQueue()
    queues.set(featureId, queue)
  }
  return queue
}
