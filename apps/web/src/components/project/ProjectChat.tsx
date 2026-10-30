import type { ThreadEntry } from '../../lib/chat-thread'
import type { SessionBranchApi } from '../../lib/use-session-branch'
import { IconOrchestrator } from '../../icons'
import { BranchMenu } from '../../ui'
import { ThreadColumn } from '../chat/ThreadColumn'

/**
 * A project conversation in the Orchestrator's chat column (design-mode
 * decision 11), live or long finished: a thread like every feature's chat
 * (chat-as-web-components decision 7). It opens at once from its log; sending
 * in a finished one picks that conversation back up, and the first message in
 * a new one starts it. With no id, it is the chat a project with none opens on:
 * `start` makes its thread on the first message.
 *
 * The line under the composer says where its work lands; until the first
 * message that is the landing branch's menu, the one choice a new chat takes.
 */
export function ProjectChat({
  threadId,
  runtime,
  start,
  startsAs,
  onStarted,
  onOpenThread,
  landing,
}: {
  threadId: string | null
  runtime?: ThreadEntry['runtime']
  start?: () => Promise<string>
  startsAs?: { projectId: string; kind: 'project' }
  onStarted?: (threadId: string) => void
  onOpenThread: (threadId: string) => void
  landing: SessionBranchApi
}) {
  return (
    <ThreadColumn
      label="Project chat"
      threadId={threadId}
      {...(runtime ? { runtime } : {})}
      {...(start ? { start } : {})}
      {...(startsAs ? { startsAs, draftKey: `project:${startsAs.projectId}:new` } : {})}
      {...(onStarted ? { onStarted } : {})}
      onOpenThread={onOpenThread}
      empty={<OrchestratorOpening />}
      {...(landing.value ? { meta: `Lands on ${landing.value}` } : {})}
      startMeta={
        <BranchMenu
          prefix="Lands on"
          className="-ml-2"
          value={landing.value}
          branches={landing.branches}
          detected={landing.detected}
          missing={landing.missing}
          disabled={landing.picking}
          onPick={landing.pick}
        />
      }
    />
  )
}

/**
 * An empty Orchestrator chat, the page a project starts on: the card's hub in
 * its accent tile, grown to the moment, and the one question it is here for.
 */
function OrchestratorOpening() {
  return (
    <div className="flex animate-rise-in flex-col items-center gap-4 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] text-accent-text shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_12%,transparent)] ring-1 ring-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] ring-inset">
        <IconOrchestrator size={26} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 text-xl font-semibold tracking-tight text-text">What are we building?</h2>
        <p className="m-0 max-w-[44ch] text-sm text-pretty text-text-tertiary">
          Bring a raw idea. The Orchestrator checks it against what’s built and cuts it into features.
        </p>
      </div>
    </div>
  )
}
