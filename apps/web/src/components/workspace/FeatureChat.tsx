import type { ReactNode } from 'react'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import type { ChatNoticeTarget } from '../../lib/chat-notices'
import { mainChatInbox } from '../../lib/composer-inbox'
import { FeatureNoticeDeck } from '../chat/FeatureNoticeDeck'
import { scenarioErrandHint } from '../chat/ScenarioChat'
import { ThreadColumn, ThreadOpening } from '../chat/ThreadColumn'
import type { FeatureChatColumn } from '../chat/use-feature-chat-column'

const MAIN_HINT = 'One chat per feature — it knows the state, answers questions, and plans and runs the rounds that build it.'
const SIDE_HINT = 'A fresh conversation on this feature, beside the feature chat. It knows the feature, its docs and its tickets.'

/**
 * The feature page's chat column (chat-as-web-components decisions 3, 7): the
 * thread in front — the main chat, a side thread or a scenario chat — through
 * `ThreadColumn`. Opening it never launches anything; a main chat nobody has
 * started is an empty thread whose first message starts it (`start`, the
 * feature's chat launch). The notice deck floats over it while it is in view.
 * Its thread list is the page header's (`ThreadSwitcher`).
 */
export function FeatureChat({
  full,
  column,
  events,
  alerts,
  hidden,
  start,
  onView,
}: {
  full: FeatureFull
  column: FeatureChatColumn
  /** The feature's event log, which feeds the notice deck over the chat. */
  events: readonly EventRow[]
  /** The page's dismissible notices, at the top of the column (a failed resume, a drive's prerequisites). */
  alerts?: ReactNode
  /** The panel has the whole row. */
  hidden: boolean
  /** Start the feature's main chat; answers with its thread. */
  start: () => Promise<string>
  /** Open the panel view a notice points at. */
  onView: (target: ChatNoticeTarget) => void
}) {
  const { inFront, main, scenario } = column
  const isMain = inFront === main
  const isScenario = inFront !== null && inFront === scenario.sessionId
  const entry = column.threads.find((t) => t.id === column.current)
  if (hidden) return null
  if (column.pending) return <ThreadOpening label="Thread" />
  return (
    <ThreadColumn
      // A fresh column per thread: its draft, attachments and scroll are its
      // own. The main chat keeps one through its start, so the first message
      // stays on screen while the chat it started takes its id.
      key={isMain ? 'main' : inFront}
      label={isMain ? 'Agent' : isScenario ? 'Scenario chat' : 'Thread'}
      threadId={inFront}
      {...(entry ? { runtime: entry.runtime } : {})}
      {...(isMain ? { start, startsAs: { featureId: full.feature.id }, onStarted: column.started, inbox: mainChatInbox(full.feature.id) } : {})}
      draftKey={`feature:${full.feature.id}:main`}
      onOpenThread={column.pick}
      emptyHint={isMain ? MAIN_HINT : isScenario ? scenarioErrandHint(scenario.errand) : SIDE_HINT}
      {...(isScenario ? {} : { meta: `Feature worktree · ${full.feature.branch}` })}
      notices={alerts}
    >
      <FeatureNoticeDeck events={events} tickets={full.tickets} active onView={onView} />
    </ThreadColumn>
  )
}
