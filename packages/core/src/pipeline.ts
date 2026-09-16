import type { Phase } from './schemas'

/** The authoritative forward-only feature-state order. */
export const PIPELINE = ['planning', 'building', 'review', 'shipped'] as const satisfies readonly Phase[]

/** The next state in the forward-only feature lifecycle. */
export function nextPhase(feature: { phase: Phase }): Phase | null {
  const index = PIPELINE.indexOf(feature.phase)
  return index >= 0 && index < PIPELINE.length - 1 ? PIPELINE[index + 1] : null
}

/** True when a feature has moved beyond the supplied state. */
export function isPastPhase(feature: { phase: Phase }, phase: Phase): boolean {
  return PIPELINE.indexOf(feature.phase) > PIPELINE.indexOf(phase)
}

export interface PlanningArtifactFacts {
  hasDecisions: boolean
  hasSpec: boolean
  hasTickets: boolean
}

export type PlanningStep = 'ideation' | 'spec' | 'tickets'

/** Planning sub-steps are facts derived from durable artifacts, never stored state. */
export function completedPlanningSteps(facts: PlanningArtifactFacts): PlanningStep[] {
  const completed: PlanningStep[] = []
  if (facts.hasDecisions) completed.push('ideation')
  if (facts.hasSpec) completed.push('spec')
  if (facts.hasTickets) completed.push('tickets')
  return completed
}

/** The first planning artifact still missing, or null when the feature can burn. */
export function nextPlanningStep(facts: PlanningArtifactFacts): PlanningStep | null {
  if (!facts.hasDecisions) return 'ideation'
  if (!facts.hasSpec) return 'spec'
  if (!facts.hasTickets) return 'tickets'
  return null
}
