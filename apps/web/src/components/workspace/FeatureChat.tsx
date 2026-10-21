import { useState } from 'react'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull, FeatureSessionEntry } from '../../lib/api'
import type { ChatNoticeTarget } from '../../lib/chat-notices'
import { activeSession, chatContextLine, featureChat, isHeadlessRun, isSelfPlanRun } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { trpc } from '../../trpc'
import { ChatView } from '../chat/ChatView'
import { FeatureNoticeDeck } from '../chat/FeatureNoticeDeck'
import { SessionNotices } from '../chat/SessionNotices'
import { SessionSwitcher } from './SessionSwitcher'

/**
 * The feature's Chat tab (one-chat-layout-everywhere decisions 1, 5, 9): the
 * session picked in the header's switcher, full-area through `ChatView`.
 *
 * The main chat is the default and what the tab shows until the human picks
 * something else: the live session of its slot (the chat, or the drive fix
 * that shares it — never a side session or the scenario chat, which have rows
 * of their own in the switcher), or with nothing live the feature's chat
 * transcript over Resume, or Start on a feature nobody has talked to. A side
 * session shows its terminal while live and its transcript over Reopen once
 * ended (several-sessions-per-feature decisions 8, 10).
 *
 * Showing the tab never launches anything: `onLaunch`, Reopen and New side
 * session are the explicit clicks that do. The notice deck floats over it while
 * it is in front (decisions 3, 4, 10).
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
  const featureId = full.feature.id
  const toast = useToast()
  const utils = trpc.useUtils()
  // Invalidated by the session events over the live stream (lib/live.ts).
  const list = trpc.feature.sessions.useQuery({ featureId }).data ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const refreshList = () => void utils.feature.sessions.invalidate({ featureId })
  const openSide = trpc.feature.openSideSession.useMutation({
    onSuccess: ({ sessionId }) => {
      setSelectedId(sessionId)
      refreshList()
      void utils.feature.get.invalidate({ id: featureId })
    },
    onError: (e) => toast.push(e.message),
  })

  const picked = selectedId ? pickedSession(selectedId, list, full.sessions) : null
  const switcher = (name: string) => (
    <SessionSwitcher
      sessions={list}
      selectedId={picked ? picked.id : null}
      name={name}
      onSelect={setSelectedId}
      onNewSide={() => openSide.mutate({ featureId })}
      opening={openSide.isPending}
    />
  )
  const deck = <FeatureNoticeDeck events={events} tickets={full.tickets} active={!hidden} onView={onView} />

  if (picked) {
    const live = picked.status !== 'ended'
    return (
      <ChatView
        label="Agent"
        session={live ? picked : null}
        contextLine={switcher(picked.title)}
        meta={picked.kind === 'scenario' ? 'Docked beside the drive' : 'A side session · everything but the rounds'}
        featureId={featureId}
        onEnded={refreshList}
        transcriptId={picked.id}
        onLaunch={() => openSide.mutate({ featureId, reopenSessionId: picked.id })}
        launchLabel="Reopen"
        launching={openSide.isPending}
        hidden={hidden}
      >
        {deck}
      </ChatView>
    )
  }

  // The main chat's slot. The scenario chat is a feature session too, but it is
  // docked beside the drive and listed in the switcher, never the main view.
  const live = activeSession(full.sessions.filter((s) => s.kind !== 'scenario'))
  const chat = featureChat(full.sessions)
  return (
    <ChatView
      label="Agent"
      session={live ?? null}
      contextLine={switcher(live ? chatContextLine(live) : 'Main chat')}
      meta="Plans the feature · the lead after Go"
      featureId={featureId}
      notices={live && <SessionNotices featureId={featureId} session={live} />}
      headless={
        live && isHeadlessRun(live)
          ? isSelfPlanRun(live)
            ? 'This feature is planning itself. There is no terminal to watch; the plan appears on the Overview as it is written.'
            : 'This feature is working by itself. There is no terminal to watch; its docs and tickets update on the Overview as it works.'
          : undefined
      }
      transcriptId={chat?.id}
      onLaunch={onLaunch}
      launching={launching}
      hidden={hidden}
    >
      {deck}
    </ChatView>
  )
}

/** A session picked in the switcher, as the Chat tab shows it. */
interface PickedSession {
  id: string
  kind: FeatureSessionEntry['kind']
  title: string
  status: FeatureSessionEntry['status']
}

/**
 * The picked session, or null to fall back to the main chat. A side session
 * just opened or reopened is not listed until the CLI picks it up, so its row
 * stands in, Untitled, until then. A scenario chat that ended has left the
 * switcher, and the tab goes back to the main chat rather than an empty pane.
 */
function pickedSession(
  id: string,
  list: readonly FeatureSessionEntry[],
  rows: FeatureFull['sessions'],
): PickedSession | null {
  const listed = list.find((s) => s.id === id)
  if (listed) return listed.kind === 'chat' ? null : listed
  const row = rows.find((s) => s.id === id)
  if (row?.kind === 'side') return { id, kind: 'side', title: 'Untitled', status: row.status }
  // Opened a moment ago, before the feature's rows caught up.
  if (!row) return { id, kind: 'side', title: 'Untitled', status: 'launching' }
  return null
}
