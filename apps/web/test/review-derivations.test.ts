import { describe, expect, it } from 'vitest'
import {
  freshness,
  latestReview,
  reviewOutcome,
  reviewWalkthroughUrl,
  stampedOutcome,
  statusChips,
  statusProperties,
  type ReviewPassFigure,
} from '../src/lib/feature-ui/review'

/**
 * simplify-the-pages decisions 3, 4, 6a–b, 8a: the Status tier states each fact
 * once. Review owns the verdict and its freshness; there is no Checks, Laps or
 * Walkthrough row; Test drive is "test-driven on lap N".
 */
describe('statusProperties', () => {
  const tickets = [{ kind: 'implementation' as const, status: 'done', lap: 2 }]
  const base = {
    artifact: { lap: 2 },
    outcome: { kind: 'verified', mode: 'gates' } as const,
    currentLap: 2,
    landedSince: 0,
    tickets,
    driveLap: null,
  }
  const rowOf = (props: Parameters<typeof statusProperties>[0], key: string) =>
    statusProperties(props).find((p) => p.key === key)

  it('states Review, Tickets, Test drive and Burn on review — no Checks or Laps', () => {
    expect(statusProperties({ ...base, runState: 'succeeded' }).map((p) => p.label)).toEqual([
      'Review',
      'Tickets',
      'Test drive',
      'Burn',
    ])
  })

  it('states Review, Tickets and Test drive on shipped — no Checks, Laps or Walkthrough', () => {
    const props = { ...base, driveLap: 2, noWalkthrough: true, runState: 'succeeded', shipped: true }
    expect(statusProperties(props).map((p) => p.label)).toEqual(['Review', 'Tickets', 'Test drive'])
  })

  describe('the Review row', () => {
    it('says a verified pass on this build with its mode', () => {
      expect(rowOf(base, 'review')).toMatchObject({ value: 'Verified', sub: 'gates mode · this build', tone: 'ok' })
    })

    it('never reads "Reviewed · this build" over a pass that verified nothing', () => {
      const row = rowOf({ ...base, outcome: { kind: 'unverified', line: null, reason: null } }, 'review')
      expect(row).toMatchObject({ value: 'Unverified', sub: 'nothing verified', tone: 'warn' })
    })

    it('ambers a verified pass later work has left behind, laps ago and what landed since', () => {
      const row = rowOf({ ...base, artifact: { lap: 1 }, currentLap: 3, landedSince: 3 }, 'review')
      expect(row).toMatchObject({ value: 'Verified 2 laps ago', sub: '3 landed since', tone: 'warn' })
    })

    it('says "Not reviewed yet" when no pass has finished', () => {
      expect(rowOf({ ...base, artifact: null, outcome: { kind: 'none' } }, 'review')?.value).toBe('Not reviewed yet')
    })

    it('reads the verdict off the stamped pass', () => {
      const pass = (over: Partial<ReviewPassFigure>): ReviewPassFigure => ({
        ticketId: 't1',
        seq: 1,
        lap: 1,
        passKind: 'review',
        reviewMode: 'gates',
        reviewVerdict: 'verified',
        reviewVerdictReason: null,
        completedAt: 10,
        videoUrl: null,
        ...over,
      })
      const passes = [pass({}), pass({ ticketId: 't2', seq: 2, lap: 2, reviewVerdict: 'unverified', completedAt: 20 })]
      expect(stampedOutcome({ passes, tickets: [] }).kind).toBe('unverified')
      expect(stampedOutcome({ passes: [], tickets: [] }).kind).toBe('none')
    })
  })

  it('reads the Test drive row as the lap it was taken in, amber when a later lap went undriven', () => {
    expect(rowOf({ ...base, driveLap: 1 }, 'drive')).toMatchObject({ value: 'Lap 1', sub: 'not since', tone: 'warn' })
    expect(rowOf({ ...base, driveLap: 2 }, 'drive')).toMatchObject({ value: 'Lap 2', tone: 'ok' })
    expect(rowOf(base, 'drive')).toMatchObject({ value: 'Not run' })
  })
})

