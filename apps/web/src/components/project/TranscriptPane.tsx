import type { ReactNode } from 'react'
import { IconArrowRight, IconClock, IconFolder, IconMessage, IconRefresh } from '../../icons'
import { Button, Page, PageHeader, PageTopbar } from '../../ui'
import type { ProjectConversation } from '../../lib/api'
import { conversationTitle } from '../../lib/conversation-title'
import { relTimeAgo } from '../../lib/format'

/**
 * One past conversation, read back (decisions.md #11): the topbar's crumbs are
 * the way out of it (project › chat), its one action the way back into it, and
 * the body is the transcript at reading width.
 *
 * The transcript itself is the child rather than a `sessionId` this pane
 * fetches from: the frame is the whole of this component's behaviour, and
 * composing keeps it a plain render seam.
 */
export function TranscriptPane({
  conversation,
  projectName = 'Project',
  onBack,
  onReopen,
  reopening,
  children,
}: {
  conversation: ProjectConversation
  /** The parent crumb — clicking it is the way back to the project page. */
  projectName?: string
  onBack: () => void
  onReopen: () => void
  reopening: boolean
  children: ReactNode
}) {
  const title = conversationTitle(conversation.title)
  const live = conversation.status !== 'ended'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageTopbar
        crumbs={[
          { label: projectName, icon: <IconFolder />, onClick: onBack },
          { label: title, icon: <IconMessage /> },
        ]}
        actions={
          <Button
            icon={live ? <IconArrowRight /> : <IconRefresh />}
            loading={reopening}
            disabled={reopening || !conversation.resumable}
            title={conversation.resumable ? undefined : 'this one never got started'}
            onClick={onReopen}
          >
            {live ? 'Open' : 'Reopen'}
          </Button>
        }
      />
      <Page routeKey={`transcript-${conversation.id}`}>
        <PageHeader
          title={title}
          meta={[
            conversation.createdAt !== null && {
              icon: <IconClock />,
              text: `Started ${relTimeAgo(conversation.createdAt)}`,
            },
            live && { tone: 'live', text: 'Open now' },
          ]}
        />
        <div className="mt-8">{children}</div>
      </Page>
    </div>
  )
}
