import { useCallback, useEffect, useState } from 'react'
import type { Phase } from '@runcastle/core'
import type { FeatureView } from './routes'
import type { SettingsLocation } from './settings'

/**
 * Workspace navigation state for the pipeline-first shell (app-redesign).
 *
 * The redesign replaces the old tab model with a single selected feature whose
 * *current phase* drives the workspace body. The user can also pin `viewedPhase`
 * to an earlier, completed phase to inspect it read-only; selecting a different
 * feature clears the pin so the workspace snaps back to following the live phase.
 *
 * Only `selectedFeatureId`, an open preparation, the two rail-collapse flags, the
 * guidance toggle and each feature's last view tab persist across reloads — the viewed
 * phase, command palette, and Draft overlay are ephemeral session state.
 */

/** Client-tracked active test drive (at most one globally, server-enforced). */
export interface DriveState {
  featureId: string
  branch: string
}

const SELECTED_KEY = 'runcastle.selected.v1'
const PREPARING_KEY = 'runcastle.preparing.v1'
const INSPECTOR_KEY = 'runcastle.inspector.collapsed'
const GUIDANCE_KEY = 'runcastle.guidance'
const FEATURE_VIEW_KEY = 'runcastle.feature.tab'

/**
 * Whether the details aside starts collapsed. It is closed by default in every
 * phase (DESIGN.md: an aside is opened on demand) — only the human's own toggle,
 * remembered as `preference`, opens it by default. `phase` is kept in the
 * signature so a caller never has to know the rule stopped depending on it.
 */
export function inspectorCollapsedForPhase(
  preference: boolean | null,
  _phase?: Phase | undefined,
): boolean {
  return preference ?? true
}

/** Per-project selected-feature key so switching projects never restores a
 *  feature from another project (multi-project, issue #45). */
function selectedKeyFor(projectId: string): string {
  return `${SELECTED_KEY}:${projectId}`
}

/** Per-project too, and for the same reason: preparation is a project's job. */
function preparingKeyFor(projectId: string): string {
  return `${PREPARING_KEY}:${projectId}`
}

/** Per-feature, so each feature reopens on the view it was left on (decision 8). */
function featureViewKeyFor(featureId: string): string {
  return `${FEATURE_VIEW_KEY}:${featureId}`
}

function parseFeatureView(value: string | null): FeatureView | null {
  return value === 'overview' || value === 'tickets' || value === 'chat' ? value : null
}

/**
 * Which view a feature opens on when nothing names one (one-chat-layout-everywhere
 * decision 8): the view it was left on, if that is still a view it has; else
 * Chat when a session is live, since that is what is happening on it; else
 * Overview. A draft has no Chat tab (decision 11), so it never lands there.
 */
export function initialTab({
  stored,
  hasLiveSession,
  isDraft,
}: {
  /** The raw remembered value — anything unrecognised is treated as nothing. */
  stored: string | null
  hasLiveSession: boolean
  isDraft: boolean
}): FeatureView {
  const remembered = parseFeatureView(stored)
  if (remembered && !(isDraft && remembered === 'chat')) return remembered
  if (hasLiveSession && !isDraft) return 'chat'
  return 'overview'
}

/**
 * {@link initialTab} for a feature row, read against what this browser
 * remembers for it. A feature the list does not know (yet) opens on whatever
 * was remembered, else Overview.
 */
export function rememberedView(
  featureId: string,
  feature?: { status: string; liveSession: unknown } | undefined,
): FeatureView {
  return initialTab({
    stored: readLS(featureViewKeyFor(featureId)),
    hasLiveSession: !!feature?.liveSession,
    isDraft: feature?.status === 'draft',
  })
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

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key)
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
  /**
   * The selected feature's view tab (Overview | Tickets | Chat). Shell state
   * rather than the page's, so the address bar can name it and drive it
   * (one-chat-layout-everywhere decision 8).
   */
  featureView: FeatureView
  /** Whether the Draft door's overlay owns the workspace (decisions.md #12). */
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
  /** Explicit inspector choice, or null until the human has toggled it. */
  inspectorPreference: boolean | null
  /** Command palette (⌘K) open. */
  cmdkOpen: boolean
  /**
   * Where settings is open, or null for closed. A location rather than a flag:
   * every caller — the titlebar, the palette, an error message pointing at
   * "Settings → Burns" — says which page (and optionally which field) it wants,
   * so the human lands on the row instead of on the dialog.
   */
  settings: SettingsLocation | null
  /** Show the one-line guide captions on the next-step bar and phase bodies. */
  guidance: boolean

  /** Select a feature on `view` (Overview when omitted), or `null` to return to
   *  the project home (clears the phase pin, the project row, and closes the
   *  create form). The view is remembered for that feature. */
  select: (featureId: string | null, view?: FeatureView) => void
  /** Switch the selected feature's view tab, remembered for that feature. */
  selectView: (view: FeatureView) => void
  /** Select the pinned project row — the project workspace fills the body. */
  selectProject: () => void
  /** Pin a phase to view (null = follow live phase). */
  viewPhase: (phase: Phase | null) => void
  /** Open the Draft door's overlay in the workspace. */
  startDraft: () => void
  /** Give the workspace over to preparation. */
  startPreparation: () => void
  /** Close the Draft overlay without creating anything. */
  cancelCreate: () => void
  /** Leave a deliberately-opened preparation. */
  closePreparation: () => void
  toggleInspector: (current?: boolean) => void
  setCmdk: (open: boolean) => void
  /** Open settings, on General unless the caller names somewhere else. */
  openSettings: (location?: SettingsLocation) => void
  closeSettings: () => void
  toggleGuidance: () => void
}

