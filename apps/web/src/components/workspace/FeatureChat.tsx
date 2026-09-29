import type { FeatureFull } from '../../lib/api'
import { activeSession, chatContextLine, featureChat, sessionDoneState } from '../../lib/feature-ui'
import { IconCheck } from '../../icons'
import { StatusLabel } from '../../ui'
import { ChatView } from '../chat/ChatView'
import { SessionNotices } from '../chat/SessionNotices'

/**
 * The feature's Chat tab (one-chat-layout-everywhere decisions 1, 5, 9): the
 * feature's live session — whatever its kind; one terminal per feature means at
 * most one — full-area through `ChatView`. With nothing live it reads back the
 * feature's chat transcript over Resume, or offers Start on a feature nobody has
 * talked to. Showing the tab never launches anything: `onLaunch` is the one
 * explicit click that does.
 */
export function FeatureChat({
  full,
  hidden,
  launching,
  onLaunch,
}: {
  full: FeatureFull
  hidden: boolean
  launching: boolean
  /** Resume or start the feature's chat — the same launch the bar's Chat door takes. */
  onLaunch: () => void
}) {
  const live = activeSession(full.sessions)
  const chat = featureChat(full.sessions)
  const done = live ? doneText(full, live) : null
  return (
    <ChatView
      label="Feature chat"
      session={live ?? null}
      contextLine={live ? chatContextLine(live, full.waypoints) : `Chat · lap ${full.feature.lap}`}
      meta={
        done ? (
          <StatusLabel tone="success" icon={<IconCheck />} className="min-w-0" title={done}>
            {done}
          </StatusLabel>
        ) : (
          'One transcript per feature'
        )
      }
      featureId={full.feature.id}
      notices={live && <SessionNotices featureId={full.feature.id} session={live} />}
      transcriptId={chat?.id}
      onLaunch={onLaunch}
      launching={launching}
      hidden={hidden}
    />
  )
}

/**
 * A waypoint session whose waypoint went terminal says so in the strip — a
 * status, never another action: the terminal stays usable, because the agent
 * may resolve while the human still has things to say to it.
 */
function doneText(full: FeatureFull, session: FeatureFull['sessions'][number]): string | null {
  const state = sessionDoneState(full, session)
  if (state.kind === 'notDone') return null
  if (state.kind === 'mapComplete') return 'Map complete — every waypoint is done. Converge from Overview.'
  const lead = state.waypoint.status === 'dropped' ? 'Dropped' : 'Resolved'
  if (state.kind === 'awaitingResearch')
    return `${lead} — waiting on ${state.claimed} research run${state.claimed === 1 ? '' : 's'}`
  return `${lead}${state.waypoint.summary ? ` — ${state.waypoint.summary}` : ''}`
}
