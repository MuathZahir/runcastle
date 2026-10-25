import type { ProjectSession } from '../../lib/api'
import { ChatView } from '../chat/ChatView'

/**
 * A project conversation, live or ended, in the project page's chat column
 * (design-mode decision 11): the one chat surface every feature's chat renders
 * too (`ChatView`). Live, that is the terminal edge to edge — Claude Code's own
 * prompt is the composer. Ended, it is ChatView at rest: the read-back
 * transcript and its Resume, exactly as a feature's ended chat looks
 * (one-chat-layout-everywhere decision 6). The page's one header row holds the
 * switcher, and its menu the landing branch and End session (decision 12).
 */
export function ProjectChat({
  session,
  transcriptId,
  onResume,
  resuming = false,
  autoResuming = false,
  hidden,
  onEnded,
}: {
  /** The live project session, or null for an ended conversation read back. */
  session: NonNullable<ProjectSession> | null
  /** With nothing live: the conversation to read back. */
  transcriptId?: string
  /** With nothing live: reopen it. Absent when Claude Code never picked it up. */
  onResume?: () => void
  resuming?: boolean
  /** Showing it is resuming it by itself: "Resuming…" stands where Resume was. */
  autoResuming?: boolean
  hidden: boolean
  /** Refresh the project's own session and conversation rows once it ends. */
  onEnded?: () => void
}) {
  return (
    <div className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'} data-live-chat={session ? '' : undefined}
      aria-hidden={hidden}>
      <ChatView
        label="Project chat"
        session={session}
        onEnded={onEnded}
        transcriptId={transcriptId}
        onLaunch={onResume}
        launching={resuming}
        autoResuming={autoResuming}
      />
    </div>
  )
}
