import type { Phase } from './schemas'

/**
 * The pipeline as data (CONTEXT.md decision #7). Phases are a linear order;
 * each transition is guarded by a gate. Gates are identifiers only — the
 * server implements the actual checks so core stays IO-free (SPEC §1).
 */

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5'

export type GateCheckId =
  | 'decisions-file-exists'
  | 'all-waypoints-terminal'
  | 'spec-file-exists'
  | 'tickets-approved'
  | 'all-tickets-terminal'
  | 'human-merge'

export interface GateDef {
  id: GateId
  description: string
  check: GateCheckId
}

export interface PhaseDef {
  phase: Phase
  /** Gate guarding the transition INTO this phase from its predecessor. */
  gateToEnter?: GateDef
}

/** Authoritative phase order + entry gates. */
export const PIPELINE: PhaseDef[] = [
  { phase: 'ideation' },
  {
    phase: 'spec',
    gateToEnter: {
      id: 'G1',
      description: 'Decisions captured before writing a spec',
      check: 'decisions-file-exists',
    },
  },
  {
    phase: 'tickets',
    gateToEnter: {
      id: 'G2',
      description: 'Spec written before breaking into tickets',
      check: 'spec-file-exists',
    },
  },
  {
    phase: 'implementation',
    gateToEnter: {
      id: 'G3',
      description: 'Tickets approved by a human (the Burn click)',
      check: 'tickets-approved',
    },
  },
  {
    phase: 'review',
    gateToEnter: {
      id: 'G4',
      description: 'Every ticket reached a terminal state',
      check: 'all-tickets-terminal',
    },
  },
  {
    phase: 'shipped',
    gateToEnter: {
      id: 'G5',
      description: 'Human merged the feature branch (the Merge click)',
      check: 'human-merge',
    },
  },
]

const ORDER: Phase[] = PIPELINE.map((p) => p.phase)

/**
 * The next phase for a feature. Every feature runs the full linear order;
 * returns null when already at the terminal phase.
 */
export function nextPhase(feature: { phase: Phase }): Phase | null {
  const i = ORDER.indexOf(feature.phase)
  if (i < 0 || i >= ORDER.length - 1) return null
  return ORDER[i + 1]
}

/**
 * The pipeline's one backward transition (CONTEXT.md decision #7). Burning fresh
 * (pending) tickets from `review` loops the feature back to `implementation` so
 * the run can execute them; the G4 auto-advance (`all-tickets-terminal`) then
 * returns it to `review` when they finish, so review → iterate → burn → review
 * repeats until the human merges. `nextPhase`/`nextGate` stay strictly forward —
 * this loop is the lone exception, kept as its own typed transition rather than
 * bent into the linear order.
 */
export const REVIEW_LOOP_BACK = { from: 'review', to: 'implementation' } as const satisfies {
  from: Phase
  to: Phase
}

/**
 * The phase a review-phase burn loops back to (`implementation`), or null from
 * any other phase — the pure model behind the server's burn-from-review guard.
 */
export function loopBackPhase(feature: { phase: Phase }): Phase | null {
  return feature.phase === REVIEW_LOOP_BACK.from ? REVIEW_LOOP_BACK.to : null
}

/** G1 as it appears on a mapped feature (ADR-0001 / SPEC §13.1). */
const MAPPED_G1: GateDef = {
  id: 'G1',
  description: 'Every waypoint resolved or dropped before converging',
  check: 'all-waypoints-terminal',
}

/**
 * The gate guarding the transition OUT of the feature's current phase.
 *
 * This is the `gateToEnter` of the immediately-following phase in the full
 * order. Returns null at the terminal phase.
 *
 * G1 is conditional on `feature.mapped` (ADR-0001 / SPEC §13.1): a mapped
 * feature converges only once every waypoint is terminal, so its G1 check is
 * `all-waypoints-terminal` instead of `decisions-file-exists`. Every later gate
 * is identical in both modes — mapping only changes how ideation ends.
 */
export function nextGate(feature: {
  phase: Phase
  mapped?: boolean
}): GateDef | null {
  const i = ORDER.indexOf(feature.phase)
  if (i < 0 || i >= ORDER.length - 1) return null
  const gate = PIPELINE[i + 1].gateToEnter ?? null
  if (feature.mapped && gate?.id === 'G1') return MAPPED_G1
  return gate
}
