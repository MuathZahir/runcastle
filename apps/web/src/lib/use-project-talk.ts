import { trpc } from '../trpc'
import type { ProjectSession } from './api'
import { projectSessionState, type ProjectSessionState } from './project-workspace'
import { useToast } from './toast'

/**
 * The project conversation's client half (decision 20). One hook so every
 * surface that touches the session — the rail's pinned row, the project
 * workspace, and the two "talk it through" doors — reads the same polled row and
 * opens the session the same way.
 *
 * Polled at 1.5s alongside the rail's own `feature.list` poll: the session row is
 * the single source of truth, so a conversation opened or ended anywhere shows up
 * here without a page action.
 */

export interface ProjectTalkApi {
  /** The open conversation, or null when none is. */
  session: ProjectSession
  state: ProjectSessionState
  /** Launch the conversation (the server resumes the last one); no-op while open. */
  start: () => void
  starting: boolean
}

export function useProjectTalk(projectId: string): ProjectTalkApi {
  const utils = trpc.useUtils()
  const toast = useToast()
  const q = trpc.project.projectSession.useQuery({ projectId }, { refetchInterval: 1500 })

  const launch = trpc.project.talkToProject.useMutation({
    onSuccess: () => void utils.project.projectSession.invalidate(),
    // One live project session per project (decision 18). A second launch is
    // refused server-side; it lands as a toast rather than taking the shell down.
    onError: (e) => toast.push(e.message),
  })

  const session = q.data ?? null
  const state = projectSessionState(session)

  return {
    session,
    state,
    // Guarded on the polled state so the doors read as "open the conversation"
    // rather than erroring when one is already up.
    start: () => {
      if (state === 'none' && !launch.isPending) launch.mutate({ projectId })
    },
    starting: launch.isPending,
  }
}