export function useWorkspace(projectId: string): WorkspaceApi {
  const selectedKey = selectedKeyFor(projectId)
  const preparingKey = preparingKeyFor(projectId)
  const [selectedFeatureId, setSelected] = useState<string | null>(() => readLS(selectedKey))
  const [viewedPhase, setViewedPhase] = useState<Phase | null>(null)
  // A first guess from storage; the shell's landing settles it once the feature
  // list says whether a session is live.
  const [featureView, setFeatureView] = useState<FeatureView>(() => {
    const selected = readLS(selectedKey)
    return (selected && parseFeatureView(readLS(featureViewKeyFor(selected)))) || 'overview'
  })
  const [creating, setCreating] = useState(false)
  // Persisted, unlike the create form beside it: a preparation you opened is a
  // conversation in progress, often a live terminal, and a reload used to drop
  // it silently — landing you back on a feature with no sign of where you were.
  const [preparing, setPreparing] = useState(() => readLS(preparingKey) === '1')
  // Ephemeral like the phase pin: the pinned row is always in the rail, so a
  // reload landing back on your feature is the right resting state.
  const [projectSelected, setProjectSelected] = useState(false)
  const [inspectorPreference, setInspectorPreference] = useState<boolean | null>(() => {
    const stored = readLS(INSPECTOR_KEY)
    return stored === null ? null : stored === '1'
  })
  const [cmdkOpen, setCmdk] = useState(false)
  const [settings, setSettings] = useState<SettingsLocation | null>(null)
  const [guidance, setGuidance] = useState(() => readLS(GUIDANCE_KEY) !== '0')

  useEffect(() => {
    if (selectedFeatureId) writeLS(selectedKey, selectedFeatureId)
    else removeLS(selectedKey)
  }, [selectedFeatureId, selectedKey])
  useEffect(() => {
    writeLS(preparingKey, preparing ? '1' : '0')
  }, [preparing, preparingKey])
  useEffect(() => {
    if (inspectorPreference !== null)
      writeLS(INSPECTOR_KEY, inspectorPreference ? '1' : '0')
  }, [inspectorPreference])
  useEffect(() => {
    writeLS(GUIDANCE_KEY, guidance ? '1' : '0')
  }, [guidance])

  // `null` deselects, which is how the project home is reached without leaving
  // the project.
  //
  // The view is remembered here, on the deliberate act, rather than by an effect
  // over the state: the state's first value is only a guess, and an effect would
  // overwrite what was remembered with it before the landing had a say.
  const select = useCallback((featureId: string | null, view: FeatureView = 'overview') => {
    setSelected(featureId)
    setFeatureView(view)
    if (featureId) writeLS(featureViewKeyFor(featureId), view)
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

  const selectView = useCallback(
    (view: FeatureView) => {
      setFeatureView(view)
      if (selectedFeatureId) writeLS(featureViewKeyFor(selectedFeatureId), view)
    },
    [selectedFeatureId],
  )

  const viewPhase = useCallback((phase: Phase | null) => setViewedPhase(phase), [])
  const startDraft = useCallback(() => {
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
  const openSettings = useCallback((location: SettingsLocation = { page: 'general' }) => {
    setSettings(location)
    setCmdk(false)
  }, [])
  const closeSettings = useCallback(() => setSettings(null), [])
  const cancelCreate = useCallback(() => setCreating(false), [])
  const closePreparation = useCallback(() => setPreparing(false), [])
  const toggleInspector = useCallback(
    (current?: boolean) => setInspectorPreference((value) => !(current ?? value ?? false)),
    [],
  )
  const toggleGuidance = useCallback(() => setGuidance((v) => !v), [])

  return {
    selectedFeatureId,
    projectSelected,
    viewedPhase,
    featureView,
    creating,
    preparing,
    inspectorCollapsed: inspectorPreference ?? true,
    inspectorPreference,
    cmdkOpen,
    settings,
    guidance,
    select,
    selectView,
    selectProject,
    viewPhase,
    startDraft,
    startPreparation,
    cancelCreate,
    closePreparation,
    toggleInspector,
    setCmdk,
    openSettings,
    closeSettings,
    toggleGuidance,
  }
}
