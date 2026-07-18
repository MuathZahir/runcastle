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
 * Only `selectedFeatureId`, the inspector-collapse flag, and the guidance toggle
 * persist across reloads — the viewed phase, command palette, and new-feature
 * form are ephemeral session state.
 */

/** Client-tracked active test drive (at most one globally, server-enforced). */
export interface DriveState {
  featureId: string
  branch: string
}

const SELECTED_KEY = 'runcastle.selected.v1'
const INSPECTOR_KEY = 'runcastle.inspector.collapsed'
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
  /** Pinned phase to view read-only, or null to follow the feature's live phase. */
  viewedPhase: Phase | null
  /** Whether the new-feature form owns the workspace. */
  creating: boolean
  /** Right inspector rail collapsed. */
  inspectorCollapsed: boolean
  /** Command palette (⌘K) open. */
  cmdkOpen: boolean
  /** Show the one-line guide captions on the next-step bar and phase bodies. */
  guidance: boolean

  /** Select a feature (clears the phase pin and closes the create form). */
  select: (featureId: string) => void
  /** Pin a phase to view (null = follow live phase). */
  viewPhase: (phase: Phase | null) => void
  /** Open the new-feature form in the workspace. */
  startCreate: () => void
  /** Close the new-feature form without creating. */
  cancelCreate: () => void
  toggleInspector: () => void
  setCmdk: (open: boolean) => void
  toggleGuidance: () => void
}

export function useWorkspace(projectId: string): WorkspaceApi {
  const selectedKey = selectedKeyFor(projectId)
  const [selectedFeatureId, setSelected] = useState<string | null>(() => readLS(selectedKey))
  const [viewedPhase, setViewedPhase] = useState<Phase | null>(null)
  const [creating, setCreating] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(
    () => readLS(INSPECTOR_KEY) === '1',
  )
  const [cmdkOpen, setCmdk] = useState(false)
  const [guidance, setGuidance] = useState(() => readLS(GUIDANCE_KEY) !== '0')

  useEffect(() => {
    if (selectedFeatureId) writeLS(selectedKey, selectedFeatureId)
  }, [selectedFeatureId, selectedKey])
  useEffect(() => {
    writeLS(INSPECTOR_KEY, inspectorCollapsed ? '1' : '0')
  }, [inspectorCollapsed])
  useEffect(() => {
    writeLS(GUIDANCE_KEY, guidance ? '1' : '0')
  }, [guidance])

  const select = useCallback((featureId: string) => {
    setSelected(featureId)
    setViewedPhase(null)
    setCreating(false)
    setCmdk(false)
  }, [])

  const viewPhase = useCallback((phase: Phase | null) => setViewedPhase(phase), [])
  const startCreate = useCallback(() => {
    setCreating(true)
    setCmdk(false)
  }, [])
  const cancelCreate = useCallback(() => setCreating(false), [])
  const toggleInspector = useCallback(() => setInspectorCollapsed((v) => !v), [])
  const toggleGuidance = useCallback(() => setGuidance((v) => !v), [])

  return {
    selectedFeatureId,
    viewedPhase,
    creating,
    inspectorCollapsed,
    cmdkOpen,
    guidance,
    select,
    viewPhase,
    startCreate,
    cancelCreate,
    toggleInspector,
    setCmdk,
    toggleGuidance,
  }
}
