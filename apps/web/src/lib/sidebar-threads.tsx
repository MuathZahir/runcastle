import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThreadEntry } from './chat-thread'

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
  /** New thread: a side thread on a feature, a new chat on the project. */
  newThread: () => void
  /** The drive's scenario chat while its errand is open: its row's menu closes it. */
  errand?: { threadId: string; close: () => void }
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
