import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import type { ChatNoticeTarget, StandingNotice } from '../../lib/chat-notices'
import { mainChatInbox } from '../../lib/composer-inbox'
import { useToast } from '../../lib/toast'
import { FeatureNoticeDeck } from '../chat/FeatureNoticeDeck'
import { scenarioErrandHint } from '../chat/ScenarioChat'
import { ThreadColumn, ThreadOpening } from '../chat/ThreadColumn'
import type { FeatureChatColumn } from '../chat/use-feature-chat-column'

const MAIN_HINT = 'One chat per feature — it knows the state, answers questions, and plans and runs the rounds that build it.'
const SIDE_HINT = 'A fresh conversation on this feature, beside the feature chat. It knows the feature, its docs and its tickets.'

/**
 * The feature page's chat column (chat-as-web-components decisions 3, 7): the
 * thread in front — the main chat, a side thread or a scenario chat — through
 * `ThreadColumn`. Opening a thread launches nothing, with one exception: a new
 * feature's main chat starts itself the first time the human can see it, so its
 * agent speaks first ({@link startsItself}). Any other main chat nobody has
 * started is an empty thread whose first message starts it (`start`, the
 * feature's chat launch). The notice strip sits on its composer while it is in view.
 * Its thread list is the sidebar's, under the feature's row (threads-in-the-sidebar).
 */
const subscribeVisibility = (changed: () => void): (() => void) => {
  document.addEventListener('visibilitychange', changed)
  return () => document.removeEventListener('visibilitychange', changed)
}

/**
 * A feature nobody has worked on (decision 14): running, with no session,
 * ticket or round of any kind. Its brief is on disk too: a feature reads active
 * before its docs are written, and an agent started then would have none.
 */
export function startsItself({ feature, sessions, tickets, runs, docs }: FeatureFull): boolean {
  const unworked = sessions.length === 0 && tickets.length === 0 && runs.length === 0
  return feature.status === 'active' && unworked && docs.some((d) => d.relPath === 'brief.md')
}

export function FeatureChat({
  full,
  column,
  events,
  alerts,
  standing,
  hidden,
  holdStart,
  start,
  onView,
}: {
  full: FeatureFull
  column: FeatureChatColumn
  /** The feature's event log, which feeds the notice strip on the composer. */
  events: readonly EventRow[]
  /** The page's dismissible notices, at the top of the column (a failed resume, a drive's prerequisites). */
  alerts?: ReactNode
  /** The warnings that stand on the notice strip while their condition holds (a merge conflict, a refused review drive). */
  standing?: readonly StandingNotice[]
  /** The panel has the whole row. */
  hidden: boolean
  /** The chat must not start itself now: the human has not opened it, or the page is launching it (a Start, a self-planning run). */
  holdStart: boolean
  /** Start the feature's main chat, holding its opening for the first message or (`holdOpening: false`) saying it now; answers with its thread. */
  start: (opts: { holdOpening: boolean }) => Promise<string>
  /** Open the panel view a notice points at. */
  onView: (target: ChatNoticeTarget) => void
}) {
  const { inFront, main, scenario } = column
  const isMain = inFront === main
  const isScenario = inFront !== null && inFront === scenario.sessionId
  const entry = column.threads.find((t) => t.id === column.current)
  const toast = useToast()
  const tabVisible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => true)
  // One start at a time: a Send during the chat's own start waits on that start, and says any refusal itself.
  const starting = useRef<Promise<string> | null>(null)
  const sendWaits = useRef(false)
  const startOnce = (holdOpening: boolean): Promise<string> =>
    (starting.current ??= start({ holdOpening }).finally(() => {
      starting.current = null
    }))
  const startForSend = (): Promise<string> => {
    sendWaits.current = starting.current !== null
    return startOnce(true)
  }
  // Once per open of the page, so a refused start tries again on the next open (decision 11).
  const asked = useRef(false)
  const shown = !hidden && !column.pending && tabVisible && isMain
  const opens = shown && !holdStart && column.listRead && column.main === null && startsItself(full)
  useEffect(() => {
    if (!opens || asked.current) return
    asked.current = true
    startOnce(false).then(
      (threadId) => column.started(threadId, { stayOnPicked: true }),
      (e: unknown) => {
        if (!sendWaits.current) toast.push(e instanceof Error ? e.message : 'the chat could not be started')
      },
    )
  }, [opens])
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
      {...(isMain ? { start: startForSend, startsAs: { featureId: full.feature.id }, onStarted: column.started, inbox: mainChatInbox(full.feature.id) } : {})}
      draftKey={`feature:${full.feature.id}:main`}
      onOpenThread={column.pick}
      emptyHint={isMain ? MAIN_HINT : isScenario ? scenarioErrandHint(scenario.errand) : SIDE_HINT}
      {...(isScenario ? {} : { meta: `Feature worktree · ${full.feature.branch}` })}
      notices={alerts}
    >
      <FeatureNoticeDeck events={events} tickets={full.tickets} standing={standing} active onView={onView} />
    </ThreadColumn>
  )
}
