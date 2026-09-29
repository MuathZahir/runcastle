import type { ReactNode } from 'react'
import type { ProjectSession } from '../../lib/api'
import { conversationTitle } from '../../lib/conversation-title'
import { IconArrowRight, IconFolder, IconMessage } from '../../icons'
import { PageTopbar } from '../../ui'
import { ChatView } from '../chat/ChatView'

/**
 * The live project conversation: the topbar says where you are (project › chat)
 * and carries the view tabs; everything under it is the one chat surface every
 * feature's Chat tab renders too (`ChatView`) — the strip, then the terminal
 * edge to edge. The chat IS the terminal: Claude Code's own prompt is the
 * composer.
 */
export function LiveChat({
  session,
  title,
  projectName = 'Project',
  branch,
  hidden,
  onBack,
  onEnded,
  switcher,
}: {
  session: NonNullable<ProjectSession>
  title: string
  /** The parent crumb — clicking it steps back to the project page. */
  projectName?: string
  branch: string | null
  hidden: boolean
  onBack: () => void
  /** Refresh the project's own session and conversation rows after End session. */
  onEnded: () => void
  /** The Overview | Chat | Drive tabs, when there is more than the chat. */
  switcher?: ReactNode
}) {
  const sid = session.ccSessionId ?? session.id
  return (
    <div className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'} data-live-chat aria-hidden={hidden}>
      <PageTopbar
        crumbs={[
          { label: projectName, icon: <IconFolder />, onClick: onBack },
          { label: conversationTitle(title), icon: <IconMessage /> },
        ]}
        tabs={switcher}
      />
      <ChatView
        label="Project chat"
        session={session}
        contextLine="Project chat"
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
            <span className="hidden font-mono xl:inline" title={sid}>
              {sid.slice(0, 8)}
            </span>
          </>
        }
        onEnded={onEnded}
      />
    </div>
  )
}
