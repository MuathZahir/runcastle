import { useEffect, useRef } from 'react'
import { trpc } from '../trpc'
import type { FeatureFull } from './api'
import { activeSession, featureChat } from './feature-ui'

/**
 * Opening a page resumes the chat it shows
 * (`opening-a-feature-shows-its-chat-as-you-left-it`): no Resume click, and no
 * toast when the server declines — the page just stays at rest with its button.
 *
 * Tried once per visit to a conversation, never in a loop (decision 7). A
 * conversation already up during this visit is not resumed by itself once it
 * ends either: an End the human clicked must stay ended. `visit` is the page's
 * own id; a new one is a new visit and forgets what was tried.
 *
 * `updatedAt` is when the data behind `resumable` and `live` was fetched. Data
 * older than the visit is the cache from the last one, and it can still show a
 * chat live that the leave timer closed while the human was away — read as "up
 * during this visit", that would keep the chat at rest for good. So nothing is
 * read or tried until the page has data fetched since the visit began.
 */
export function useAutoResumeOnce({
  visit,
  resumable,
  live = null,
  updatedAt,
  resume,
}: {
  visit: string
  /** The conversation at rest that may resume itself now, or null. */
  resumable: string | null
  /** The conversation up right now, if any. */
  live?: string | null
  /** When the data behind `resumable` and `live` was fetched (ms epoch); absent, it is trusted. */
  updatedAt?: number
  resume: (conversation: string) => void
}): void {
  const tried = useRef<{ visit: string; since: number; conversations: Set<string> } | null>(null)
  const latestResume = useRef(resume)
  latestResume.current = resume
  useEffect(() => {
    if (tried.current?.visit !== visit) tried.current = { visit, since: Date.now(), conversations: new Set() }
    const { since, conversations } = tried.current
    if (updatedAt !== undefined && updatedAt < since) return
    if (live) conversations.add(live)
    if (!resumable || conversations.has(resumable)) return
    conversations.add(resumable)
    latestResume.current(resumable)
  }, [visit, resumable, live, updatedAt])
}

/**
 * The feature conversation opening this feature should resume, keyed by its
 * Claude Code id: only while the feature is in progress (decision 4), nothing is
 * up, and its chat ended with a conversation on record. The server is the final
 * judge — a gone transcript or a held feature is refused there.
 */
export function featureAutoResumeTarget(full: Pick<FeatureFull, 'feature' | 'sessions'>): string | null {
  if (full.feature.status !== 'active' || activeSession(full.sessions)) return null
  const chat = featureChat(full.sessions)
  return chat?.status === 'ended' && chat.ccSessionId ? chat.ccSessionId : null
}

/**
 * The feature page's automatic resume: fired from the chat column without
 * landing on the chat or moving the panel. Its own mutation, so the manual
 * Resume keeps its toast while this one stays quiet. `autoResuming` holds until
 * the session it started is the one the page shows, which `ChatView` keeps at
 * rest with "Resuming…" until it reports live.
 */
export function useFeatureAutoResume(
  featureId: string,
  full: FeatureFull | undefined,
  updatedAt?: number,
): { autoResuming: boolean } {
  const utils = trpc.useUtils()
  const auto = trpc.feature.launchSession.useMutation({
    // Pending until the page has the session row, so "Resuming…" never
    // flickers back to the button in between.
    onSuccess: () =>
      Promise.all([
        utils.feature.get.invalidate({ id: featureId }),
        utils.feature.list.invalidate(),
        utils.events.invalidate(),
      ]),
    // A refusal is the page staying at rest — never a toast.
    onError: () => undefined,
  })
  const live = full ? activeSession(full.sessions) : undefined
  const liveChat = full ? featureChat(full.sessions) : undefined
  useAutoResumeOnce({
    visit: featureId,
    resumable: full ? featureAutoResumeTarget(full) : null,
    live: liveChat?.status !== 'ended' ? (liveChat?.ccSessionId ?? null) : null,
    updatedAt,
    resume: () => auto.mutate({ featureId, kind: 'chat', auto: true }),
  })
  const started = auto.data && 'sessionId' in auto.data ? auto.data.sessionId : undefined
  return { autoResuming: auto.isPending || (!!live && live.id === started) }
}
