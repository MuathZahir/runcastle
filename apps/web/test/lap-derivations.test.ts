import { describe, expect, it } from 'vitest'
import { burnLabel, lapChip, triageFooter } from '../src/lib/feature-ui/laps'

describe('lap chip', () => {
  const tickets = [
    { kind: 'implementation' as const, status: 'done', lap: 2 },
    { kind: 'review' as const, status: 'done', lap: 2 },
    { kind: 'implementation' as const, status: 'done', lap: 1, landedLap: 2 },
  ]
  it('counts implementation landings in their landing lap and excludes review', () => {
    expect(lapChip(tickets, { lap: 2, lapSessionRan: true })).toEqual({ label: 'Lap 2 · 2 of 2 tickets landed', story: "Lap 2's session digested your notes and emitted this lap's tickets", promotedFromEarlier: 1 })
  })
  it('uses future tense before the session runs', () => expect(lapChip([], { lap: 2 }).story).toBe("Lap 2 is open — its session will digest your notes and emit this lap's tickets"))
})

describe('triage and burn copy', () => {
  it('summarizes minted, carried, and standing work', () => {
    expect(triageFooter({ quickFix: 2, carried: 4, nextLap: 3, standing: [{ count: 3, lap: 1 }] })).toBe('2 tickets will mint · 4 notes carried into the lap conversation · 3 unburned fix tickets from lap 1 will burn with these')
    expect(triageFooter({ quickFix: 0, carried: 2, nextLap: 3, standing: [] })).toContain('review what you\'re bringing to the conversation → Start lap 3')
  })
  it('labels mixed-lap pending work', () => expect(burnLabel([{ lap: 2 }, { lap: 2 }, { lap: 1 }, { lap: 1 }], 2)).toBe('Burn 4 tickets — 2 from lap 2 · 2 carried from lap 1'))
})
