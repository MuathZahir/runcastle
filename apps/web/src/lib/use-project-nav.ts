import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { useLivePoll } from './live'
import {
  initialView,
  restoredView,
  type AppView,
  type Landing,
  type StoredNav,
} from './projects'
import type { Project } from './api'

/**
 * Multi-project navigation state (issue #45). Owns the top-level view and the
 * currently-bound project. On the first list load it lands per
 * {@link restoredView} — back where the last session left off — then follows
 * explicit navigation. Switching projects never touches the server, so
 * background runs are undisturbed.
 *
 * The landing used to be re-derived from open-project count on every launch,
 * which meant anyone with two projects open paid for a refresh by going through
 * the chooser again. Where you were is now persisted, the same way the feature
 * you had selected inside a project already is (`lib/workspace.ts`).
 */

const NAV_KEY = 'runcastle.project.v1'

/** Reads the persisted navigation, treating unusable storage as none stored. */
export function readStoredNav(): StoredNav | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(NAV_KEY)
  } catch {
    return null // storage may be unavailable (private mode) — non-fatal
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const nav = parsed as Partial<StoredNav>
    if (nav.view === 'home') return { view: 'home' }
    if (nav.view === 'project' && typeof nav.projectId === 'string') {
      return { view: 'project', projectId: nav.projectId }
    }
    return null
  } catch {
    return null // hand-edited or half-written — land by the usual rule instead
  }
}

/** Remembers where the user navigated to, for the next load. */
export function writeStoredNav(nav: StoredNav): void {
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify(nav))
  } catch {
    // storage may be unavailable (private mode) — non-fatal
  }
}

export interface ProjectNavApi {
  /** Open projects (undefined while the first list load is in flight). */
  projects: Project[] | undefined
  loading: boolean
  view: AppView
  currentProjectId: string | null
  currentProject: Project | undefined
  /** Show the portfolio home. */
  goHome: () => void
  /** Enter a project's IDE (switch is view-only — background runs keep going). */
  enterProject: (projectId: string) => void
  /** Show the open-a-project flow (from home, the switcher, or empty state). */
  showOpen: () => void
  /** Leave the open flow back to the home / current project. */
  cancelOpen: () => void
}

export function useProjectNav(): ProjectNavApi {
  const q = trpc.project.list.useQuery(undefined, { refetchInterval: useLivePoll(5000) })
  const projects = q.data

  // Read once, at mount: where the last session left off.
  const [stored] = useState(readStoredNav)
  // Null until the user navigates.
  const [chosen, setChosen] = useState<Landing | null>(null)
  // The landing is resolved *during* the first render that has the list, not in
  // an effect afterwards — an effect would paint the chooser for a frame on the
  // way into the restored project. Latched once resolved, so a project opened
  // elsewhere later cannot re-decide where the user is standing.
  const resolved = useRef<Landing | null>(null)
  if (!resolved.current && projects) resolved.current = restoredView(projects, stored)

  const landing = chosen ?? resolved.current
  const view: AppView = landing?.view ?? 'home'
  const currentProjectId = landing?.projectId ?? null

  // If the bound project disappears (closed elsewhere), fall back gracefully.
  useEffect(() => {
    if (!projects || !landing) return
    if (landing.view === 'project' && !projects.some((p) => p.id === landing.projectId)) {
      setChosen(initialView(projects))
    }
  }, [projects, landing])

  // Deliberate navigation is what gets remembered — the chooser as much as a
  // project, so choosing to sit on the portfolio survives a reload too. The
  // open-a-project flow is not: it is somewhere you pass through.
  const goHome = useCallback(() => {
    setChosen({ view: 'home', projectId: null })
    writeStoredNav({ view: 'home' })
  }, [])
  const enterProject = useCallback((projectId: string) => {
    setChosen({ view: 'project', projectId })
    writeStoredNav({ view: 'project', projectId })
  }, [])
  const showOpen = useCallback(
    () => setChosen({ view: 'open', projectId: currentProjectId }),
    [currentProjectId],
  )
  const cancelOpen = useCallback(() => {
    if (view !== 'open') return
    setChosen(
      currentProjectId
        ? { view: 'project', projectId: currentProjectId }
        : { view: 'home', projectId: null },
    )
  }, [view, currentProjectId])

  const currentProject = projects?.find((p) => p.id === currentProjectId)

  return {
    projects,
    loading: q.isLoading,
    view,
    currentProjectId,
    currentProject,
    goHome,
    enterProject,
    showOpen,
    cancelOpen,
  }
}
