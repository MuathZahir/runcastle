import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../../lib/api'
import type { ChatNoticeTarget, StandingNotice } from '../../lib/chat-notices'
import { mainChatInbox } from '../../lib/composer-inbox'
import { READY_TO_TEST } from '../../lib/feature-ui'
import type { ModelPick } from '../../lib/use-thread'
import { FeatureNoticeDeck } from '../chat/FeatureNoticeDeck'
import { scenarioErrandHint } from '../chat/ScenarioChat'
import { ThreadColumn, ThreadOpening } from '../chat/ThreadColumn'
import type { FeatureChatColumn } from '../chat/use-feature-chat-column'
import { useFeatureWorkers, workerColumnProps, workerInFront } from '../workers/WorkerChat'
import { WorkerLinksContext } from '../chat/thread/FeatureCardItems'
import { StartAgent, type StartAgentPress } from './StartAgent'

const MAIN_HINT = 'One chat per feature — it knows the state, answers questions, and plans the work and hands it to workers.'
/** A thread that is neither the lead's, the drive's Scenarios worker nor a listed worker yet: a worker whose row is still on its way. */
const WORKER_PENDING_HINT = 'A worker on this feature, in its own sandbox.'

/**
 * The feature page's chat column (chat-as-web-components decisions 3, 7): the
 * thread in front — the lead's chat, a worker's (a drive worker's too), or an old side or drive chat — through
 * `ThreadColumn`. Opening a thread launches nothing (a-new-feature-waits-for-start
 * decision 1): a new feature's main chat waits on Start ({@link startsItself}),
 * with Plan it yourself beside it and the composer locked until one is pressed.
 * Any other main chat nobody has started is an empty thread whose first message
 * starts it (`start`, the feature's chat launch). The notice strip sits on its
 * composer while it is in view. Its thread list is the sidebar's, under the
 * feature's row (threads-in-the-sidebar).
 */

/**
 * A feature nobody has worked on (decision 14): running, with no session,
 * ticket or round of any kind. Its brief is on disk too: a feature reads active
 * before its docs are written, and an agent started then would have none. Its
 * main chat waits on Start.
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
  onPlanItYourself,
  refusal,
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
  /** The page is launching the chat itself (a draft's Start, a self-planning run, a landing): no Start to offer meanwhile. */
  holdStart: boolean
  /**
   * Start the feature's main chat, holding its opening for the first message or
   * (`holdOpening: false`, Start) saying it now on the human's model pick; answers with its thread.
   */
  start: (opts: { holdOpening: boolean; pick?: ModelPick }) => Promise<string>
  /** Launch the self-planning run on the human's model pick; settles once the page reads it, rejects with the refusal. */
  onPlanItYourself: (pick: ModelPick) => Promise<unknown>
  /** Why the page's own launch of the chat was refused (a backlog Start whose branch was cut): shown under Start. */
  refusal?: string | undefined
  /** Open the panel view a notice points at. */
  onView: (target: ChatNoticeTarget) => void
}) {
  const { inFront, main, scenario } = column
  const isMain = inFront === main
  const isScenario = inFront !== null && inFront === scenario.sessionId
  const entry = column.threads.find((t) => t.id === column.current)
  const workers = useFeatureWorkers(full.feature.id)
  const worker = workerInFront(workers, column.threads, inFront)
  const workerProps = worker && !isMain ? workerColumnProps(worker, full.feature.branch) : null
  // One start at a time: two presses, or a Send during a start, wait on the same launch.
  const starting = useRef<Promise<string> | null>(null)
  // What the locked composer's model controls hold, for a launch with no message to carry it (decision 10).
  const pick = useRef<ModelPick>({})
  const startOnce = (holdOpening: boolean): Promise<string> =>
    (starting.current ??= start({ holdOpening, ...(holdOpening ? {} : { pick: pick.current }) }).finally(() => {
      starting.current = null
    }))
  const startForSend = (): Promise<string> => startOnce(true)

  // The waiting screen (decisions 1, 3, 8): which press is in flight, and what the last one was refused with.
  const [pressed, setPressed] = useState<StartAgentPress | undefined>(undefined)
  const [said, setSaid] = useState<{ refusal?: string } | null>(null)
  const shownRefusal = said ? said.refusal : refusal
  const refused = (e: unknown) => {
    setPressed(undefined)
    setSaid({ refusal: e instanceof Error ? e.message : 'the agent could not be started' })
  }
  const press = (which: StartAgentPress) => {
    if (pressed || starting.current) return
    setPressed(which)
    setSaid({})
    if (which === 'start') {
      startOnce(false).then((threadId) => {
        setPressed(undefined)
        column.started(threadId, { stayOnPicked: true })
      }, refused)
    } else {
      // Its launch holds the page until the feature reads the run, which ends the wait.
      onPlanItYourself(pick.current).then(() => setPressed(undefined), refused)
    }
  }
  // A press of its own keeps the screen through the page's hold, so it shows busy rather than blinking out.
  const waits = isMain && column.listRead && column.main === null && startsItself(full) && (!holdStart || pressed !== undefined)

  if (hidden) return null
  if (column.pending) return <ThreadOpening label="Chat" />
  return (
    // What the lead's handback and failure cards read and open (interactive-workers decision 21).
    <WorkerLinksContext.Provider value={{ workers, openWorker: column.pick }}>
      <ThreadColumn
        // A fresh column per thread: its draft, attachments and scroll are its
        // own. The main chat keeps one through its start, so the first message
        // stays on screen while the chat it started takes its id.
        key={isMain ? 'main' : inFront}
        label={isMain ? 'Agent' : workerProps || isScenario ? 'Worker' : 'Chat'}
        threadId={inFront}
        {...(entry ? { runtime: entry.runtime } : {})}
        {...(isMain
          ? {
              start: startForSend,
              startsAs: { featureId: full.feature.id },
              onStarted: column.started,
              onPick: (p: ModelPick) => {
                pick.current = p
              },
              inbox: mainChatInbox(full.feature.id),
            }
          : {})}
        {...(waits
          ? {
              locked: true,
              empty: (
                <StartAgent
                  onStart={() => press('start')}
                  onPlanItYourself={() => press('selfPlan')}
                  starting={pressed}
                  refusal={shownRefusal}
                />
              ),
            }
          : {})}
        draftKey={`feature:${full.feature.id}:main`}
        emptyHint={isMain ? MAIN_HINT : isScenario ? scenarioErrandHint(scenario.errand) : (workerProps?.emptyHint ?? WORKER_PENDING_HINT)}
        {...(workerProps ? workerProps : isScenario ? {} : { meta: `Feature worktree · ${full.feature.branch}` })}
        notices={alerts}
      >
        <FeatureNoticeDeck
          events={events}
          standing={standing}
          active
          onView={onView}
          readyToTest={full.feature.waitingReason === READY_TO_TEST}
        />
      </ThreadColumn>
    </WorkerLinksContext.Provider>
  )
}
