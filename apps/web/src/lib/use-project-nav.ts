import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { initialView, type AppView } from './projects'
import type { Project } from './api'

/**
 * Multi-project navigation state (issue #45). Owns the top-level view and the
 * currently-bound project. On the first list load it lands per {@link initialView}
 * — strictly by open-project count, every launch — then follows explicit
 * navigation. Switching projects never touches the server, so background runs
 * are undisturbed.
 */

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
  const q = trpc.project.list.useQuery(undefined, { refetchInterval: 5000 })
  const projects = q.data

  const [view, setView] = useState<AppView>('home')
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null)
  const didInit = useRef(false)

  // First successful load decides where to land, purely by project count
  // (acceptance criteria): 0 → open flow, 1 → straight in, 2+ → home.
  useEffect(() => {
    if (didInit.current || !projects) return
    didInit.current = true
    const init = initialView(projects)
    setView(init.view)
    setCurrentProjectId(init.projectId)
  }, [projects])

  // If the bound project disappears (closed elsewhere), fall back gracefully.
  useEffect(() => {
    if (!projects || !didInit.current) return
    if (view === 'project' && !projects.some((p) => p.id === currentProjectId)) {
      const init = initialView(projects)
      setView(init.view)
      setCurrentProjectId(init.projectId)
    }
  }, [projects, view, currentProjectId])

  const goHome = useCallback(() => setView('home'), [])
  const enterProject = useCallback((projectId: string) => {
    setCurrentProjectId(projectId)
    setView('project')
  }, [])
  const showOpen = useCallback(() => setView('open'), [])
  const cancelOpen = useCallback(() => {
    setView((v) => (v === 'open' ? (currentProjectId ? 'project' : 'home') : v))
  }, [currentProjectId])

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
