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

/** One-line tooltip per phase for the pipeline stepper. */
export const PHASE_TIP: Record<Phase, string> = {
  ideation: 'Shape the idea in a grill session',
  spec: 'Write it up as a spec',
  tickets: 'Break the work into atomic tickets',
  implementation: 'Burn the tickets into commits',
  review: 'Test-drive the branch, then merge',
  shipped: 'Merged to the main branch',
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

/** The full workspace pipeline stepper for a feature at a given viewed phase. */
export function pipelineSteps(
  feature: { phase: Phase },
  effective: Phase,
): PipelineStep[] {
  return PHASE_ORDER.map((phase) => {
    const state = stepState(feature, phase)
    return {
      phase,
      label: PHASE_LABELS[phase],
      state,
      isViewed: phase === effective,
      clickable: state === 'done' || state === 'current',
      tip: PHASE_TIP[phase],
    }
  })
}

// --- guided next-step bar ---------------------------------------------------
