import type { FeatureSize, Phase } from './schemas'

/**
 * The pipeline as data (CONTEXT.md decision #7). Phases are a linear order;
 * each transition is guarded by a gate. Gates are identifiers only — the
 * server implements the actual checks so core stays IO-free (SPEC §1).
 */

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5'

export type GateCheckId =
  | 'decisions-file-exists'
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
      description:
        'Spec written before breaking into tickets (auto-satisfied for collapsed features)',
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
 * The next phase for a feature, honouring the collapsed-size skip of `spec`.
 * Returns null when already at the terminal phase.
 */
export function nextPhase(feature: { phase: Phase; size: FeatureSize }): Phase | null {
  const i = ORDER.indexOf(feature.phase)
  if (i < 0 || i >= ORDER.length - 1) return null
  const step = ORDER[i + 1]
  if (feature.size === 'collapsed' && step === 'spec') {
    // collapsed features never enter `spec`; jump straight to `tickets`
    return ORDER[i + 2] ?? null
  }
  return step
}

/**
 * The gate guarding the transition OUT of the feature's current phase.
 *
 * This is the `gateToEnter` of the immediately-following phase in the full
 * order. For a collapsed feature leaving `ideation`, the destination phase
 * changes to `tickets` (see nextPhase) but the guarding gate stays G1, while
 * G2's `spec-file-exists` is auto-satisfied server-side. Returns null at the
 * terminal phase.
 */
export function nextGate(feature: { phase: Phase; size: FeatureSize }): GateDef | null {
  const i = ORDER.indexOf(feature.phase)
  if (i < 0 || i >= ORDER.length - 1) return null
  return PIPELINE[i + 1].gateToEnter ?? null
}
