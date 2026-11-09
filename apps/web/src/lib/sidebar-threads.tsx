import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { FeatureListItem } from './api'
import { newestThread } from './chat-sessions'
import type { ThreadEntry } from './chat-thread'
import type { WorkerEntry } from './workers'

/**
 * Threads in the sidebar (docs/features/threads-in-the-sidebar): the open page
 * publishes its threads and the sidebar draws them. Only the open feature's or
 * the open Orchestrator's threads are ever listed (decision 1), and the page
 * already holds them (its thread list, the thread in front, how to pick and
 * start one), so the sidebar adds no query of its own.
 */
export interface SidebarThreads {
  /** Whose threads: the open feature's, or the project's (the Orchestrator). */
  scope: { featureId: string } | { projectId: string }
  /** Every thread the page can show, stand-ins included, in any order. */
  threads: readonly ThreadEntry[]
  /** The thread in front; null when none is (the Conversations page). */
  current: string | null
  pick: (threadId: string) => void
  /** New thread: a worker with no assignment on a feature, a new chat on the project. */
  newThread: () => void
  /** The drive's scenario chat while its errand is open: its row's menu closes it. */
  errand?: { threadId: string; close: () => void }
  /** The project's own workers, listed with its chats: a project drive's Scenarios worker (drive-chats-become-workers decision 2). */
  workers?: readonly WorkerEntry[]
  /** The Conversations page, where every conversation is listed ("All N conversations"). */
  allConversations?: () => void
}

const Published = createContext<SidebarThreads | null>(null)
const Publish = createContext<(threads: SidebarThreads | null) => void>(() => {})

/** Under the project shell: what the open page publishes, for the sidebar beside it. */
export function SidebarThreadsProvider({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<SidebarThreads | null>(null)
  return (
    <Publish.Provider value={setThreads}>
      <Published.Provider value={threads}>{children}</Published.Provider>
    </Publish.Provider>
  )
}

/**
 * The page's side: publish its threads on every render and withdraw them on
 * unmount. The page reads only the setter, so publishing never re-renders it.
 */
export function usePublishSidebarThreads(threads: SidebarThreads | null): void {
  const publish = useContext(Publish)
  useEffect(() => {
    publish(threads)
  })
  useEffect(() => () => publish(null), [publish])
}

/** The sidebar's side: what the open page published, or null. */
export function useSidebarThreads(): SidebarThreads | null {
  return useContext(Published)
}

/**
 * The sidebar's order (decision 3): a feature's main chat first, then the rest
 * by when they were started, newest first. An agent posting moves nothing.
 */
export function sidebarThreadOrder(threads: readonly ThreadEntry[]): ThreadEntry[] {
  return [...threads].sort((a, b) => {
    const main = Number(b.role === 'main') - Number(a.role === 'main')
    return main !== 0 ? main : b.createdAt - a.createdAt
  })
}

/** How long writing in a thread keeps it listed: a talk-only thread must not vanish on clicking away. */
export const WRITTEN_KEEPS_LISTED_MS = 24 * 60 * 60 * 1000

/** What a thread holds, as the Orchestrator's list counts it: held, and in flight or up next. */
export function heldFeatures(threadId: string, features: readonly FeatureListItem[]): FeatureListItem[] {
  return features.filter((f) => f.heldBy === threadId && (f.status === 'active' || (f.status === 'draft' && f.upNext)))
}

/**
 * An Orchestrator chat's second line while it asks the human about features it
 * owns (every-feature-has-one-owner decisions 8, 17, 30): "Asking about <the
 * first one>", "+N" for the rest. Null when it asks about none it owns.
 */
export function askingAboutLine(thread: Pick<ThreadEntry, 'id' | 'askingAbout'>, features: readonly FeatureListItem[]): string | null {
  const owned = (thread.askingAbout ?? []).flatMap((id) => features.find((f) => f.id === id && f.heldBy === thread.id) ?? [])
  if (!owned.length) return null
  return `Asking about ${owned[0].title}${owned.length > 1 ? ` +${owned.length - 1}` : ''}`
}

/**
 * Whether the Orchestrator's list shows a thread (the-sidebar-shows-only-active-threads):
 * it is working or asking, it holds something, it is in front, or the human wrote
 * in it lately. Everything else lives on the Conversations page.
 */
export function threadIsActive(
  thread: ThreadEntry,
  { current, features, now }: { current: string | null; features: readonly FeatureListItem[]; now: number },
): boolean {
  return (
    thread.state !== 'idle' ||
    thread.id === current ||
    heldFeatures(thread.id, features).length > 0 ||
    (thread.lastHumanAt !== undefined && now - thread.lastHumanAt < WRITTEN_KEEPS_LISTED_MS)
  )
}

/** Where arriving at the Orchestrator lands. */
export type OrchestratorLanding = { kind: 'chat'; threadId: string } | { kind: 'conversations' } | { kind: 'none' }

/**
 * Arriving with no chat addressed: the active chat that moved last, else the
 * Conversations page, else (a project with no chats) nothing. Scenario chats
 * are never picked.
 */
export function orchestratorLanding(
  threads: readonly ThreadEntry[],
  features: readonly FeatureListItem[],
  now: number,
): OrchestratorLanding {
  if (!threads.some((t) => t.role === 'project')) return { kind: 'none' }
  const active = threads.filter((t) => threadIsActive(t, { current: null, features, now }))
  const threadId = newestThread(active, 'project')
  return threadId ? { kind: 'chat', threadId } : { kind: 'conversations' }
}

/** The thread to name on a feature's page: its holder, while it has not shipped and the list knows it. */
export function featureHolder(
  feature: { status: string; heldBy?: string | undefined },
  threads: readonly ThreadEntry[],
): ThreadEntry | null {
  if (feature.status === 'shipped' || !feature.heldBy) return null
  return threads.find((t) => t.id === feature.heldBy) ?? null
}

/** localStorage key for the rows whose threads the human folded away (decision 10). */
const FOLDED_KEY = 'runcastle.sidebar.foldedThreads'

/** A row's key in the fold memory: a feature id, or the project's Orchestrator. */
export function foldKey(scope: SidebarThreads['scope']): string {
  return 'featureId' in scope ? scope.featureId : `orchestrator:${scope.projectId}`
}

function readFolded(): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Which rows the human folded, kept per browser like the Archived shelf's choice. */
export function useFoldedThreads(): { folded: (key: string) => boolean; toggle: (key: string) => void } {
  const [keys, setKeys] = useState(readFolded)
  const toggle = useCallback((key: string) => {
    setKeys((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]))
      } catch {
        // localStorage unavailable (private mode): the fold still holds in-session
      }
      return next
    })
  }, [])
  return { folded: (key) => keys.has(key), toggle }
}
