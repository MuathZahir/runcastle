import type { ReactNode } from 'react'
import type { ProjectSession } from '../../lib/api'
import { conversationTitle, sentenceCase } from '../../lib/conversation-title'
import { sessionStatusLabel } from '../../lib/feature-ui'
import { IconArrowRight, IconFolder, IconMessage } from '../../icons'
import { PageTopbar, StatusLabel } from '../../ui'
import type { StatusTone } from '../../ui'

/**
 * The live project conversation: the topbar says where you are (project › chat)
 * and what state the session is in, the terminal owns everything under it.
 *
 * The chat IS the terminal — Claude Code's own prompt is the composer — so the
 * body is the terminal on `surface-inset`, edge to edge, with nothing competing
 * with it. Ending the session is the topbar's last action.
 */
export function LiveChat({
  session,
  title,
  projectName = 'Project',
  branch,
  hidden,
  onBack,
  endControl,
  switcher,
  children,
}: {
  session: NonNullable<ProjectSession>
  title: string
  /** The parent crumb — clicking it steps back to the project page. */
  projectName?: string
  branch: string | null
  hidden: boolean
  onBack: () => void
  endControl: ReactNode
  /** The Chat | Drive tabs, when a project drive shares the body. */
  switcher?: ReactNode
  children: ReactNode
}) {
  const label = sentenceCase(sessionStatusLabel(session))
  const tone: StatusTone =
    session.status === 'live' ? 'live' : session.status === 'launching' ? 'accent' : 'neutral'
  const sid = session.ccSessionId ?? session.id
  return (
    <div
      className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}
      data-live-chat
      aria-hidden={hidden}
    >
      <PageTopbar
        crumbs={[
          { label: projectName, icon: <IconFolder />, onClick: onBack },
          { label: conversationTitle(title), icon: <IconMessage /> },
        ]}
        tabs={switcher}
        actions={
          <>
            <div className="mr-2 hidden items-center gap-4 text-xs text-text-tertiary md:flex">
              <StatusLabel tone={tone}>{label}</StatusLabel>
              <span className="inline-flex items-center gap-1.5">
                <IconArrowRight size={14} className="text-icon" />
                lands on <span className="font-mono">{branch ?? '…'}</span>
              </span>
              <span className="font-mono" title={sid}>
                {sid.slice(0, 8)}
              </span>
            </div>
            {endControl}
          </>
        }
      />
      <div className="min-h-0 flex-1 bg-surface-inset animate-fade-in">{children}</div>
    </div>
  )
}
