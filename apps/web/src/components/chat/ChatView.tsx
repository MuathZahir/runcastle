import type { ReactNode } from 'react'
import { IconMessage, IconPlay, IconRefresh } from '../../icons'
import { Button, EmptyState, StatusDot } from '../../ui'
import { ConversationTranscript } from '../ConversationTranscript'
import { EndSessionButton } from '../EndSessionButton'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'

/** The session a chat surface shows live — any row with an id and a status. */
export interface ChatViewSession {
  id: string
  status: string
}

/**
 * Every chat surface in the app (one-chat-layout-everywhere decision 6): the
 * project's chat and every feature's Chat tab render through this, so a visible
 * difference between the two is a bug here rather than two designs drifting.
 *
 *   the strip — live dot, the context line naming the session, End session
 *   the terminal — the whole area under the strip, edge to edge
 *   or, with nothing live, the last transcript (or nothing yet) over the one
 *   button that resumes or starts it
 *
 * Each caller passes only its specifics: the context line, where End session
 * refreshes, and the launch behind Resume / Start. `children` render in a
 * positioned layer over the terminal area, for anything that floats over the
 * chat (the notice deck).
 *
 * `hidden` keeps the view mounted behind another view — xterm keeps its buffer
 * and the pty keeps one grid size — rather than unmounting it.
 */
export function ChatView({
  session,
  contextLine,
  meta,
  featureId,
  onEnded,
  notices,
  transcriptId,
  onLaunch,
  launchLabel,
  launching = false,
  hidden = false,
  label = 'Chat',
  children,
}: {
  /** The live or launching session, or null when nothing is up. */
  session: ChatViewSession | null
  /** What this conversation is — "Chat · lap 2", "Drive fix", the project's own. */
  contextLine: ReactNode
  /** Quiet facts after the context line (a landing branch, a done state). */
  meta?: ReactNode
  /** The feature End session refreshes; absent on the project's chat. */
  featureId?: string
  /** Extra refresh after End session (the project's own rows). */
  onEnded?: () => void
  /** Lines between the strip and the live terminal (not-ready, check-in). */
  notices?: ReactNode
  /** With nothing live: the transcript to read back. Absent — never started. */
  transcriptId?: string
  /** With nothing live: the one launch that resumes or starts the conversation. */
  onLaunch?: () => void
  launchLabel?: string
  /** A launch is in flight — the button waits for it. */
  launching?: boolean
  hidden?: boolean
  /** The region's accessible name. */
  label?: string
  children?: ReactNode
}) {
  return (
    <section
      aria-label={label}
      aria-hidden={hidden}
      hidden={hidden}
      data-chat-view=""
      className={hidden ? 'hidden' : 'flex min-h-0 min-w-0 flex-1 flex-col'}
    >
      <div className="flex h-10 flex-none items-center gap-3 border-b border-border-subtle px-4 text-xs text-text-tertiary">
        <span className="inline-flex min-w-0 shrink-0 items-center gap-2 text-sm font-medium text-text">
          {session && (
            <StatusDot
              tone={session.status === 'launching' ? 'accent' : 'live'}
              label={session.status === 'launching' ? 'Starting' : 'Live'}
            />
          )}
          {contextLine}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-4 truncate">{meta}</span>
        {session && <EndSessionButton featureId={featureId} sessionId={session.id} onEnded={onEnded} />}
      </div>
      {session && notices && <div className="flex-none px-4 pt-2">{notices}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col bg-surface-inset animate-fade-in">
        {session ? (
          <div className="min-h-0 flex-1" data-chat-terminal="">
            <ErrorBoundary label="terminal">
              <TerminalView sessionId={session.id} />
            </ErrorBoundary>
          </div>
        ) : (
          <ChatAtRest
            transcriptId={transcriptId}
            onLaunch={onLaunch}
            launchLabel={launchLabel}
            launching={launching}
          />
        )}
        {children}
      </div>
    </section>
  )
}

/**
 * A chat with nothing live: the read-back transcript every surface uses for a
 * finished conversation, or — never started — nothing but the door, over the
 * one button that picks it up. Never a transcript with no way to answer it.
 */
function ChatAtRest({
  transcriptId,
  onLaunch,
  launchLabel,
  launching,
}: {
  transcriptId?: string
  onLaunch?: () => void
  launchLabel?: string
  launching: boolean
}) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto w-full max-w-(--content-max)">
          {transcriptId ? (
            <ConversationTranscript sessionId={transcriptId} className="flex flex-col gap-4" />
          ) : (
            <EmptyState
              icon={<IconMessage />}
              title="No conversation yet"
              hint="One chat per feature — it knows the state, answers questions, and edits the next burn's tickets."
            />
          )}
        </div>
      </div>
      {onLaunch && (
        <div className="flex flex-none items-center justify-center gap-3 border-t border-border-subtle bg-surface px-4 py-3">
          <Button
            variant="primary"
            icon={transcriptId ? <IconRefresh /> : <IconPlay />}
            loading={launching}
            onClick={onLaunch}
          >
            {launchLabel ?? (transcriptId ? 'Resume the conversation' : 'Start the conversation')}
          </Button>
        </div>
      )}
    </>
  )
}
