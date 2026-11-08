import { isDriveWorkerKind } from '@runcastle/core'
import type { ReactNode } from 'react'
import type { WorkerListRow } from '../../lib/api'
import type { ThreadEntry } from '../../lib/chat-thread'
import { workerPreviewAddress } from '../../lib/design-address'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { useThreadActions } from '../../lib/use-thread'
import { OLD_CHAT_WORDS, oldChatOf, workerAssignment, workerCanHandBack, workerStatusWhy, type OldChat } from '../../lib/workers'
import { trpc } from '../../trpc'
import { IconAlert, IconBranch, IconDoc, IconGitMerge, IconPlay, IconX } from '../../icons'
import { copyText } from '../workspace/copy-text'
import type { FeatureAction } from '../FeatureActionsMenu'
import { AssignmentCard, HandedBackLine, OldChatNote, WorkerClosedNote, WorkerHeaderActions, WorkerStatusLine } from './WorkerParts'

/**
 * A worker's chat on the feature page (interactive-workers decisions 5, 15,
 * 21, 23), wired to `worker.list`: what the chat column shows around a
 * worker's thread (its assignment card, the line it ends on, what stands in for
 * the composer once it takes no messages) and what the page's header shows for
 * it (its status, Open preview, Hand back). An old side chat is a read-only
 * transcript.
 */

/** What thread is in front, as far as workers go: a worker, an old side or drive chat, or neither. */
export type WorkerInFront = { kind: 'worker'; row: WorkerListRow } | { kind: 'old-chat'; old: OldChat; thread: ThreadEntry } | null

/** The feature's workers, read once per page; every `worker.*` event invalidates them (lib/live.ts). */
export function useFeatureWorkers(featureId: string): WorkerListRow[] {
  return trpc.worker.list.useQuery({ featureId }, { refetchInterval: useLivePoll() }).data ?? []
}

/** The project's own workers (a project drive's Scenarios worker, drive-chats-become-workers decision 2), invalidated as the feature's are. */
export function useProjectWorkers(projectId: string): WorkerListRow[] {
  return trpc.worker.listProject.useQuery({ projectId }, { refetchInterval: useLivePoll() }).data ?? []
}

/** Which worker, if any, the thread in front is. */
export function workerInFront(rows: readonly WorkerListRow[], threads: readonly ThreadEntry[], current: string | null): WorkerInFront {
  if (current === null) return null
  const row = rows.find((w) => w.id === current)
  if (row) return { kind: 'worker', row }
  const thread = threads.find((t) => t.id === current)
  const old = thread && oldChatOf(thread.role)
  return thread && old ? { kind: 'old-chat', old, thread } : null
}

const WORKER_HINT = 'A worker in its own sandbox, on its own branch off the feature. It hands its work back to the lead.'
const DRIVE_WORKER_HINT = 'A drive worker in your checkout. It commits straight onto the drive’s branch.'

/**
 * Where a worker runs, under its composer: a drive worker or a drive review in
 * the human's checkout, a gates review on the committed branch, anyone else on
 * its own branch. A drive worker names the branch it commits on
 * (drive-chats-become-workers decision 3), which on a project drive may be main.
 */
export function workerWhere(row: Pick<WorkerListRow, 'kind' | 'reviewMode' | 'featureBranch'>, featureBranch: string): string {
  if (isDriveWorkerKind(row.kind)) return `Your checkout · commits on ${row.featureBranch}`
  if (row.kind === 'review') {
    return row.reviewMode === 'drive' ? `Your checkout · reviewing ${featureBranch} on the drive` : `Sandbox · reviewing ${featureBranch}`
  }
  return `Sandbox · its own branch off ${featureBranch}`
}

/** What the chat column wears for a worker's thread, as `ThreadColumn` props. */
export function workerColumnProps(
  w: NonNullable<WorkerInFront>,
  featureBranch: string,
): { head?: ReactNode; tail?: ReactNode; closed?: ReactNode; meta?: string; placeholder?: string; emptyHint: string } {
  if (w.kind === 'old-chat') return { closed: <OldChatNote old={w.old} />, emptyHint: `An ${OLD_CHAT_WORDS[w.old].toLowerCase()}, from before workers.` }
  const row = w.row
  const drive = isDriveWorkerKind(row.kind)
  const head = <AssignmentCard assignment={workerAssignment(row)} />
  const handedBack =
    row.status === 'handed-back' ? (
      <div className="mt-7">
        <HandedBackLine
          commits={row.handbackCommits?.length ?? 0}
          files={row.handbackFiles?.length ?? 0}
          {...(row.featureId === null ? { to: 'the project chat' as const } : {})}
        />
      </div>
    ) : undefined
  const closed =
    // Between drives a drive worker takes no messages; the next drive's button reopens it (decision 5).
    drive && row.status === 'handed-back' ? (
      <WorkerClosedNote
        icon={<IconPlay />}
        title="Done for this drive"
        hint={`${row.kind === 'fix-drive' ? 'Fix drive' : 'New scenario'} on your next drive reopens it, with what it learned.`}
      />
    ) : row.status === 'failed' ? (
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
    emptyHint: drive ? DRIVE_WORKER_HINT : WORKER_HINT,
    ...(handedBack ? { tail: handedBack } : {}),
    ...(closed
      ? { closed }
      : {
          meta: workerWhere(row, featureBranch),
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
    onSuccess: () => void utils.worker.invalidate(),
    onError: (e) => toast.push(e.message),
  })
  if (!w) return null
  if (w.kind === 'old-chat') {
    return {
      status: <WorkerStatusLine status="handed-back" old={w.old} />,
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
  const why = workerStatusWhy(row)
  return {
    status: <WorkerStatusLine status={row.status} {...(why ? { why } : {})} />,
    actions: (
      <WorkerHeaderActions
        {...(previews ? { onOpenPreview: () => window.open(workerPreviewAddress(window.location, row.passPort, previewPath), '_blank', 'noopener') } : {})}
        {...(workerCanHandBack(row.status) ? { onHandBack: () => handBack.mutate({ workerId: row.id }) } : {})}
        menu={menu}
      />
    ),
  }
}
