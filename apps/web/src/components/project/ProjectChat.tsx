import type { ReactNode } from 'react'
import type { ProjectSession } from '../../lib/api'
import { IconArrowRight } from '../../icons'
import { ChatView } from '../chat/ChatView'

/**
 * A project conversation, live or ended, in the project page's chat column
 * (design-mode decision 11): the one chat surface every feature's chat renders
 * too (`ChatView`), with the column's session switcher where its context line
 * would be. Live, that is the strip, then the terminal edge to edge — Claude
 * Code's own prompt is the composer. Ended, it is ChatView at rest: the same
 * strip over the read-back transcript and its Resume, exactly as a feature's
 * ended chat looks (one-chat-layout-everywhere decision 6). The page's topbar
 * says where you are.
 */
export function ProjectChat({
  session,
  transcriptId,
  onResume,
  resuming = false,
  branch,
  hidden,
  onEnded,
  switcher,
}: {
  /** The live project session, or null for an ended conversation read back. */
  session: NonNullable<ProjectSession> | null
  /** With nothing live: the conversation to read back. */
  transcriptId?: string
  /** With nothing live: reopen it. Absent when Claude Code never picked it up. */
  onResume?: () => void
  resuming?: boolean
  branch: string | null
  hidden: boolean
  /** Refresh the project's own session and conversation rows after End session. */
  onEnded?: () => void
  /** The chat column's session switcher: the live chat and the past ones. */
  switcher: ReactNode
}) {
  const sid = session ? (session.ccSessionId ?? session.id) : null
  return (
    <div className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'} data-live-chat={session ? '' : undefined}
      aria-hidden={hidden}>
      <ChatView
        label="Project chat"
        session={session}
        contextLine={switcher}
        meta={
          <>
            {/* Said once the branch is known — a literal "…" read as a
                truncated name. */}
            {branch && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <IconArrowRight size={14} className="text-icon" />
                lands on <span className="font-mono">{branch}</span>
              </span>
            )}
            {sid && (
              <span className="hidden font-mono xl:inline" title={sid}>
                {sid.slice(0, 8)}
              </span>
            )}
          </>
        }
        onEnded={onEnded}
        transcriptId={transcriptId}
        onLaunch={onResume}
        launching={resuming}
      />
    </div>
  )
}
