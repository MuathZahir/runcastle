import type { ReactNode } from 'react'
import type { FeatureFull } from '../../lib/api'
import { dockedChat, sessionActive } from '../../lib/feature-ui'
import { IconMessage, IconPlay, IconRefresh } from '../../icons'
import { Aside, Button, EmptyState, SessionStatusDot } from '../../ui'
import { ConversationTranscript } from '../ConversationTranscript'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/**
 * The feature body with the page's one aside beside it (chat or details), or
 * the body exactly as it was.
 *
 * Closed, this renders nothing of its own — not a wrapper, not a stub, not a
 * collapsed rail — so a page with the aside away is the markup it would have
 * without one. That is the whole of "collapsed, it costs nothing".
 */
export function ChatDock({
  open,
  panel,
  children,
}: {
  open: boolean
  /** The aside itself, built by the workspace that knows the feature. */
  panel: ReactNode
  children: ReactNode
}) {
  if (!open) return <>{children}</>
  // The body is given its own column rather than dropped straight into the row:
  // `min-w-0` is what stops a wide ledger or a long branch name from pushing
  // the aside off the edge.
  // In a wide panel the aside takes its own column beside the page; in a
  // narrow one (under 56rem — a 1024px window with the sidebar open) pushing
  // would leave the page a sliver, so it floats over the page's right edge
  // instead, as a raised layer.
  return (
    <div className="@container relative flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <div className="flex h-full shrink-0 @max-4xl:absolute @max-4xl:inset-y-0 @max-4xl:right-0 @max-4xl:z-20 @max-4xl:shadow-dialog">
        {panel}
      </div>
    </div>
  )
}

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
