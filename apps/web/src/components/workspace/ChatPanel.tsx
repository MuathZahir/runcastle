import type { FeatureFull } from '../../lib/api'
import { dockedChat, sessionActive } from '../../lib/feature-ui'
import { IconMessage, IconPlay, IconRefresh } from '../../icons'
import { Aside, Button, EmptyState, SessionStatusDot } from '../../ui'
import { ConversationTranscript } from '../ConversationTranscript'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * The feature's one conversation, as the page's aside (decision 16).
 *
 * It is the same conversation in all four states and says so once, in its
 * header — the door that opens it never rewords itself per state either
 * (decision 8).
 *
 * What fills it follows the conversation rather than the phase. A chat that is
 * up gets its terminal — the live transcript and the place to type into it are
 * one surface. A chat that has ended gets the read-back transcript every other
 * surface uses for a finished conversation, over the one button that picks it
 * back up. A feature nobody has talked to yet gets that button and nothing else.
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
  /** Resume the one transcript (or start it), the same road the topbar's Chat takes. */
  onOpenChat: () => void
  onCollapse: () => void
}) {
  const chat = dockedChat(sessions)
  const live = !!chat && sessionActive(chat)

  return (
    <Aside
      label="Chat"
      title={
        <span className="flex min-w-0 items-center gap-2">
          {live && chat && <SessionStatusDot status={chat.status} />}
          <span>Chat</span>
          <span className="truncate font-normal text-text-tertiary">One transcript, resumed</span>
        </span>
      }
      actions={live && chat ? <EndSessionButton featureId={featureId} sessionId={chat.id} /> : undefined}
      onClose={onCollapse}
      bodyClassName="flex flex-col overflow-hidden"
    >
      <section aria-label="Feature chat" className="flex min-h-0 flex-1 flex-col">
        {live && chat ? (
          <div className="min-h-0 flex-1 bg-surface-inset" id="chat-panel-terminal">
            <ErrorBoundary label="terminal">
              <TerminalView sessionId={chat.id} />
            </ErrorBoundary>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {chat ? (
                <ConversationTranscript sessionId={chat.id} className="flex flex-col gap-4" />
              ) : (
                <EmptyState
                  compact
                  icon={<IconMessage />}
                  title="No conversation yet"
                  hint="One chat per feature — it knows the state, answers questions, and edits the next burn's tickets."
                />
              )}
            </div>
            {/* Where a live chat has its composer, an ended one has the single
                click that picks the same transcript back up — the aside is
                never a transcript with no way to answer it. */}
            <div className="flex flex-none items-center gap-3 border-t border-border-subtle px-4 py-3">
              <Button
                variant="secondary"
                icon={chat ? <IconRefresh /> : <IconPlay />}
                disabled={busy}
                onClick={onOpenChat}
              >
                {chat ? 'Resume the conversation' : 'Start the conversation'}
              </Button>
              <span className="truncate text-xs text-text-tertiary">Every door resumes it</span>
            </div>
          </>
        )}
      </section>
    </Aside>
  )
}
