import type { ReactNode } from 'react'
import { IconMessage, IconPlay, IconRefresh } from '../../icons'
import { Button, EmptyState } from '../../ui'
import { ConversationTranscript } from '../ConversationTranscript'
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
 *   the terminal — the whole area, edge to edge
 *   or, with nothing live, the last transcript (or nothing yet) over the one
 *   button that resumes or starts it
 *
 * No header row of its own (design-mode decision 12): the page's one header
 * holds the session switcher, and End session lives in the switcher's menu.
 * Each caller passes only its specifics: where an ended session refreshes,
 * the notices above the terminal, and the launch behind Resume / Start.
 * `children` render in a positioned layer over the terminal area — at rest,
 * over the transcript alone, clear of the launch button — for anything that
 * floats over the chat (the notice deck).
 *
 * `hidden` keeps the view mounted behind another view — xterm keeps its buffer
 * and the pty keeps one grid size — rather than unmounting it.
 */
export function ChatView({
  session,
  onEnded,
  notices,
  headless,
  transcriptId,
  onLaunch,
  launchLabel,
  launching = false,
  launchError,
  hidden = false,
  label = 'Chat',
  children,
}: {
  /** The live or launching session, or null when nothing is up. */
  session: ChatViewSession | null
  /** Refresh once the terminal says its session ended. */
  onEnded?: () => void
  /** Lines above the live terminal (not-ready, check-in, a failed resume). */
  notices?: ReactNode
  /**
   * The session up has no terminal (a headless self-planning run): this stands
   * where the terminal would, and nothing attaches to the process.
   */
  headless?: ReactNode
  /** With nothing live: the transcript to read back. Absent — never started. */
  transcriptId?: string
  /** With nothing live: the one launch that resumes or starts the conversation. */
  onLaunch?: () => void
  launchLabel?: string
  /** A launch is in flight — the button waits for it. */
  launching?: boolean
  /** Why the last launch was refused, said under its button. */
  launchError?: string
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
      {notices && <div className="flex flex-none flex-col gap-2 px-4 pt-2 empty:hidden">{notices}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col bg-surface-inset animate-fade-in">
        {session && headless ? (
          <div className="px-6 py-6 text-sm text-text-secondary">{headless}</div>
        ) : session ? (
          <div className="min-h-0 flex-1" data-chat-terminal="">
            <ErrorBoundary label="terminal">
              <TerminalView sessionId={session.id} onEnded={onEnded} />
            </ErrorBoundary>
          </div>
        ) : (
          <ChatAtRest
            transcriptId={transcriptId}
            onLaunch={onLaunch}
            launchLabel={launchLabel}
            launching={launching}
            launchError={launchError}
          >
            {children}
          </ChatAtRest>
        )}
        {session && children}
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
  launchError,
  children,
}: {
  transcriptId?: string
  onLaunch?: () => void
  launchLabel?: string
  launching: boolean
  launchError?: string
  children?: ReactNode
}) {
  return (
    <>
      {/* What floats over a chat at rest floats over its transcript, so it
          never covers the button that picks the conversation up. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-(--content-max)">
            {transcriptId ? (
              <ConversationTranscript sessionId={transcriptId} className="flex flex-col gap-4" />
            ) : (
              <EmptyState
                icon={<IconMessage />}
                title="No conversation yet"
                hint="One chat per feature — it knows the state, answers questions, and plans and runs the rounds that build it."
              />
            )}
          </div>
        </div>
        {children}
      </div>
      {onLaunch && (
        <div className="flex flex-none flex-col items-center gap-2 border-t border-border-subtle bg-surface px-4 py-3">
          <Button
            variant="primary"
            icon={transcriptId ? <IconRefresh /> : <IconPlay />}
            loading={launching}
            onClick={onLaunch}
          >
            {launchLabel ?? (transcriptId ? 'Resume the conversation' : 'Start the conversation')}
          </Button>
          {launchError && !launching && (
            <p role="alert" className="m-0 max-w-(--content-max) text-center text-sm text-danger">
              {launchError}
            </p>
          )}
        </div>
      )}
    </>
  )
}
