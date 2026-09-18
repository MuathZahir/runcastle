import { describe, expect, it } from 'vitest'
import {
  PIPELINE,
  completedPlanningSteps,
  isPastPhase,
  nextPhase,
  nextPlanningStep,
} from '../src/pipeline'
import type { Phase } from '../src/schemas'

const feature = (phase: Phase) => ({ phase })

describe('the feature lifecycle', () => {
  it('contains exactly the four forward states', () => {
    expect(PIPELINE).toEqual(['planning', 'building', 'review', 'shipped'])
  })

  it('moves forward one state and stops at shipped', () => {
    expect(nextPhase(feature('planning'))).toBe('building')
    expect(nextPhase(feature('building'))).toBe('review')
    expect(nextPhase(feature('review'))).toBe('shipped')
    expect(nextPhase(feature('shipped'))).toBeNull()
  })

  it('recognizes only states strictly in the past', () => {
    expect(isPastPhase(feature('review'), 'planning')).toBe(true)
    expect(isPastPhase(feature('review'), 'review')).toBe(false)
    expect(isPastPhase(feature('planning'), 'review')).toBe(false)
  })
})

describe('planning progress', () => {
  it('derives completed steps directly from artifact facts', () => {
    expect(completedPlanningSteps({ hasDecisions: true, hasSpec: false, hasTickets: true })).toEqual([
      'ideation',
      'tickets',
    ])
  })

  it.each([
    [{ hasDecisions: false, hasSpec: false, hasTickets: false }, 'ideation'],
    [{ hasDecisions: true, hasSpec: false, hasTickets: false }, 'spec'],
    [{ hasDecisions: true, hasSpec: true, hasTickets: false }, 'tickets'],
    [{ hasDecisions: true, hasSpec: true, hasTickets: true }, null],
  ] as const)('derives the next step from %o', (facts, expected) => {
    expect(nextPlanningStep(facts)).toBe(expected)
  })
})
