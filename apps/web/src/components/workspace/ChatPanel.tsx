import type { ReactNode } from 'react'
import type { FeatureFull } from '../../lib/api'
import { dockedChat, sessionActive } from '../../lib/feature-ui'
import { IconTerminal } from '../../icons'
import { Button, EmptyState, SessionStatusDot } from '../../ui'
import { ConversationTranscript } from '../ConversationTranscript'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * The feature body with its chat docked beside it, or the body exactly as it was
 * (decision 16).
 *
 * Closed, this renders nothing of its own — not a wrapper, not a stub, not a
 * collapsed rail — so a workspace with the panel away is the markup the app had
 * before the panel existed. That is the whole of "collapsed, it costs nothing":
 * the body keeps whatever layout its phase gave it, and no row is introduced for
 * it to sit inside.
 */
export function ChatDock({
  open,
  panel,
  children,
}: {
  open: boolean
  /** The panel itself, built by the workspace that knows the feature. */
  panel: ReactNode
  children: ReactNode
}) {
  if (!open) return <>{children}</>
  // The body is given its own column rather than dropped straight into the row:
  // it was laid out as the workspace's full width, and `min-w-0` is what stops a
  // wide ticket table or a long branch name from pushing the panel off the edge.
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {panel}
    </div>
  )
}

/**
 * The feature's one conversation, docked to the right of whatever the phase body
 * is doing (decision 16).
 *
 * It is the same conversation in all four states and says so: the header names
 * it once ("one transcript · resumed") and never rewords itself per state, the
 * same way the door that opens it never does (decision 8).
 *
 * What fills it follows the conversation rather than the phase. A chat that is
 * up gets its terminal — the live transcript and the place to type into it are
 * one surface, and the panel would otherwise be a transcript you cannot answer.
 * A chat that has ended gets the read-back transcript every other surface in the
 * app uses for a finished conversation, over the one button that picks it back
 * up. A feature nobody has talked to yet gets that button and nothing else.
 */
export function ChatPanel({
  featureId,
  sessions,
  busy,
  onOpenChat,
  onCollapse,
}: {
  featureId: string
  sessions: FeatureFull['sessions']
  /** A launch is already in flight — the panel's own door waits for it. */
  busy: boolean
  /** Resume the one transcript (or start it), the same road the bar's Chat takes. */
  onOpenChat: () => void
  onCollapse: () => void
}) {
  const chat = dockedChat(sessions)
  const live = !!chat && sessionActive(chat)

  return (
    <aside
      className="flex min-h-0 w-(--chat-panel-w) flex-none flex-col border-l border-hairline bg-panel-2"
      aria-label="Feature chat"
    >
      <header className="flex h-12 flex-none items-center gap-2 border-b border-hairline px-3">
        {live && chat ? (
          <SessionStatusDot status={chat.status} />
        ) : (
          <span className="size-2 rounded-pill bg-text-4" aria-hidden="true" />
        )}
        <span className="text-base font-semibold text-text">Chat</span>
        <span className="truncate text-sm text-text-3">one transcript · resumed</span>
        <span className="flex-1" />
        {live && chat && <EndSessionButton featureId={featureId} sessionId={chat.id} />}
        <Button
          size="xs"
          aria-label="Collapse the chat"
          title="Collapse the chat"
          onClick={onCollapse}
        >
          ▸
        </Button>
      </header>

      {live && chat ? (
        <div className="min-h-0 flex-1 bg-panel-inset" id="chat-panel-terminal">
          <ErrorBoundary label="terminal">
            <TerminalView sessionId={chat.id} />
          </ErrorBoundary>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {chat ? (
              <ConversationTranscript sessionId={chat.id} className="flex flex-col gap-4" />
            ) : (
              <EmptyState
                compact
                icon={<IconTerminal size={16} />}
                title="No conversation yet"
                hint="One chat per feature — it knows the state, answers questions, and edits the next burn's tickets."
              />
            )}
          </div>
          {/* Where a live chat has its composer, an ended one has the single
              click that picks the same transcript back up — the panel is never a
              transcript with no way to answer it. */}
          <div className="flex flex-none items-center gap-3 border-t border-hairline px-3 py-3">
            <Button disabled={busy} onClick={onOpenChat}>
              {chat ? 'Resume the conversation' : 'Start the conversation'}
            </Button>
            <span className="truncate text-sm text-text-3">every door resumes it</span>
          </div>
        </>
      )}
    </aside>
  )
}
