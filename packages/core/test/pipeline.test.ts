import { describe, expect, it } from 'vitest'
import { PIPELINE, nextGate, nextPhase } from '../src/pipeline'
import type { Phase } from '../src/schemas'

const full = (phase: Phase) => ({ phase, size: 'full' as const })
const collapsed = (phase: Phase) => ({ phase, size: 'collapsed' as const })

describe('nextPhase — full features', () => {
  it('walks every phase in order', () => {
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

describe('nextPhase — collapsed features', () => {
  it('skips spec when leaving ideation', () => {
    expect(nextPhase(collapsed('ideation'))).toBe('tickets')
  })

  it('behaves like full from tickets onward', () => {
    expect(nextPhase(collapsed('tickets'))).toBe('implementation')
    expect(nextPhase(collapsed('implementation'))).toBe('review')
    expect(nextPhase(collapsed('review'))).toBe('shipped')
    expect(nextPhase(collapsed('shipped'))).toBeNull()
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

  it('collapsed: leaving ideation is still guarded by G1', () => {
    expect(nextGate(collapsed('ideation'))?.id).toBe('G1')
    expect(nextGate(collapsed('ideation'))?.check).toBe('decisions-file-exists')
  })

  it('returns null at the terminal phase', () => {
    expect(nextGate(full('shipped'))).toBeNull()
    expect(nextGate(collapsed('shipped'))).toBeNull()
  })
})
