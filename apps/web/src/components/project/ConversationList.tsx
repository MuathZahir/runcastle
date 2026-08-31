import { Button, DimLine, SectionTitle, SessionStatusDot } from '../../ui'
import type { ProjectConversation } from '../../lib/api'
import { relTime } from '../../lib/format'

/**
 * Every conversation this project has had, newest first (decisions.md #6).
 *
 * A row is a title, when it was, and whether it is still open — nothing else.
 * The row itself opens the transcript, which is the thing a returning human
 * actually wants from a list of past chats; reopening one is the deliberate act,
 * so it is a ghost button that appears on hover or focus rather than a second
 * permanent control competing with the title beside it.
 */
export function ConversationList({
  conversations,
  pending,
  busy,
  onResume,
  onView,
}: {
  conversations: ProjectConversation[]
  /** Still fetching for the first time — distinct from "there are none". */
  pending: boolean
  busy: boolean
  onResume: (sessionId: string) => void
  onView: (conversation: ProjectConversation) => void
}) {
  if (pending) return null

  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>Conversations</SectionTitle>
      {conversations.length === 0 ? (
        <DimLine>No conversations yet.</DimLine>
      ) : (
        <div className="flex flex-col">
          {conversations.map((c) => (
            <div
              key={c.id}
              className="group -mx-3 grid h-11 grid-cols-[1fr_auto_auto] items-center gap-4 rounded-md border-t border-hairline-soft px-3 first:border-t-0 hover:bg-panel-3"
            >
              <button
                className="flex min-w-0 items-center gap-2.5 text-left text-base text-text"
                onClick={() => onView(c)}
              >
                {c.status !== 'ended' && <SessionStatusDot status={c.status} />}
                <span className="truncate">{c.title}</span>
              </button>
              <span className="font-mono text-sm text-text-3 tabular-nums">
                {c.createdAt === null ? '' : relTime(c.createdAt)}
              </span>
              {/* A conversation Claude Code never picked up has nothing to resume —
                  reopening it would silently be a new chat, so it does not offer. */}
              <Button
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                disabled={busy || !c.resumable}
                title={c.resumable ? undefined : 'this one never got started'}
                onClick={() => onResume(c.id)}
              >
                Reopen
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
