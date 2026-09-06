import { describe, expect, it } from 'vitest'
import { freshness, latestReview, reviewOutcome, reviewWalkthroughUrl, statusChips } from '../src/lib/feature-ui/review'

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
})
