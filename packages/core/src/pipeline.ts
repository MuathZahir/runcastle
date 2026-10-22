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

/**
 * The plan is finished: the tickets step is complete for this lap (the session
 * called `complete_phase("tickets")`). Go's gate reads it, not the ticket count —
 * a finished plan with no tickets is one the lead builds itself.
 */
export function planFinished(feature: { lap: number; ticketsReadyLap: number | null }): boolean {
  return feature.ticketsReadyLap === feature.lap
}

/** Why Go is gated before {@link planFinished}, in the bar and in `go()`'s refusal. */
export const PLAN_UNFINISHED = 'the plan is not finished'

/** Why Go is refused, with no override, while the talk worktree holds design work no commit has caught. */
export const UNCOMMITTED_DESIGN = 'Uncommitted design work: ask the chat to commit or drop it'

/** The first planning artifact still missing, or null when the feature can burn. */
export function nextPlanningStep(facts: PlanningArtifactFacts): PlanningStep | null {
  if (!facts.hasDecisions) return 'ideation'
  if (!facts.hasSpec) return 'spec'
  if (!facts.hasTickets) return 'tickets'
  return null
}