describe('latest review evidence', () => {
  it('orders by completion time, then sequence, with null completion losing', () => {
    const rows = [{ seq: 9, completedAt: null }, { seq: 2, completedAt: 20 }, { seq: 3, completedAt: 20 }, { seq: 1, completedAt: 30 }]
    expect(latestReview(rows)?.seq).toBe(1)
    expect(latestReview(rows.slice(0, 3))?.seq).toBe(3)
  })
  it('uses completion ordering for outcomes and walkthroughs', () => {
    expect(reviewOutcome({ tickets: [{ kind: 'review', status: 'done', seq: 2, completedAt: 5 }, { kind: 'review', status: 'failed', seq: 1, completedAt: 10 }] }).state).toBe('failed')
    expect(reviewWalkthroughUrl([{ hasVideo: true, videoUrl: '/new', seq: 1, completedAt: 10 }, { hasVideo: true, videoUrl: '/old', seq: 2, completedAt: 5 }])).toBe('/new')
  })
})

describe('review freshness', () => {
  const artifact = { lap: 1 }
  it.each([
    [undefined, { landedSince: 0 }, undefined, 'none', 'no review yet'],
    [artifact, { landedSince: 0, lap: 1 }, undefined, 'fresh', 'Reviewed ✓ · this build'],
    [artifact, { landedSince: 2, lap: 1 }, undefined, 'stale', 'Reviewed earlier this lap · 2 tickets landed since — evidence may be outdated'],
    [artifact, { landedSince: 5, lap: 3 }, undefined, 'stale', 'Reviewed 2 laps ago · 5 tickets landed since — evidence may be outdated'],
    [artifact, { landedSince: 2 }, { state: 'running' as const }, 'verifying', 'Verification running — evidence below predates it'],
    [artifact, { landedSince: 2 }, { state: 'failed' as const, reason: 'recorder exited' }, 'failed', 'verification could not run: recorder exited'],
  ])('derives %s freshness', (a, branch, verification, tone, text) => expect(freshness(a, branch, verification)).toEqual({ tone, text }))
})

describe('status chips', () => {
  it('orders chips and excludes review tickets while surfacing waived work', () => {
    const chips = statusChips({ artifact: { lap: 2 }, currentLap: 2, landedSince: 0, checks: { passed: 2, total: 2 }, runState: 'succeeded', tickets: [{ kind: 'implementation', status: 'done', lap: 2 }, { kind: 'implementation', status: 'cancelled', lap: 2 }, { kind: 'review', status: 'done', lap: 2 }] })
    expect(chips.map((chip) => chip.key)).toEqual(['review', 'checks', 'lap', 'run'])
    expect(chips[2]?.label).toBe('Lap 2 · 1 of 2 tickets landed · 1 waived')
  })

  /**
   * Decision 8: the unverified-drive caveat is a chip in the state line, beside
   * the Test drive control it is about — and only when there is something to
   * caveat. It was a paragraph on the next-step bar until ticket 2 stopped it.
   */
  it('folds the unverified-drive caveat in as one chip, only when it applies', () => {
    const input = { currentLap: 1, landedSince: 0, checks: { passed: 1, total: 1 }, runState: 'succeeded', tickets: [] }
    expect(statusChips(input).map((chip) => chip.key)).not.toContain('unverified')
    expect(statusChips({ ...input, unverifiedKeys: [] }).map((chip) => chip.key)).not.toContain('unverified')

    const chips = statusChips({ ...input, unverifiedKeys: ['driveSetupCommand', 'devCommand'] })
    const chip = chips.find((c) => c.key === 'unverified')
    expect(chips.map((c) => c.key)).toEqual(['review', 'checks', 'unverified', 'lap', 'run'])
    expect(chip).toMatchObject({ label: '2 checks unverified in drive', tone: 'warn' })
    // The whole sentence is what the chip opens on — the label only counts.
    expect(chip?.detail).toContain('never proven by a dry run')
    expect(statusChips({ ...input, unverifiedKeys: ['devCommand'] }).find((c) => c.key === 'unverified')?.label).toBe('1 check unverified in drive')
  })
})
