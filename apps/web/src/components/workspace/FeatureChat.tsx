import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import type { ChatNoticeTarget } from '../../lib/chat-notices'
import { activeSession, chatContextLine, featureChat } from '../../lib/feature-ui'
import { ChatView } from '../chat/ChatView'
import { FeatureNoticeDeck } from '../chat/FeatureNoticeDeck'
import { SessionNotices } from '../chat/SessionNotices'

/**
 * The feature's Chat tab (one-chat-layout-everywhere decisions 1, 5, 9): the
 * feature's live session — whatever its kind; one terminal per feature means at
 * most one — full-area through `ChatView`. With nothing live it reads back the
 * feature's chat transcript over Resume, or offers Start on a feature nobody has
 * talked to. Showing the tab never launches anything: `onLaunch` is the one
 * explicit click that does. The notice deck floats over it while it is in
 * front (decisions 3, 4, 10).
 */
export function FeatureChat({
  full,
  events,
  hidden,
  launching,
  onLaunch,
  onView,
}: {
  full: FeatureFull
  /** The feature's event log, which feeds the notice deck over the chat. */
  events: readonly EventRow[]
  hidden: boolean
  launching: boolean
  /** Resume or start the feature's chat — the same launch the bar's Chat door takes. */
  onLaunch: () => void
  /** Switch to the tab a notice points at. */
  onView: (target: ChatNoticeTarget) => void
}) {
  const live = activeSession(full.sessions)
  const chat = featureChat(full.sessions)
  return (
    <ChatView
      label="Feature chat"
      session={live ?? null}
      contextLine={live ? chatContextLine(live) : `Chat · lap ${full.feature.lap}`}
      meta="One transcript per feature"
      featureId={full.feature.id}
      notices={live && <SessionNotices featureId={full.feature.id} session={live} />}
      transcriptId={chat?.id}
      onLaunch={onLaunch}
      launching={launching}
      hidden={hidden}
    >
      <FeatureNoticeDeck events={events} tickets={full.tickets} active={!hidden} onView={onView} />
    </ChatView>
  )
}
