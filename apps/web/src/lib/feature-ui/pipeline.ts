import type { Phase } from '@runcastle/core'

export const PHASE_ORDER: Phase[] = [
  'ideation',
  'spec',
  'tickets',
  'implementation',
  'review',
  'shipped',
]

/** Sidebar status glyph per phase (mono). */
export function phaseGlyph(phase: Phase): string {
  switch (phase) {
    case 'ideation':
      return '◉'
    case 'spec':
      return '◐'
    case 'tickets':
      return '▤'
    case 'implementation':
      return '⚙'
    case 'review':
      return '◆'
    case 'shipped':
      return '✓'
  }
}

/**
 * The rail glyph for a parked draft (decision 9), shown in place of
 * {@link phaseGlyph}. A draft has no meaningful pipeline position, so it gets no
 * phase glyph — the open circle says "nothing has started here yet".
 */
export const DRAFT_GLYPH = '◌'

export const PHASE_LABELS: Record<Phase, string> = {
  ideation: 'ideation',
  spec: 'spec',
  tickets: 'tickets',
  implementation: 'build',
  review: 'review',
  shipped: 'shipped',
}

/** What the phase the feature is ON is for — the current step's tooltip. */
export const PHASE_TIP: Record<Phase, string> = {
  ideation: 'Shape the idea with the agent in a session',
  spec: 'The session writes the idea up as a spec',
  tickets: 'The spec is broken into tickets you review, then burn',
  implementation: 'Agents implement each ticket in a sandbox',
  review: 'Test-drive the branch, then merge',
  shipped: 'Merged to main',
}

/**
 * What unlocks a phase the feature has not reached — the upcoming step's
 * tooltip (decision 13). Ideation has no entry: it is where every feature
 * starts, so it is never upcoming.
 */
export const PHASE_UNLOCK: Record<Exclude<Phase, 'ideation'>, string> = {
  spec: 'Opens when the idea is concrete — the session moves it on',
  tickets: 'Opens when the spec is written',
  implementation: 'Opens when you click Burn',
  review: 'Opens when the burn finishes',
  shipped: 'Opens when you merge',
}

export function phaseIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase)
}

// --- triage sidebar --------------------------------------------------------

export type StepState = 'done' | 'current' | 'upcoming'

export interface PipelineStep {
  phase: Phase
  label: string
  state: StepState
  /** The phase currently shown in the workspace (viewed pin or live phase). */
  isViewed: boolean
  /** Whether clicking the step navigates (done or current phases only). */
  clickable: boolean
  tip: string
}

function stepState(feature: { phase: Phase }, phase: Phase): StepState {
  const ci = phaseIndex(feature.phase)
  const pi = phaseIndex(phase)
  if (pi < ci) return 'done'
  if (pi === ci) return 'current'
  return 'upcoming'
}

/** Compact 6-segment lifecycle map for a sidebar row. */
export function miniSegments(
  feature: { phase: Phase },
): { phase: Phase; state: StepState }[] {
  return PHASE_ORDER.map((phase) => ({ phase, state: stepState(feature, phase) }))
}

/** The phase actually shown in the workspace (pinned view, else the live phase). */
export function effectivePhase(
  feature: { phase: Phase },
  viewedPhase: Phase | null,
): Phase {
  return viewedPhase ?? feature.phase
}

/** Viewing an earlier, completed phase (workspace is read-only). */
export function isReadonlyView(feature: { phase: Phase }, effective: Phase): boolean {
  return phaseIndex(effective) < phaseIndex(feature.phase)
}

/**
 * What a step's tooltip says (decision 13): a done step reports what the phase
 * produced and that it can be reviewed, the current step says what the phase is
 * for, and an upcoming step says what unlocks it. A done phase whose summary
 * could not be derived falls back to its own name rather than teaching the
 * pipeline twice.
 */
function stepTip(phase: Phase, state: StepState, summary?: string | null): string {
  if (state === 'done') return `${summary || PHASE_LABELS[phase]} — click to review`
  if (state === 'current' || phase === 'ideation') return PHASE_TIP[phase]
  return PHASE_UNLOCK[phase]
}

/**
 * The full workspace pipeline stepper for a feature at a given viewed phase.
 * `summaries` carries the one-line record of each finished phase the workspace
 * could derive (see `phaseSummary`); phases it has nothing for fall back.
 */
export function pipelineSteps(
  feature: { phase: Phase },
  effective: Phase,
  summaries: Partial<Record<Phase, string | null>> = {},
): PipelineStep[] {
  return PHASE_ORDER.map((phase) => {
    const state = stepState(feature, phase)
    return {
      phase,
      label: PHASE_LABELS[phase],
      state,
      isViewed: phase === effective,
      clickable: state === 'done' || state === 'current',
      tip: stepTip(phase, state, summaries[phase]),
    }
  })
}

// --- guided next-step bar ---------------------------------------------------
