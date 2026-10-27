import type { ThreadEntry } from '../../lib/chat-thread'
import { ThreadColumn } from '../chat/ThreadColumn'

/**
 * A project conversation in the project page's chat column (design-mode
 * decision 11), live or long finished: a thread like every feature's chat
 * (chat-as-web-components decision 7). It opens at once from its log; sending
 * in a finished one picks that conversation back up. `threadId` null is a new
 * chat with nothing said yet, which `start` opens on its first message. The
 * page's one header row holds the thread list (decision 12).
 */
export function ProjectChat({
  projectId,
  threadId,
  runtime,
  start,
  onStarted,
  onOpenThread,
  landing,
}: {
  projectId: string
  threadId: string | null
  runtime?: ThreadEntry['runtime']
  start: () => Promise<string>
  onStarted: (threadId: string) => void
  onOpenThread: (threadId: string) => void
  /** The branch this chat's work lands on, for the line under the composer. */
  landing?: string
}) {
  return (
    <ThreadColumn
      label="Project chat"
      threadId={threadId}
      {...(runtime ? { runtime } : {})}
      start={start}
      onStarted={onStarted}
      onOpenThread={onOpenThread}
      draftKey={`project:${projectId}:new`}
      emptyHint="A new chat about this project — bring a lump of intent and it turns it into features."
      {...(landing ? { meta: `Lands on ${landing}` } : {})}
    />
  )
}
