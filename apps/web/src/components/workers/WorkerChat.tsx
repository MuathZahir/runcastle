import type { ReactNode } from 'react'
import type { WorkerListRow } from '../../lib/api'
import type { ThreadEntry } from '../../lib/chat-thread'
import { workerPreviewAddress } from '../../lib/design-address'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { useThreadActions } from '../../lib/use-thread'
import { workerAssignment, workerCanHandBack } from '../../lib/workers'
import { trpc } from '../../trpc'
import { IconAlert, IconBranch, IconDoc, IconGitMerge, IconX } from '../../icons'
import { copyText } from '../workspace/copy-text'
import type { FeatureAction } from '../FeatureActionsMenu'
import { AssignmentCard, HandedBackLine, OldSideChatNote, WorkerClosedNote, WorkerHeaderActions, WorkerStatusLine } from './WorkerParts'

/**
 * A worker's chat on the feature page (interactive-workers decisions 5, 15,
 * 21, 23), wired to `worker.list`: what the chat column shows around a
 * worker's thread (its assignment card, the line it ends on, what stands in for
 * the composer once it takes no messages) and what the page's header shows for
 * it (its status, Open preview, Hand back). An old side chat is a read-only
 * transcript.
 */

/** What thread is in front, as far as workers go: a worker, an old side chat, or neither. */
export type WorkerInFront = { kind: 'worker'; row: WorkerListRow } | { kind: 'old-side-chat'; thread: ThreadEntry } | null

/** The feature's workers, read once per page; every `worker.*` event invalidates them (lib/live.ts). */
export function useFeatureWorkers(featureId: string): WorkerListRow[] {
  return trpc.worker.list.useQuery({ featureId }, { refetchInterval: useLivePoll() }).data ?? []
}

/** Which worker, if any, the thread in front is. */
export function workerInFront(rows: readonly WorkerListRow[], threads: readonly ThreadEntry[], current: string | null): WorkerInFront {
  if (current === null) return null
  const row = rows.find((w) => w.id === current)
  if (row) return { kind: 'worker', row }
  const thread = threads.find((t) => t.id === current)
  return thread?.role === 'side' ? { kind: 'old-side-chat', thread } : null
}

const WORKER_HINT = 'A worker in its own sandbox, on its own branch off the feature. It hands its work back to the lead.'

/** What the chat column wears for a worker's thread, as `ThreadColumn` props. */
export function workerColumnProps(
  w: NonNullable<WorkerInFront>,
  featureBranch: string,
): { head?: ReactNode; tail?: ReactNode; closed?: ReactNode; meta?: string; placeholder?: string; emptyHint: string } {
  if (w.kind === 'old-side-chat') return { closed: <OldSideChatNote />, emptyHint: 'An old side chat, from before workers.' }
  const row = w.row
  const head = <AssignmentCard assignment={workerAssignment(row)} />
  const handedBack =
    row.status === 'handed-back' ? (
      <div className="mt-7">
        <HandedBackLine commits={row.handbackCommits?.length ?? 0} files={row.handbackFiles?.length ?? 0} />
      </div>
    ) : undefined
  const closed =
    row.status === 'failed' ? (
      <WorkerClosedNote
        icon={<IconAlert className="text-danger" />}
        title="This worker failed"
        hint="Its lead was told once, and retries it, drops it or does the job itself."
      />
    ) : row.status === 'landed' ? (
      <WorkerClosedNote icon={<IconGitMerge />} title="This worker’s work landed" hint={`It is on ${featureBranch} now. To carry on, start a worker with “+”.`} />
    ) : row.status === 'dropped' ? (
      <WorkerClosedNote icon={<IconX />} title="This worker was dropped" hint="Its sandbox and branch were removed." />
    ) : undefined
  return {
    head,
    emptyHint: WORKER_HINT,
    ...(handedBack ? { tail: handedBack } : {}),
    ...(closed
      ? { closed }
      : {
          meta: `Sandbox · its own branch off ${featureBranch}`,
          placeholder: row.status === 'handed-back' ? 'Message the worker — the lead has its handback' : 'Message the worker',
        }),
  }
}

/**
 * The page header's status and actions while a worker's chat is in front, in
 * place of the feature's own: its status, Open preview while it has one,
 * Hand back while it can, and its "…" (its branch, Export).
 */
export function useWorkerHeader(w: WorkerInFront): { status: ReactNode; actions: ReactNode } | null {
  const toast = useToast()
  const utils = trpc.useUtils()
  const threadActions = useThreadActions()
  const handBack = trpc.worker.handBack.useMutation({
    onSuccess: () => void utils.worker.list.invalidate(),
    onError: (e) => toast.push(e.message),
  })
  if (!w) return null
  if (w.kind === 'old-side-chat') {
    return {
      status: <WorkerStatusLine status="handed-back" oldSideChat />,
      actions: (
        <WorkerHeaderActions
          menu={[{ key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: () => threadActions.exportMarkdown(w.thread.id, w.thread.title) }]}
        />
      ),
    }
  }
  const row = w.row
  const settled = row.status === 'landed' || row.status === 'dropped'
  const menu: FeatureAction[] = [
    ...(row.branch && !settled ? [{ key: 'copy-branch', label: 'Copy branch name', icon: <IconBranch />, onSelect: () => copyText(row.branch!, toast) }] : []),
    { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: () => threadActions.exportMarkdown(row.id, row.label) },
  ]
  const previewPath = row.previewPath
  const previews = previewPath !== null && !settled && row.status !== 'failed'
  return {
    status: <WorkerStatusLine status={row.status} {...(row.status === 'failed' && row.failure ? { why: row.failure } : {})} />,
    actions: (
      <WorkerHeaderActions
        {...(previews ? { onOpenPreview: () => window.open(workerPreviewAddress(window.location, row.passPort, previewPath), '_blank', 'noopener') } : {})}
        {...(workerCanHandBack(row.status) ? { onHandBack: () => handBack.mutate({ workerId: row.id }) } : {})}
        menu={menu}
      />
    ),
  }
}
