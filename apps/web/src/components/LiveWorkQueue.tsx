import { trpc } from '../trpc'
import { useLivePoll } from '../lib/live'
import type { WorkerKind } from '../lib/workers'
import { WorkQueue, type QueueEntry } from './WorkQueue'

/** One entry as `worker.queue` sends it (packages/server/src/workers/service.ts). */
export interface ServerQueueEntry {
  workerId: string
  label: string
  kind: string
  featureId: string | null
  featureSlug: string | null
  featureTitle: string | null
  projectId: string
  projectName: string
  since: number
  heldBy: string | null
}

/** A worker in the line, with the slug its feature's page opens by from another project. */
export type LiveQueueEntry = QueueEntry & { featureSlug: string | null }

/** The server's entry as the props-only {@link WorkQueue} draws it. */
export function toQueueEntry(e: ServerQueueEntry): LiveQueueEntry {
  return {
    id: e.workerId,
    label: e.label,
    kind: e.kind as WorkerKind,
    featureId: e.featureId,
    featureSlug: e.featureSlug,
    featureTitle: e.featureTitle,
    projectId: e.projectId,
    projectName: e.projectName,
    since: e.since,
    ...(e.heldBy ? { heldBy: e.heldBy } : {}),
  }
}

/**
 * The sidebar foot's line of workers (one-number-for-how-many-build-at-once
 * decision 8): `worker.queue`, machine-wide, drawn by {@link WorkQueue}. The
 * live `queue` signal refetches it; the poll is only the stream-down fallback.
 */
export function LiveWorkQueue({
  projectId,
  onOpen,
  onOpenSettings,
}: {
  /** The open project: the others' entries name theirs. */
  projectId: string
  onOpen: (entry: LiveQueueEntry) => void
  onOpenSettings: () => void
}) {
  const q = trpc.worker.queue.useQuery(undefined, { refetchInterval: useLivePoll() })
  if (!q.data) return null
  const working = q.data.working.map(toQueueEntry)
  const waiting = q.data.waiting.map(toQueueEntry)
  return (
    <WorkQueue
      limit={q.data.limit}
      working={working}
      waiting={waiting}
      currentProjectId={projectId}
      onOpen={(e) => onOpen(e as LiveQueueEntry)}
      onOpenSettings={onOpenSettings}
    />
  )
}
