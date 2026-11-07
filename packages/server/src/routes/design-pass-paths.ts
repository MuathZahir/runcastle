/**
 * The design pass-through's addresses (`routes/design-pass.ts`), apart from
 * the listener itself so code the web's typecheck reads (the worker service,
 * the tRPC routers) can name them without Bun's server types.
 */

/** The entry path's prefix; the feature id, or `worker/<workerId>`, follows it. */
export const DESIGN_OPEN_PREFIX = '/__runcastle/open/'

/** What follows {@link DESIGN_OPEN_PREFIX} for a worker's preview. */
export const WORKER_OPEN_SEGMENT = 'worker/'

/** The pass-through's entry path for a worker's preview (interactive-workers decision 15); the web puts the listener's origin in front. */
export function workerPreviewPath(workerId: string): string {
  return `${DESIGN_OPEN_PREFIX}${WORKER_OPEN_SEGMENT}${encodeURIComponent(workerId)}`
}

/**
 * A worker's preview, addressed by worker id: the published port it forwards
 * to, and the wake a stopped worker's sandbox needs before a request goes there.
 */
export interface WorkerPreviews {
  /** The worker's preview address on the host's loopback, or undefined when it has none. */
  url(workerId: string): string | undefined
  /** Start a stopped worker's sandbox and dev server, not its agent. */
  wake(workerId: string): Promise<void>
}
