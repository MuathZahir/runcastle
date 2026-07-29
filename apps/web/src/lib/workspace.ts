import { useCallback, useEffect, useState } from 'react'
import type { Phase } from '@runcastle/core'

/**
 * Workspace navigation state for the pipeline-first shell (app-redesign).
 *
 * The redesign replaces the old tab model with a single selected feature whose
 * *current phase* drives the workspace body. The user can also pin `viewedPhase`
 * to an earlier, completed phase to inspect it read-only; selecting a different
 * feature clears the pin so the workspace snaps back to following the live phase.
 *
 * Only `selectedFeatureId`, the two rail-collapse flags, and the guidance toggle
 * persist across reloads — the viewed phase, command palette, and new-feature
 * form are ephemeral session state.
 */

/** The two doors into work: a full feature (a grill) or a quick change. */
export type CreateMode = 'feature' | 'quick'

/** Client-tracked active test drive (at most one globally, server-enforced). */
export interface DriveState {
  featureId: string
  branch: string
}

const SELECTED_KEY = 'runcastle.selected.v1'
const INSPECTOR_KEY = 'runcastle.inspector.collapsed'
const MAPRAIL_KEY = 'runcastle.maprail.collapsed'
const GUIDANCE_KEY = 'runcastle.guidance'

/** Per-project selected-feature key so switching projects never restores a
 *  feature from another project (multi-project, issue #45). */
function selectedKeyFor(projectId: string): string {
  return `${SELECTED_KEY}:${projectId}`
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage may be unavailable (private mode) — non-fatal
  }
}

export interface WorkspaceApi {
  /** The feature whose pipeline fills the workspace, or null (empty state). */
  selectedFeatureId: string | null
  /**
   * The rail's pinned project row is selected (decision 20), so the project
   * workspace fills the body instead of the selected feature's. Kept beside
   * `selectedFeatureId` rather than folded into it: the feature you were last on
   * is still the one you come back to when you leave the project workspace.
   */
  projectSelected: boolean
  /** Pinned phase to view read-only, or null to follow the feature's live phase. */
  viewedPhase: Phase | null
  /** Whether a creation form owns the workspace (either door). */
  creating: boolean
  /**
   * Which door is open while `creating`: the New Feature form (a grill), or the
   * quick-change form (decision 21 — one prose field, straight to a card).
   */
  createMode: CreateMode
  /** Right inspector rail collapsed. */
  inspectorCollapsed: boolean
  /** Mapped-ideation map rail collapsed to its frontier-count stub. */
  mapRailCollapsed: boolean
  /** Command palette (⌘K) open. */
  cmdkOpen: boolean
  /** Settings overlay open (issue #47). */
  settingsOpen: boolean
  /** Show the one-line guide captions on the next-step bar and phase bodies. */
  guidance: boolean

  /** Select a feature, or `null` to return to the project home (clears the
   *  phase pin, the project row, and closes the create form). */
  select: (featureId: string | null) => void
  /** Select the pinned project row — the project workspace fills the body. */
  selectProject: () => void
  /** Pin a phase to view (null = follow live phase). */
  viewPhase: (phase: Phase | null) => void
  /** Open the new-feature form in the workspace. */
  startCreate: () => void
  /** Open the quick-change form in the workspace. */
  startQuickChange: () => void
  /** Close whichever creation form is open, without creating. */
  cancelCreate: () => void
  toggleInspector: () => void
  toggleMapRail: () => void
  setCmdk: (open: boolean) => void
  setSettings: (open: boolean) => void
  toggleGuidance: () => void
}

export function useWorkspace(projectId: string): WorkspaceApi {
  const selectedKey = selectedKeyFor(projectId)
  const [selectedFeatureId, setSelected] = useState<string | null>(() => readLS(selectedKey))
  const [viewedPhase, setViewedPhase] = useState<Phase | null>(null)
  const [creating, setCreating] = useState(false)
  const [createMode, setCreateMode] = useState<CreateMode>('feature')
  // Ephemeral like the phase pin: the pinned row is always in the rail, so a
  // reload landing back on your feature is the right resting state.
  const [projectSelected, setProjectSelected] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => readLS(INSPECTOR_KEY) === '1',
  )
  // Global, not per-project (matching the inspector): a rail preference is about
  // how the human likes the screen, not about which project they are in.
  const [mapRailCollapsed, setMapRailCollapsed] = useState(
    () => readLS(MAPRAIL_KEY) === '1',
  )
  const [cmdkOpen, setCmdk] = useState(false)
  const [settingsOpen, setSettings] = useState(false)
  const [guidance, setGuidance] = useState(() => readLS(GUIDANCE_KEY) !== '0')

  useEffect(() => {
    if (selectedFeatureId) writeLS(selectedKey, selectedFeatureId)
  }, [selectedFeatureId, selectedKey])
  useEffect(() => {
    writeLS(INSPECTOR_KEY, inspectorCollapsed ? '1' : '0')
  }, [inspectorCollapsed])
  useEffect(() => {
    writeLS(MAPRAIL_KEY, mapRailCollapsed ? '1' : '0')
  }, [mapRailCollapsed])
  useEffect(() => {
    writeLS(GUIDANCE_KEY, guidance ? '1' : '0')
  }, [guidance])

  // `null` deselects, which is how the project home (and the preparation card
  // that lives on it) is reached without leaving the project.
  const select = useCallback((featureId: string | null) => {
    setSelected(featureId)
    setViewedPhase(null)
    setCreating(false)
    setProjectSelected(false)
    setCmdk(false)
  }, [])

  // Leaves `selectedFeatureId` alone — the project workspace is a swap, not a
  // deselection, so leaving it puts you back on the feature you were reading.
  const selectProject = useCallback(() => {
    setProjectSelected(true)
    setViewedPhase(null)
    setCreating(false)
    setCmdk(false)
  }, [])

  const viewPhase = useCallback((phase: Phase | null) => setViewedPhase(phase), [])
  const startCreate = useCallback(() => {
    setCreateMode('feature')
    setCreating(true)
    setProjectSelected(false)
    setCmdk(false)
  }, [])
  const startQuickChange = useCallback(() => {
    setCreateMode('quick')
    setCreating(true)
    setProjectSelected(false)
    setCmdk(false)
  }, [])
  // Opening settings closes the palette so only one overlay is up at a time.
  const openSettings = useCallback((open: boolean) => {
    setSettings(open)
    if (open) setCmdk(false)
  }, [])
  const cancelCreate = useCallback(() => setCreating(false), [])
  const toggleInspector = useCallback(() => setInspectorCollapsed((v) => !v), [])
  const toggleMapRail = useCallback(() => setMapRailCollapsed((v) => !v), [])
  const toggleGuidance = useCallback(() => setGuidance((v) => !v), [])

  return {
    selectedFeatureId,
    projectSelected,
    viewedPhase,
    creating,
    createMode,
    inspectorCollapsed,
    mapRailCollapsed,
    cmdkOpen,
    settingsOpen,
    guidance,
    select,
    selectProject,
    viewPhase,
    startCreate,
    startQuickChange,
    cancelCreate,
    toggleInspector,
    toggleMapRail,
    setCmdk,
    setSettings: openSettings,
    toggleGuidance,
  }
}
