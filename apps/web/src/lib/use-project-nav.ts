import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { setupComplete } from './first-run'
import { useLivePoll } from './live'
import {
  launchView,
  replacementLanding,
  type AppView,
  type Landing,
  type StoredNav,
} from './projects'
import { parsePath, pathFor, projectIdOf } from './routes'
import { currentPath, pushPath, replacePath } from './use-history-sync'
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
 *
 * This layer owns the PROJECT half of the URL (decision 1): which project the
 * address names, and the `/` that is the portfolio home. Everything deeper —
 * the feature, the chat, preparation — belongs to `ProjectShell`, which is the
 * only place that can turn a feature slug into an id. The two never fight: this
 * hook writes only when the project itself changes, and a project change
 * remounts `ProjectShell`, whose own first write is a replace.
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
  /** True until both facts the landing is decided from have arrived. */
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
  // Onboarding is decided from what the host actually has, not from an empty
  // projects table (decision 3), so the doctor is the landing's second input.
  const doctor = trpc.setup.doctor.useQuery(undefined, { refetchOnWindowFocus: false })

  // Read once, at mount: where the last session left off, and where the address
  // bar says we are. The URL wins where it names a project; a bare `/` is a
  // launch, not an opinion, and leaves the answer to storage (decision 1).
  const [stored] = useState(readStoredNav)
  const [urlLocation] = useState(() => parsePath(currentPath()))
  // Null until the user navigates.
  const [chosen, setChosen] = useState<Landing | null>(null)
  // The landing is resolved *during* the first render that has the list, not in
  // an effect afterwards — an effect would paint the chooser for a frame on the
  // way into the restored project. Latched once resolved, so a project opened
  // elsewhere later cannot re-decide where the user is standing.
  const resolved = useRef<Landing | null>(null)
  // A doctor still in flight leaves the landing unresolved rather than assuming
  // an answer: guessing "set up" flashes the home, guessing "not set up" flashes
  // the wizard at someone who finished onboarding months ago. A doctor that
  // failed outright reads as no evidence of setup, which is the safe way to be
  // wrong — the wizard can be walked out of, a missing runtime cannot.
  if (!resolved.current && projects && !doctor.isLoading) {
    resolved.current = launchView(
      projects,
      urlLocation,
      stored,
      setupComplete(doctor.data?.results ?? []),
    )
  }

  const landing = chosen ?? resolved.current
  const view: AppView = landing?.view ?? 'home'
  const currentProjectId = landing?.projectId ?? null

  // Whether the address has been squared with the resolved landing yet.
  const normalized = useRef(false)

  // If the list moves out from under where the user is standing — the bound
  // project closed elsewhere, or the last card removed from the home — fall
  // back to the landing rule rather than leaving them on a surface that is no
  // longer about anything.
  useEffect(() => {
    if (!projects || !landing) return
    const replacement = replacementLanding(landing, projects)
    if (replacement) {
      // Re-arm the normalizer: the address may still name the surface that is
      // gone.
      normalized.current = false
      setChosen(replacement)
    }
  }, [projects, landing])

  // The address the resolved landing implies, written once. A launch is one
  // place however it was decided, so this is a replace, never a push — see
  // `replacePath`.
  useEffect(() => {
    if (normalized.current || !landing) return
    normalized.current = true
    if (landing.view === 'project' && landing.projectId) {
      // Only the project part: `ProjectShell` refines this to the feature, the
      // chat or preparation as soon as its list lands.
      if (projectIdOf(parsePath(currentPath()) ?? { kind: 'home' }) !== landing.projectId) {
        replacePath(pathFor({ kind: 'project', projectId: landing.projectId }))
      }
    } else {
      // The portfolio home, and the first-run flow that has no project to name.
      replacePath('/')
    }
  }, [landing])

  // Back and Forward across projects. The deeper path is `ProjectShell`'s to
  // apply — and a project change remounts it, so it reads the popped URL fresh.
  useEffect(() => {
    const onPop = () => {
      const projectId = projectIdOf(parsePath(currentPath()) ?? { kind: 'home' })
      setChosen(
        projectId ? { view: 'project', projectId } : { view: 'home', projectId: null },
      )
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Deliberate navigation is what gets remembered — the chooser as much as a
  // project, so choosing to sit on the portfolio survives a reload too. The
  // open-a-project flow is not: it is somewhere you pass through.
  const goHome = useCallback(() => {
    setChosen({ view: 'home', projectId: null })
    writeStoredNav({ view: 'home' })
    pushPath('/')
  }, [])
  const enterProject = useCallback((projectId: string) => {
    setChosen({ view: 'project', projectId })
    writeStoredNav({ view: 'project', projectId })
    pushPath(pathFor({ kind: 'project', projectId }))
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
    loading: q.isLoading || doctor.isLoading,
    view,
    currentProjectId,
    currentProject,
    goHome,
    enterProject,
    showOpen,
    cancelOpen,
  }
}
