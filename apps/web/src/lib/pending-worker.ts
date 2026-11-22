/**
 * A worker's chat asked for from another project's shell (one-number-for-how-
 * many-build-at-once decision 8: the line lists every project's work). Entering
 * a project remounts its shell, which lands on the feature the address names;
 * this carries the worker across so the new shell brings its chat to the front.
 * In memory only: a reload lands on the feature alone.
 */
export interface PendingWorker {
  projectId: string
  featureId: string
  workerId: string
}

let pending: PendingWorker | null = null

export function setPendingWorker(next: PendingWorker): void {
  pending = next
}

/** The worker asked for in `projectId`, once; any other project's request is left alone. */
export function takePendingWorker(projectId: string): PendingWorker | null {
  if (!pending || pending.projectId !== projectId) return null
  const taken = pending
  pending = null
  return taken
}
