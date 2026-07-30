import { describe, expect, it } from 'vitest'
import {
  PIPELINE,
  RETHINK_LOOP_BACK,
  REVIEW_LOOP_BACK,
  loopBackPhase,
  nextGate,
  nextPhase,
  previousPhase,
  rethinkPhase,
} from '../src/pipeline'
import type { Phase } from '../src/schemas'

const full = (phase: Phase) => ({ phase })
const mapped = (phase: Phase) => ({ phase, mapped: true })

describe('nextPhase', () => {
  it('walks every phase in order — every feature goes ideation → spec', () => {
    expect(nextPhase(full('ideation'))).toBe('spec')
    expect(nextPhase(full('spec'))).toBe('tickets')
    expect(nextPhase(full('tickets'))).toBe('implementation')
    expect(nextPhase(full('implementation'))).toBe('review')
    expect(nextPhase(full('review'))).toBe('shipped')
  })

  it('returns null at the terminal phase', () => {
    expect(nextPhase(full('shipped'))).toBeNull()
  })
})

describe('previousPhase', () => {
  it('steps back exactly one phase — the inverse of nextPhase', () => {
    expect(previousPhase(full('spec'))).toBe('ideation')
    expect(previousPhase(full('review'))).toBe('implementation')
    expect(previousPhase(full('shipped'))).toBe('review')
  })

  it('returns null at the first phase, where there is nothing behind', () => {
    expect(previousPhase(full('ideation'))).toBeNull()
  })
})

describe('PIPELINE gate defs', () => {
  it('lists all six phases in order', () => {
    expect(PIPELINE.map((p) => p.phase)).toEqual([
      'ideation',
      'spec',
      'tickets',
      'implementation',
      'review',
      'shipped',
    ])
  })

  it('ideation has no entry gate', () => {
    expect(PIPELINE[0].gateToEnter).toBeUndefined()
  })

  it('maps each gate to the right id + check', () => {
    const byPhase = Object.fromEntries(PIPELINE.map((p) => [p.phase, p.gateToEnter]))
    expect(byPhase.spec).toMatchObject({ id: 'G1', check: 'decisions-file-exists' })
    expect(byPhase.tickets).toMatchObject({ id: 'G2', check: 'spec-file-exists' })
    expect(byPhase.implementation).toMatchObject({ id: 'G3', check: 'tickets-approved' })
    expect(byPhase.review).toMatchObject({ id: 'G4', check: 'all-tickets-terminal' })
    expect(byPhase.shipped).toMatchObject({ id: 'G5', check: 'human-merge' })
  })

  it('every non-initial phase has a gate with a description', () => {
    for (const def of PIPELINE.slice(1)) {
      expect(def.gateToEnter).toBeDefined()
      expect(def.gateToEnter?.description.length).toBeGreaterThan(0)
    }
  })
})

describe('nextGate', () => {
  it('full: gate matches the transition out of the current phase', () => {
    expect(nextGate(full('ideation'))?.id).toBe('G1')
    expect(nextGate(full('spec'))?.id).toBe('G2')
    expect(nextGate(full('tickets'))?.id).toBe('G3')
    expect(nextGate(full('implementation'))?.id).toBe('G4')
    expect(nextGate(full('review'))?.id).toBe('G5')
  })

  it('leaving ideation is guarded by G1 (decisions-file-exists)', () => {
    expect(nextGate(full('ideation'))?.id).toBe('G1')
    expect(nextGate(full('ideation'))?.check).toBe('decisions-file-exists')
  })

  it('returns null at the terminal phase', () => {
    expect(nextGate(full('shipped'))).toBeNull()
  })
})

describe('review → implementation loop (CONTEXT.md decision #7)', () => {
  it('REVIEW_LOOP_BACK is the review → implementation transition', () => {
    expect(REVIEW_LOOP_BACK).toEqual({ from: 'review', to: 'implementation' })
  })

  it('loopBackPhase returns implementation only from review', () => {
    expect(loopBackPhase(full('review'))).toBe('implementation')
    expect(loopBackPhase(full('ideation'))).toBeNull()
    expect(loopBackPhase(full('spec'))).toBeNull()
    expect(loopBackPhase(full('tickets'))).toBeNull()
    expect(loopBackPhase(full('implementation'))).toBeNull()
    expect(loopBackPhase(full('shipped'))).toBeNull()
  })

  it('is the lone backward step — nextPhase stays forward-only from review', () => {
    // Forward and loop-back are distinct transitions; review advances to shipped,
    // the loop goes back to implementation.
    expect(nextPhase(full('review'))).toBe('shipped')
    expect(loopBackPhase(full('review'))).toBe('implementation')
  })
})

describe('review → ideation loop — Rethink (ADR-0010 §1)', () => {
  it('RETHINK_LOOP_BACK is the review → ideation transition', () => {
    expect(RETHINK_LOOP_BACK).toEqual({ from: 'review', to: 'ideation' })
  })

  it('rethinkPhase returns ideation only from review', () => {
    expect(rethinkPhase(full('review'))).toBe('ideation')
    expect(rethinkPhase(full('ideation'))).toBeNull()
    expect(rethinkPhase(full('spec'))).toBeNull()
    expect(rethinkPhase(full('tickets'))).toBeNull()
    expect(rethinkPhase(full('implementation'))).toBeNull()
    expect(rethinkPhase(full('shipped'))).toBeNull()
  })

  it('is a second backward step, distinct from Fix — the forward order is untouched', () => {
    expect(rethinkPhase(full('review'))).toBe('ideation')
    expect(loopBackPhase(full('review'))).toBe('implementation')
    expect(nextPhase(full('review'))).toBe('shipped')
    expect(nextGate(full('review'))?.id).toBe('G5')
  })
})

describe('nextGate — mapped features (ADR-0001 §13.1)', () => {
  it('mapped: leaving ideation swaps G1 to all-waypoints-terminal', () => {
    expect(nextGate(mapped('ideation'))?.id).toBe('G1')
    expect(nextGate(mapped('ideation'))?.check).toBe('all-waypoints-terminal')
  })

  it('unmapped: G1 stays decisions-file-exists (unchanged behaviour)', () => {
    expect(nextGate(full('ideation'))?.check).toBe('decisions-file-exists')
  })

  it('mapping only affects G1 — every later gate is identical', () => {
    expect(nextGate(mapped('spec'))?.id).toBe('G2')
    expect(nextGate(mapped('spec'))?.check).toBe('spec-file-exists')
    expect(nextGate(mapped('tickets'))?.id).toBe('G3')
    expect(nextGate(mapped('review'))?.id).toBe('G5')
  })

  it('mapped features rejoin the normal pipeline at spec (nextPhase unchanged)', () => {
    expect(nextPhase(mapped('ideation'))).toBe('spec')
  })
})
