import { useState } from 'react'

/** What the sidebar shows under the pinned Inbox: the Work lanes or the Map tree. */
export type SidebarMode = 'work' | 'map'

/** localStorage key for one project's Work | Map choice. */
export function sidebarModeKey(projectId: string): string {
  return `runcastle.sidebarMode.${projectId}`
}

/** The project's remembered mode — Work when nothing (or nothing readable) is stored. */
export function readSidebarMode(projectId: string): SidebarMode {
  try {
    return localStorage.getItem(sidebarModeKey(projectId)) === 'map' ? 'map' : 'work'
  } catch {
    return 'work'
  }
}

export function writeSidebarMode(projectId: string, mode: SidebarMode): void {
  try {
    localStorage.setItem(sidebarModeKey(projectId), mode)
  } catch {
    // localStorage unavailable (private mode) — the switch still works in-session
  }
}

/**
 * The sidebar's Work | Map mode (the-map-of-stories-and-scenarios spec, "What
 * the developer sees"): a per-project preference, forced to Map whenever a map
 * address opens (`mapSelection` defined). Like an IDE's explorer toggle it
 * moves only the sidebar — `setMode` never touches the content panel, so Work
 * can be picked while the map stays open beside it.
 */
export function useSidebarMode(
  projectId: string,
  mapSelection: string | null | undefined,
): [SidebarMode, (mode: SidebarMode) => void] {
  const initial = (): SidebarMode => (mapSelection !== undefined ? 'map' : readSidebarMode(projectId))
  const [state, setState] = useState(() => ({ projectId, mapSelection, mode: initial() }))
  // Adjusted during render (not in an effect) so the first frame at a new
  // project or a newly opened map address is already in the right mode.
  let { mode } = state
  if (state.projectId !== projectId || state.mapSelection !== mapSelection) {
    mode = mapSelection !== undefined ? 'map' : state.projectId !== projectId ? readSidebarMode(projectId) : mode
    setState({ projectId, mapSelection, mode })
  }
  const setMode = (next: SidebarMode): void => {
    writeSidebarMode(projectId, next)
    setState((s) => ({ ...s, mode: next }))
  }
  return [mode, setMode]
}
