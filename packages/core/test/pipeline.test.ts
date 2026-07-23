import { describe, expect, it } from 'vitest'
import { PIPELINE, nextGate, nextPhase } from '../src/pipeline'
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
