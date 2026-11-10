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

/** In flight, or a draft marked up next: what keeps a chat's epic in the list. */
function inMotionOrUpNext(f: FeatureListItem): boolean {
  return f.status === 'active' || (f.status === 'draft' && f.upNext)
}

/** The features a thread holds, in flight or up next. The app lists by origin now ({@link originFeatures}); old design pages still read this. */
export function heldFeatures(threadId: string, features: readonly FeatureListItem[]): FeatureListItem[] {
  return features.filter((f) => f.heldBy === threadId && inMotionOrUpNext(f))
}

/**
 * The features a chat cut that are in flight or up next: by origin (`chatId`),
 * whoever runs them now (orchestrator-chats-become-epics decisions 6, 16).
 */
export function originFeatures(threadId: string, features: readonly FeatureListItem[]): FeatureListItem[] {
  return features.filter((f) => f.chatId === threadId && inMotionOrUpNext(f))
}

/**
 * Whether the sidebar lists a chat (the-sidebar-shows-only-active-threads, with
 * orchestrator-chats-become-epics decision 16): it is working or asking, a
 * feature it cut is in flight or up next, it is in front, or the human wrote in
 * it lately, or left words unsent in it. Everything else lives on the Epics page.
 */
export function threadIsActive(
  thread: ThreadEntry,
  {
    current,
    features,
    now,
    drafted = () => false,
  }: {
    current: string | null
    features: readonly FeatureListItem[]
    now: number
    /** Whether the human left words unsent in a thread's composer (`hasDraft`). */
    drafted?: (threadId: string) => boolean
  },
): boolean {
  return (
    thread.state !== 'idle' ||
    thread.id === current ||
    originFeatures(thread.id, features).length > 0 ||
    // Words typed and not yet sent: leaving a new chat must not lose the place they wait in.
    drafted(thread.id) ||
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

/**
 * A feature's epic, its page's first crumb (orchestrator-chats-become-epics
 * decision 15): the orchestrator chat it came from (`chatId`), shipped or not.
 * Null with no origin chat, or one the list does not hold.
 */
export function featureEpic(
  feature: { chatId?: string | null | undefined },
  threads: readonly ThreadEntry[],
): ThreadEntry | null {
  if (!feature.chatId) return null
  return threads.find((t) => t.id === feature.chatId && t.role === 'project') ?? null
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
