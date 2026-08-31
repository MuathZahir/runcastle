import type { ReactNode } from 'react'
import { Button } from '../../ui'
import type { ProjectConversation } from '../../lib/api'
import { relTime } from '../../lib/format'

/**
 * One past conversation, read back (decisions.md #11) — the way out of it and
 * the way back into it, over whatever renders the turns.
 *
 * The transcript itself is the child rather than a `sessionId` this pane
 * fetches from: the header is the whole of this component's behaviour, and
 * composing keeps it a plain render seam.
 */
export function TranscriptPane({
  conversation,
  onBack,
  onReopen,
  reopening,
  children,
}: {
  conversation: ProjectConversation
  onBack: () => void
  onReopen: () => void
  reopening: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button className="border-transparent text-text-2" onClick={onBack}>
          ← Conversations
        </Button>
        <span className="truncate text-lg font-semibold text-text">{conversation.title}</span>
        {conversation.createdAt !== null && (
          <span className="shrink-0 font-mono text-sm text-text-3">
            {relTime(conversation.createdAt)}
          </span>
        )}
        <Button
          className="ml-auto"
          disabled={reopening || !conversation.resumable}
          onClick={onReopen}
        >
          {reopening ? 'Opening…' : 'Reopen'}
        </Button>
      </div>
      {children}
    </div>
  )
}
