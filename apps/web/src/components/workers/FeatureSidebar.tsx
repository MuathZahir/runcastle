import type { FeatureListItem } from '../../lib/api'
import type { ThreadEntry, ThreadState } from '../../lib/chat-thread'
import { NEW_CHAT_NAME, UNSTARTED_CHAT, standIn } from '../../lib/chat-sessions'
import { useLivePoll } from '../../lib/live'
import { sidebarThreadOrder, type SidebarThreads } from '../../lib/sidebar-threads'
import { useToast } from '../../lib/toast'
import { featureWorkerEntries, type WorkerEntry } from '../../lib/workers'
import { trpc } from '../../trpc'
import { IconBranch } from '../../icons'
import { copyText } from '../workspace/copy-text'
import type { FeatureAction } from '../FeatureActionsMenu'
import { featureStateWords, SidebarThreadList } from '../SidebarParts'
import { FeatureSidebarPage } from './FeatureSidebarPage'

/** The Lead card's second line: the lead's chat as every thread list says it, else where the feature is. */
const LEAD_WORDS: Partial<Record<ThreadState, string>> = {
  waiting: 'Waiting for you',
  working: 'Working',
}

/**
 * The open feature's own sidebar page (interactive-workers decisions 3, 24),
 * fed by `worker.list` and the threads the feature page publishes: the lead's
 * chat, its workers and its old side chats in their lanes, and its scenario
 * chats inside the Lead card, as the Orchestrator's chats sit inside its own.
 * "+" starts a worker with no assignment and brings its chat to the front.
 */
export function FeatureSidebar({
  feature,
  threads: published,
  onBack,
  threadActionsFor,
}: {
  feature: FeatureListItem
  /** What the feature page published: its threads, the one in front, how to pick one. */
  threads: SidebarThreads
  onBack: () => void
  /** A thread's Rename and Export, as every thread list offers them. */
  threadActionsFor: (t: ThreadEntry) => FeatureAction[]
}) {
  const toast = useToast()
  // Invalidated by every `worker.*` event (lib/live.ts).
  const workersQ = trpc.worker.list.useQuery({ featureId: feature.id }, { refetchInterval: useLivePoll() })
  const rows = workersQ.data ?? []
  const lead = published.threads.find((t) => t.role === 'main') ?? standIn(UNSTARTED_CHAT, NEW_CHAT_NAME, 'main')
  const workers = featureWorkerEntries(rows, published.threads)
  const scenarios = sidebarThreadOrder(published.threads.filter((t) => t.role === 'old-drive-chat'))
  const titles = new Map(published.threads.map((t) => [t.id, t]))

  const actionsFor = (w: WorkerEntry): FeatureAction[] => {
    const thread = titles.get(w.id) ?? standIn(w.id, w.label, w.oldSideChat ? 'side' : 'worker')
    const branch = rows.find((r) => r.id === w.id)?.branch
    const settled = w.status === 'landed' || w.status === 'dropped'
    return [
      ...threadActionsFor(thread),
      ...(branch && !settled ? [{ key: 'copy-branch', label: 'Copy branch name', icon: <IconBranch />, onSelect: () => copyText(branch, toast) }] : []),
    ]
  }

  return (
    <FeatureSidebarPage
      feature={feature}
      leadStatus={LEAD_WORDS[lead.state] ?? featureStateWords(feature)}
      onBack={onBack}
      onNewWorker={published.newThread}
      lead={lead}
      workers={workers}
      current={published.current}
      onOpen={published.pick}
      leadActions={threadActionsFor(lead)}
      actionsFor={actionsFor}
      {...(scenarios.length > 0
        ? {
            leadThreads: (
              <SidebarThreadList threads={scenarios} current={published.current} onOpen={published.pick} actionsFor={threadActionsFor} />
            ),
          }
        : {})}
    />
  )
}
