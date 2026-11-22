/**
 * A worker's chat asked for from another project's shell (one-number-for-how-
 * many-build-at-once decision 8: the line lists every project's work). Entering
 * a project remounts its shell, which lands on the feature the address names;
 * this carries the worker across so the new shell brings its chat to the front.
 * In memory only: a reload lands on the feature alone. It lapses after a few
 * seconds, so a switch abandoned before it landed (Back pressed while the
 * project loads) cannot jump to that chat on a later visit.
 */
export interface PendingWorker {
  projectId: string
  featureId: string
  workerId: string
}

/** How long a request waits for its project to land. */
export const PENDING_WORKER_MS = 15_000

let pending: (PendingWorker & { at: number }) | null = null

export function setPendingWorker(next: PendingWorker, now: number = Date.now()): void {
  pending = { ...next, at: now }
}

/** The worker asked for in `projectId`, once and while fresh; any other project's request is left alone. */
export function takePendingWorker(projectId: string, now: number = Date.now()): PendingWorker | null {
  if (!pending || pending.projectId !== projectId) return null
  const { at, ...taken } = pending
  pending = null
  return now - at <= PENDING_WORKER_MS ? taken : null
}
