import { useEffect, useState } from 'react'
import type { FeatureFull } from '../../lib/api'
import { NEW_CHAT_NAME, UNSTARTED_CHAT, newestThread, scenarioChatLabel, standIn, withStandIns } from '../../lib/chat-sessions'
import type { ThreadEntry } from '../../lib/chat-thread'
import { mainChatInbox, subscribeInbox } from '../../lib/composer-inbox'
import { featureChat } from '../../lib/feature-ui'
import { useLivePoll } from '../../lib/live'
import { useAddressedThread, useThreadInUrl } from '../../lib/use-history-sync'
import { useToast } from '../../lib/toast'
import { trpc } from '../../trpc'
import { useScenarioChat, type ScenarioChatApi } from './ScenarioChat'

export interface FeatureChatColumn {
  /** The drive errand's chat — what the page provides to the drive through `ScenarioChatContext`. */
  scenario: ScenarioChatApi
  /** The feature's thread list, which the sidebar draws under its row. */
  threads: ThreadEntry[]
  /** The feature's main chat thread; null while nobody has started it. */
  main: string | null
  /** The thread list has been read, so a null `main` means there is none. */
  listRead: boolean
  /**
   * Whether the main chat is working, waiting on the human or idle, as the
   * thread list reads its log; undefined while the list does not hold it.
   */
  mainState: ThreadEntry['state'] | undefined
  /** The thread in front; null is the main chat nobody has started yet. */
  inFront: string | null
  /**
   * The address names a thread the thread list has not yet vouched for: the
   * column shows it opening, never the main chat, and nothing can be sent.
   */
  pending: boolean
  /** The thread list's id for what is in front. */
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
 * chats, finished ones included — listed in the sidebar, one in front. An
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
  const listQ = trpc.thread.list.useQuery({ featureId }, { refetchInterval: useLivePoll() })
  const listed = listQ.data ?? []
  const [started, setStarted] = useState<string | null>(null)
  const main = newestThread(listed, 'main') ?? started ?? featureChat(sessions)?.id ?? null
  // A reload or a pasted link opens the thread the address names — when it is this feature's.
  const {
    front: picked,
    pick: setPicked,
    pending,
  } = useAddressedThread(
    null,
    listQ.data ? (id) => id === main || id === driveSessionId || listed.some((t) => t.id === id) : null,
  )
  const scenario = useScenarioChat(driveSessionId, setPicked)
  const closedErrand = picked !== null && picked === scenario.sessionId && !scenario.listed
  const inFront = picked !== null && !closedErrand ? picked : main
  useThreadInUrl(pending ? undefined : inFront)

  useEffect(() => subscribeInbox(mainChatInbox(featureId), () => setPicked(null)), [featureId])

  const create = trpc.thread.new.useMutation({
    onSuccess: ({ threadId }) => {
      setPicked(threadId)
      void utils.thread.list.invalidate({ featureId })
    },
    onError: (e) => toast.push(e.message),
  })

  // A thread the list does not hold yet has nothing said in it: "New chat",
  // never its kind (decision 14).
  const threads = withStandIns(listed, [
    standIn(main ?? UNSTARTED_CHAT, NEW_CHAT_NAME, 'main'),
    ...(inFront && inFront !== main
      ? [
          inFront === scenario.sessionId
            ? standIn(inFront, scenarioChatLabel(scenario.errand), 'scenario')
            : standIn(inFront, NEW_CHAT_NAME, 'side'),
        ]
      : []),
  ])

  return {
    scenario,
    threads,
    main,
    listRead: listQ.data !== undefined,
    mainState: listed.find((t) => t.id === main)?.state,
    inFront,
    pending: pending !== null,
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
