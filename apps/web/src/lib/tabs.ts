import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Typed workspace tabs (UI-SPEC §2). Every tab belongs to a feature; the active
 * tab's feature drives the Inspector. Open-tab set + active id persist in
 * localStorage so a reload restores the workspace (S8).
 */
export type Tab =
  | { kind: 'overview'; featureId: string }
  | { kind: 'terminal'; featureId: string; sessionId: string }
  | { kind: 'tickets'; featureId: string }
  | { kind: 'run'; featureId: string; runId: string }

export type TabKind = Tab['kind']

/** Client-tracked active test drive (UI-SPEC §2 status bar). At most one, since
 *  the server allows at most one active test drive globally. */
export interface DriveState {
  featureId: string
  branch: string
}

/** Stable identity for a tab (dedupe key + localStorage-safe React key). */
export function tabId(tab: Tab): string {
  switch (tab.kind) {
    case 'overview':
      return `overview:${tab.featureId}`
    case 'terminal':
      return `terminal:${tab.sessionId}`
    case 'tickets':
      return `tickets:${tab.featureId}`
    case 'run':
      return `run:${tab.runId}`
  }
}

const STORAGE_KEY = 'runcastle.tabs.v2'

interface Persisted {
  tabs: Tab[]
  activeId: string | null
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tabs: [], activeId: null }
    const parsed = JSON.parse(raw) as Persisted
    if (!Array.isArray(parsed.tabs)) return { tabs: [], activeId: null }
    return { tabs: parsed.tabs, activeId: parsed.activeId ?? null }
  } catch {
    return { tabs: [], activeId: null }
  }
}

export interface TabsApi {
  tabs: Tab[]
  activeId: string | null
  activeTab: Tab | null
  /** Open (dedupe by identity) and focus a tab. */
  open: (tab: Tab) => void
  /** Focus an already-open tab by id. */
  focus: (id: string) => void
  /** Close a tab; picks a neighbour as the new active. */
  close: (id: string) => void
  /** Open/focus a feature's overview tab (sidebar click). */
  openFeature: (featureId: string) => void
}

export function useTabs(): TabsApi {
  const [state, setState] = useState<Persisted>(load)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // storage may be unavailable (private mode) — non-fatal
    }
  }, [state])

  const open = useCallback((tab: Tab) => {
    setState((prev) => {
      const id = tabId(tab)
      const exists = prev.tabs.some((t) => tabId(t) === id)
      return {
        tabs: exists ? prev.tabs : [...prev.tabs, tab],
        activeId: id,
      }
    })
  }, [])

  const focus = useCallback((id: string) => {
    setState((prev) =>
      prev.tabs.some((t) => tabId(t) === id) ? { ...prev, activeId: id } : prev,
    )
  }, [])

  const close = useCallback((id: string) => {
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => tabId(t) === id)
      if (idx < 0) return prev
      const tabs = prev.tabs.filter((t) => tabId(t) !== id)
      let activeId = prev.activeId
      if (prev.activeId === id) {
        const neighbour = tabs[idx] ?? tabs[idx - 1] ?? null
        activeId = neighbour ? tabId(neighbour) : null
      }
      return { tabs, activeId }
    })
  }, [])

  const openFeature = useCallback(
    (featureId: string) => open({ kind: 'overview', featureId }),
    [open],
  )

  const activeTab =
    state.tabs.find((t) => tabId(t) === state.activeId) ?? null

  return {
    tabs: state.tabs,
    activeId: state.activeId,
    activeTab,
    open,
    focus,
    close,
    openFeature,
  }
}
