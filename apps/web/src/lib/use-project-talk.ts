import { trpc } from '../trpc'
import type { ProjectSession } from './api'
import { useLivePoll } from './live'
import { projectSessionState, type ProjectSessionState } from './project-workspace'
import { useToast } from './toast'

/**
 * The project conversation's client half (decision 20). One hook so the rail's
 * pinned row and the project workspace read the same polled row.
 *
 * A project has any number of chats, running side by side
 * (chat-as-web-components decision 14): New chat opens an empty thread through
 * `thread.new` wherever it is asked for, so this hook only reports the newest
 * running chat and opens the one purpose door that briefs a chat itself.
 */

export interface ProjectTalkApi {
  /** The newest running conversation, or null when none runs. */
  session: ProjectSession
  state: ProjectSessionState
  /** Open a new chat briefed to triage the open notes, beside any already running; `onOpened` gets its thread. */
  triage: (onOpened: (threadId: string) => void) => void
  triaging: boolean
}

export function useProjectTalk(projectId: string): ProjectTalkApi {
  const utils = trpc.useUtils()
  const toast = useToast()
  const q = trpc.project.projectSession.useQuery({ projectId }, { refetchInterval: useLivePoll() })

  const launch = trpc.project.talkToProject.useMutation({
    onSuccess: () => {
      void utils.project.projectSession.invalidate()
      void utils.thread.list.invalidate({ projectId })
    },
    onError: (e) => toast.push(e.message),
  })

  const session = q.data ?? null
  return {
    session,
    state: projectSessionState(session),
    triage: (onOpened) => {
      if (!launch.isPending) launch.mutate({ projectId, purpose: 'triage' }, { onSuccess: ({ sessionId }) => onOpened(sessionId) })
    },
    triaging: launch.isPending,
  }
}
