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
 * Only `selectedFeatureId`, an open preparation, the two rail-collapse flags and
 * the guidance toggle persist across reloads — the viewed phase, command palette,
 * and Quick overlay are ephemeral session state.
 */

/** Client-tracked active test drive (at most one globally, server-enforced). */
export interface DriveState {
  featureId: string
  branch: string
}

const SELECTED_KEY = 'runcastle.selected.v1'
const PREPARING_KEY = 'runcastle.preparing.v1'
const INSPECTOR_KEY = 'runcastle.inspector.collapsed'
const MAPRAIL_KEY = 'runcastle.maprail.collapsed'
const GUIDANCE_KEY = 'runcastle.guidance'

/** Per-project selected-feature key so switching projects never restores a
 *  feature from another project (multi-project, issue #45). */
function selectedKeyFor(projectId: string): string {
  return `${SELECTED_KEY}:${projectId}`
}

/** Per-project too, and for the same reason: preparation is a project's job. */
function preparingKeyFor(projectId: string): string {
  return `${PREPARING_KEY}:${projectId}`
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
  /** Whether the Quick door's overlay owns the workspace (decisions.md #12). */
  creating: boolean
  /**
   * Preparation was opened deliberately — from the rail's row or ⌘K. Kept apart
   * from the automatic call-to-action an unprepared, featureless project gets:
   * that one is a condition, this one is a choice, and a choice has to survive
   * both the project becoming prepared while you are looking at it and the
   * reload that used to drop it (persisted, per project).
   *
   * Leaving is still deliberate — Back, or picking anything else in the rail —
   * because the row at its foot is permanent now: what you left is one click
   * away, and the conversation itself lives on the server either way.
   */
  preparing: boolean
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
  /** Open the Quick door's overlay in the workspace. */
  startQuickChange: () => void
  /** Give the workspace over to preparation. */
  startPreparation: () => void
  /** Close the Quick overlay without creating anything. */
  cancelCreate: () => void
  /** Leave a deliberately-opened preparation. */
  closePreparation: () => void
  toggleInspector: () => void
  toggleMapRail: () => void
  setCmdk: (open: boolean) => void
  setSettings: (open: boolean) => void
  toggleGuidance: () => void
}

export function useWorkspace(projectId: string): WorkspaceApi {
  const selectedKey = selectedKeyFor(projectId)
  const preparingKey = preparingKeyFor(projectId)
  const [selectedFeatureId, setSelected] = useState<string | null>(() => readLS(selectedKey))
  const [viewedPhase, setViewedPhase] = useState<Phase | null>(null)
  const [creating, setCreating] = useState(false)
  // Persisted, unlike the create form beside it: a preparation you opened is a
  // conversation in progress, often a live terminal, and a reload used to drop
  // it silently — landing you back on a feature with no sign of where you were.
  const [preparing, setPreparing] = useState(() => readLS(preparingKey) === '1')
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
    writeLS(preparingKey, preparing ? '1' : '0')
  }, [preparing, preparingKey])
  useEffect(() => {
    writeLS(INSPECTOR_KEY, inspectorCollapsed ? '1' : '0')
  }, [inspectorCollapsed])
  useEffect(() => {
    writeLS(MAPRAIL_KEY, mapRailCollapsed ? '1' : '0')
  }, [mapRailCollapsed])
  useEffect(() => {
    writeLS(GUIDANCE_KEY, guidance ? '1' : '0')
  }, [guidance])

  // `null` deselects, which is how the project home is reached without leaving
  // the project.
  const select = useCallback((featureId: string | null) => {
    setSelected(featureId)
    setViewedPhase(null)
    setCreating(false)
    setPreparing(false)
    setProjectSelected(false)
    setCmdk(false)
  }, [])

  // Leaves `selectedFeatureId` alone — the project workspace is a swap, not a
  // deselection, so leaving it puts you back on the feature you were reading.
  const selectProject = useCallback(() => {
    setProjectSelected(true)
    setViewedPhase(null)
    setCreating(false)
    setPreparing(false)
    setCmdk(false)
  }, [])

  const viewPhase = useCallback((phase: Phase | null) => setViewedPhase(phase), [])
  const startQuickChange = useCallback(() => {
    setCreating(true)
    setPreparing(false)
    setProjectSelected(false)
    setCmdk(false)
  }, [])
  const startPreparation = useCallback(() => {
    setPreparing(true)
    setCreating(false)
    setProjectSelected(false)
    setCmdk(false)
  }, [])
  // Opening settings closes the palette so only one overlay is up at a time.
  const openSettings = useCallback((open: boolean) => {
    setSettings(open)
    if (open) setCmdk(false)
  }, [])
  const cancelCreate = useCallback(() => setCreating(false), [])
  const closePreparation = useCallback(() => setPreparing(false), [])
  const toggleInspector = useCallback(() => setInspectorCollapsed((v) => !v), [])
  const toggleMapRail = useCallback(() => setMapRailCollapsed((v) => !v), [])
  const toggleGuidance = useCallback(() => setGuidance((v) => !v), [])

  return {
    selectedFeatureId,
    projectSelected,
    viewedPhase,
    creating,
    preparing,
    inspectorCollapsed,
    mapRailCollapsed,
    cmdkOpen,
    settingsOpen,
    guidance,
    select,
    selectProject,
    viewPhase,
    startQuickChange,
    startPreparation,
    cancelCreate,
    closePreparation,
    toggleInspector,
    toggleMapRail,
    setCmdk,
    setSettings: openSettings,
    toggleGuidance,
  }
}
