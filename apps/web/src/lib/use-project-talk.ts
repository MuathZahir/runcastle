import { useRef } from 'react'
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

/**
 * The errand a launch is opened on, when "a new chat" does not say it. Only the
 * Notes card has one: its briefing tells the session to triage the open notes.
 */
export type ProjectTalkPurpose = 'triage'

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
  /** Open a new conversation briefed to triage the open notes; no-op while one is open. */
  triage: () => void
  /**
   * End the open conversation and launch a fresh one as one user action. Carries
   * the purpose of whichever door asked, so replacing from "Triage N notes"
   * opens a triage chat rather than a plain one.
   */
  replace: (purpose?: ProjectTalkPurpose) => void
  /** Reopen a specific past conversation; no-op while one is open. */
  resume: (sessionId: string) => void
  /**
   * Resume the conversation the page is showing, because it is showing it
   * (`opening-a-feature-shows-its-chat-as-you-left-it` decision 3): resume only,
   * and a refusal is quiet — no toast.
   */
  autoResume: (sessionId: string) => void
  /**
   * The conversation an automatic resume is bringing back — in flight, or its
   * session still launching — or null.
   */
  autoResuming: string | null
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
  const auto = trpc.project.talkToProject.useMutation({
    // Pending until the page has the session row, so "Resuming…" never
    // flickers back to the button in between.
    onSuccess: () =>
      Promise.all([utils.project.projectSession.invalidate(), utils.project.conversations.invalidate()]),
    onError: () => undefined,
  })
  // What the relaunch after an end is for. Held in a ref rather than passed
  // through the mutation, because the launch happens in `endSession`'s callback
  // — a render later, with nothing of the click left to read.
  const replacing = useRef<ProjectTalkPurpose | undefined>(undefined)
  const end = trpc.feature.endSession.useMutation({
    onSuccess: () =>
      launch.mutate({
        projectId,
        fresh: true,
        ...(replacing.current ? { purpose: replacing.current } : {}),
      }),
    onError: (e) => toast.push(e.message),
  })

  const session = q.data ?? null
  const state = projectSessionState(session)
  // Guarded on the polled state so the doors read as "open the conversation"
  // rather than erroring when one is already up.
  const canLaunch = (): boolean => state === 'none' && !launch.isPending && !auto.isPending
  const autoFrom = auto.variables?.resumeSessionId ?? null
  const autoResuming = (auto.isPending || (auto.isSuccess && session?.status === 'launching')) ? autoFrom : null

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
    triage: () => {
      if (canLaunch()) launch.mutate({ projectId, purpose: 'triage' })
    },
    replace: (purpose) => {
      if (session && !launch.isPending && !end.isPending) {
        replacing.current = purpose
        end.mutate({ sessionId: session.id })
      }
    },
    resume: (sessionId) => {
      if (canLaunch()) launch.mutate({ projectId, resumeSessionId: sessionId })
    },
    autoResume: (sessionId) => {
      if (canLaunch()) auto.mutate({ projectId, resumeSessionId: sessionId, auto: true })
    },
    autoResuming,
    starting: launch.isPending || end.isPending,
  }
}
