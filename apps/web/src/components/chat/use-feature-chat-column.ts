import { useEffect, useState } from 'react'
import type { FeatureFull } from '../../lib/api'
import { UNSTARTED_CHAT, newestThread, scenarioChatLabel, standIn, withStandIns } from '../../lib/chat-sessions'
import type { ThreadEntry } from '../../lib/chat-thread'
import { mainChatInbox, subscribeInbox } from '../../lib/composer-inbox'
import { featureChat } from '../../lib/feature-ui'
import { useLivePoll } from '../../lib/live'
import { useToast } from '../../lib/toast'
import { trpc } from '../../trpc'
import { useScenarioChat, type ScenarioChatApi } from './ScenarioChat'

export interface FeatureChatColumn {
  /** The drive errand's chat — what the page provides to the drive through `ScenarioChatContext`. */
  scenario: ScenarioChatApi
  /** The header's thread list. */
  threads: ThreadEntry[]
  /** The feature's main chat thread; null while nobody has started it. */
  main: string | null
  /** The thread in front; null is the main chat nobody has started yet. */
  inFront: string | null
  /** The switcher's id for what is in front. */
  current: string
  pick: (id: string) => void
  /** New thread: a side thread, brought to the front. */
  newThread: () => void
  /** The unstarted main chat got its thread on its first message. */
  started: (threadId: string) => void
}

/**
 * The feature page's chat column (chat-as-web-components decision 7): every
 * thread of the feature — its main chat, side threads, scenario and Fix-it
 * chats, finished ones included — listed in the header, one in front. An
 * errand's open, or a new thread, brings its thread to the front; closing the
 * errand hands the column back to the main chat. A Select area crop for the
 * main chat brings it to the front too.
 */
export function useFeatureChatColumn({
  featureId,
  sessions,
  driveSessionId,
}: {
  featureId: string
  /** The feature's sessions: the main chat's row while the thread list cannot be read. */
  sessions: FeatureFull['sessions']
  /** The live drive's record of its scenario chat. */
  driveSessionId: string | undefined
}): FeatureChatColumn {
  const toast = useToast()
  const utils = trpc.useUtils()
  // Invalidated by every `thread` live signal (lib/live.ts).
  const listed = trpc.thread.list.useQuery({ featureId }, { refetchInterval: useLivePoll() }).data ?? []
  const [started, setStarted] = useState<string | null>(null)
  const main = newestThread(listed, 'main') ?? started ?? featureChat(sessions)?.id ?? null
  const [picked, setPicked] = useState<string | null>(null)
  const scenario = useScenarioChat(driveSessionId, setPicked)
  const closedErrand = picked !== null && picked === scenario.sessionId && !scenario.listed
  const inFront = picked !== null && !closedErrand ? picked : main

  useEffect(() => subscribeInbox(mainChatInbox(featureId), () => setPicked(null)), [featureId])

  const create = trpc.thread.new.useMutation({
    onSuccess: ({ threadId }) => {
      setPicked(threadId)
      void utils.thread.list.invalidate({ featureId })
    },
    onError: (e) => toast.push(e.message),
  })

  const threads = withStandIns(listed, [
    standIn(main ?? UNSTARTED_CHAT, 'Feature chat', 'main'),
    ...(inFront && inFront !== main
      ? [
          inFront === scenario.sessionId
            ? standIn(inFront, scenarioChatLabel(scenario.errand), 'scenario')
            : standIn(inFront, 'New thread', 'side'),
        ]
      : []),
  ])

  return {
    scenario,
    threads,
    main,
    inFront,
    current: inFront ?? UNSTARTED_CHAT,
    pick: (id) => setPicked(id === UNSTARTED_CHAT || id === main ? null : id),
    newThread: () => create.mutate({ featureId }),
    started: (threadId) => {
      setStarted(threadId)
      setPicked(null)
      void utils.thread.list.invalidate({ featureId })
    },
  }
}
