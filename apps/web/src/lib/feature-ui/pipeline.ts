import type { Phase } from '@runcastle/core'
import type { FeatureFull } from '../api'
import { ticketCount } from './tickets'

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
export function phaseIndex(phase: Phase): number { return PHASE_ORDER.indexOf(phase) }
export type StepState = 'done' | 'current' | 'upcoming'
function stepState(feature: { phase: Phase }, phase: Phase): StepState {
  const delta = phaseIndex(phase) - phaseIndex(feature.phase)
  return delta < 0 ? 'done' : delta === 0 ? 'current' : 'upcoming'
}
export function miniSegments(feature: { phase: Phase }): { phase: Phase; state: StepState }[] {
  return PHASE_ORDER.map((phase) => ({ phase, state: stepState(feature, phase) }))
}
export function effectivePhase(feature: { phase: Phase }, viewedPhase: Phase | null): Phase { return viewedPhase ?? feature.phase }
export function isReadonlyView(feature: { phase: Phase }, effective: Phase): boolean { return phaseIndex(effective) < phaseIndex(feature.phase) }

/**
 * Whether the page's body is the ticket ledger — the card you correct before
 * Burn. At building that holds until a run exists to narrate; at planning it
 * holds the moment this lap has a ticket, because a quick change is born there
 * with its tickets and never has a planning session to show, and a feature
 * whose tickets agent has emitted them is past shaping the idea. A pinned
 * planning phase is a frozen record instead (decision 10).
 */
export function ticketsAreBody({ full, phase, readonly, hasRun }: {
  full: Pick<FeatureFull, 'feature' | 'tickets'>
  phase: Phase
  readonly: boolean
  hasRun: boolean
}): boolean {
  if (phase === 'building') return !hasRun
  return phase === 'planning' && !readonly && ticketCount(full.tickets).total > 0
}

/**
 * Whether live planning's artifact fills the body and scrolls itself — the
 * planning body before this lap has tickets. The plan preview no longer leads
 * that body: it is a panel view of its own (design-mode decision 5).
 */
export function planningFills({ phase, readonly, ticketsIsBody }: {
  phase: Phase
  readonly: boolean
  ticketsIsBody: boolean
}): boolean {
  return phase === 'planning' && !readonly && !ticketsIsBody
}

export { nextStep } from './next-step'
export type { ActionKind, NextStep } from './next-step'
export type { NextStepContext } from './next-step/resolver-input'
