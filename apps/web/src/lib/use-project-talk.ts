import { trpc } from '../trpc'
import type { ProjectConversation, ProjectSession } from './api'
import { useLivePoll } from './live'
import { projectSessionState, type ProjectSessionState } from './project-workspace'
import { useToast } from './toast'

/**
 * The project conversation's client half (decision 20). One hook so every
 * surface that touches the session — the rail's pinned row, the project
 * workspace, and the two "talk it through" doors — reads the same polled row and
 * opens the session the same way.
 *
 * Polled on the shared live cadence, alongside the rail's own `feature.list`: the
 * session row is the single source of truth, so a conversation opened or ended
 * anywhere shows up here without a page action.
 */

export interface ProjectTalkApi {
  /** The open conversation, or null when none is. */
  session: ProjectSession
  state: ProjectSessionState
  /** Every conversation this project has had, newest first (decision 5). */
  conversations: ProjectConversation[]
  /** Still fetching the list for the first time — distinct from "there are none". */
  conversationsPending: boolean
  /** Open a NEW conversation; no-op while one is open. */
  start: () => void
  /** Reopen a specific past conversation; no-op while one is open. */
  resume: (sessionId: string) => void
  starting: boolean
}

export function useProjectTalk(projectId: string): ProjectTalkApi {
  const utils = trpc.useUtils()
  const toast = useToast()
  const q = trpc.project.projectSession.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // Same cadence: a conversation's title lands only once the human has said
  // something in it, so the list is live data, not a one-shot fetch.
  const list = trpc.project.conversations.useQuery(
    { projectId },
    { refetchInterval: useLivePoll() },
  )

  const launch = trpc.project.talkToProject.useMutation({
    onSuccess: () => {
      void utils.project.projectSession.invalidate()
      void utils.project.conversations.invalidate()
    },
    // One live project session per project (decision 18). A second launch is
    // refused server-side; it lands as a toast rather than taking the shell down.
    onError: (e) => toast.push(e.message),
  })

  const session = q.data ?? null
  const state = projectSessionState(session)
  // Guarded on the polled state so the doors read as "open the conversation"
  // rather than erroring when one is already up.
  const canLaunch = (): boolean => state === 'none' && !launch.isPending

  return {
    session,
    state,
    conversations: list.data ?? [],
    conversationsPending: list.isPending,
    // `fresh` is the default server-side; sending it anyway makes the New chat
    // click say what it means at the wire, where it can be read back.
    start: () => {
      if (canLaunch()) launch.mutate({ projectId, fresh: true })
    },
    resume: (sessionId) => {
      if (canLaunch()) launch.mutate({ projectId, resumeSessionId: sessionId })
    },
    starting: launch.isPending,
  }
}
