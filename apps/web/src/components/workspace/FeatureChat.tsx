import type { ReactNode } from 'react'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import type { ChatNoticeTarget } from '../../lib/chat-notices'
import { activeSession, featureChat, isHeadlessRun, isSelfPlanRun } from '../../lib/feature-ui'
import { ChatView } from '../chat/ChatView'
import { FeatureNoticeDeck } from '../chat/FeatureNoticeDeck'
import { SessionNotices } from '../chat/SessionNotices'

/**
 * The feature chat in the chat column (one-chat-layout-everywhere decisions 1, 5, 9): the
 * feature's live session — whatever its kind; one terminal per feature means at
 * most one — full-area through `ChatView`. With nothing live it reads back the
 * feature's chat transcript over Resume, or offers Start on a feature nobody has
 * talked to. Showing the tab never launches anything: `onLaunch` is the one
 * explicit click that does. The notice deck floats over it while it is in
 * front (decisions 3, 4, 10). Its switcher and End session are the page
 * header's (design-mode decision 12).
 */
export function FeatureChat({
  full,
  events,
  alerts,
  hidden,
  launching,
  launchError,
  onLaunch,
  onView,
}: {
  full: FeatureFull
  /** The feature's event log, which feeds the notice deck over the chat. */
  events: readonly EventRow[]
  /** The page's dismissible notices, at the top of the column (a failed resume, a drive's prerequisites). */
  alerts?: ReactNode
  hidden: boolean
  launching: boolean
  /** Why the last Resume or Start was refused (a talk worktree that cannot be made). */
  launchError?: string
  /** Resume or start the feature's chat — the same launch the bar's Chat door takes. */
  onLaunch: () => void
  /** Open the panel view a notice points at. */
  onView: (target: ChatNoticeTarget) => void
}) {
  const live = activeSession(full.sessions)
  const chat = featureChat(full.sessions)
  const notices = (alerts || live) && (
    <>
      {alerts}
      {live && <SessionNotices featureId={full.feature.id} session={live} />}
    </>
  )
  return (
    <ChatView
      label="Agent"
      session={live ?? null}
      notices={notices}
      headless={
        live && isHeadlessRun(live)
          ? isSelfPlanRun(live)
            ? 'This feature is planning itself. There is no terminal to watch; the plan appears in the body as it is written.'
            : 'This feature is working by itself. There is no terminal to watch; its docs and tickets update in the body as it works.'
          : undefined
      }
      transcriptId={chat?.id}
      onLaunch={onLaunch}
      launching={launching}
      launchError={launchError}
      hidden={hidden}
    >
      <FeatureNoticeDeck events={events} tickets={full.tickets} active={!hidden} onView={onView} />
    </ChatView>
  )
}
