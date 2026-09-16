import type { Phase } from '@runcastle/core'

export const PHASE_ORDER: Phase[] = ['planning', 'building', 'review', 'shipped']

export function phaseGlyph(phase: Phase): string {
  return { planning: '◉', building: '⚙', review: '◆', shipped: '✓' }[phase]
}

export const DRAFT_GLYPH = '◌'
export const PHASE_LABELS = {
  planning: 'planning', building: 'build', review: 'review', shipped: 'shipped',
} satisfies Record<Phase, string>
export const PHASE_TIP: Record<Phase, string> = {
  planning: 'Shape the feature, write its spec, and emit tickets',
  building: 'Agents implement each ticket in a sandbox',
  review: 'Test-drive the branch, plan more work, or merge',
  shipped: 'Merged to main',
}
export const PHASE_UNLOCK = {
  building: 'Opens when you click Burn', review: 'Opens when the burn finishes', shipped: 'Opens when you merge',
} satisfies Record<Exclude<Phase, 'planning'>, string>

export function phaseIndex(phase: Phase): number { return PHASE_ORDER.indexOf(phase) }
export type StepState = 'done' | 'current' | 'upcoming'
export interface PipelineStep { phase: Phase; label: string; state: StepState; isViewed: boolean; clickable: boolean; tip: string }
function stepState(feature: { phase: Phase }, phase: Phase): StepState {
  const delta = phaseIndex(phase) - phaseIndex(feature.phase)
  return delta < 0 ? 'done' : delta === 0 ? 'current' : 'upcoming'
}
export function miniSegments(feature: { phase: Phase }): { phase: Phase; state: StepState }[] {
  return PHASE_ORDER.map((phase) => ({ phase, state: stepState(feature, phase) }))
}
export function effectivePhase(feature: { phase: Phase }, viewedPhase: Phase | null): Phase { return viewedPhase ?? feature.phase }
export function isReadonlyView(feature: { phase: Phase }, effective: Phase): boolean { return phaseIndex(effective) < phaseIndex(feature.phase) }
export function pipelineSteps(feature: { phase: Phase }, effective: Phase, summaries: Partial<Record<Phase, string | null>> = {}): PipelineStep[] {
  return PHASE_ORDER.map((phase) => {
    const state = stepState(feature, phase)
    const tip = state === 'done' ? `${summaries[phase] || PHASE_LABELS[phase]} — click to review` : state === 'current' || phase === 'planning' ? PHASE_TIP[phase] : PHASE_UNLOCK[phase]
    return { phase, label: PHASE_LABELS[phase], state, isViewed: phase === effective, clickable: state !== 'upcoming', tip }
  })
}

export { nextStep } from './next-step'
export type { ActionKind, NextStep } from './next-step'
export type { NextStepContext } from './next-step/resolver-input'
