import { describe, expect, it } from 'vitest'
import {
  freshness,
  latestReview,
  reviewOutcome,
  reviewWalkthroughUrl,
  stampedOutcome,
  stampedReview,
  statusChips,
  statusProperties,
  type ReviewArtifactFigure,
  type ReviewPassFigure,
} from '../src/lib/feature-ui/review'
import { gateCheckLines } from '../src/lib/feature-ui/checks'
import type { ReviewGateRunWire } from '../src/lib/reviews'

/**
 * Gates-mode decision 6: a pass's Checks are the server's record, said as it
 * is — nothing reads "passed" that the record does not report passed.
 */
describe('gateCheckLines', () => {
  it('says a project with no verify commands has none', () => {
    expect(gateCheckLines({ status: 'none_configured' })).toEqual({
      summary: 'No checks configured for this project',
      short: 'no checks configured',
      commit: null,
      tone: 'idle',
      lines: [],
    })
  })

  it("says a run that could not complete couldn't run, with its reason and output", () => {
    const checks = gateCheckLines({
      status: 'couldnt_run',
      commit: 'fedcba9876543',
      reason: 'dependency install failed',
      outputUrl: '/api/reviews/ticket/t1/gates/run.log',
    })
    expect(checks).toMatchObject({
      summary: "Checks couldn't run: dependency install failed",
      commit: 'fedcba9',
      tone: 'warn',
      lines: [],
      outputUrl: '/api/reviews/ticket/t1/gates/run.log',
    })
    expect(gateCheckLines({ status: 'couldnt_run', commit: 'fedcba9876543', reason: 'no sandbox', outputUrl: null }))
      .not.toHaveProperty('outputUrl')
  })

  it('gives one line per command, with exit code, reason and output only where not green', () => {
    const checks = gateCheckLines({
      status: 'ran',
      commit: 'abc1234def567',
      commands: [
        { command: 'bun run typecheck', outcome: 'passed', exitCode: 0, outputUrl: '/o/typecheck' },
        { command: 'bun run test', outcome: 'failed', exitCode: 1, outputUrl: '/o/test' },
        { command: 'bun run lint', outcome: 'couldnt_run', exitCode: null, reason: 'timed out after 15 minutes', outputUrl: '/o/lint' },
      ],
    })
    expect(checks).toEqual({
      summary: '1 of 3 checks passed',
      short: 'checks 1/3 passed @abc1234',
      commit: 'abc1234',
      tone: 'danger',
      lines: [
        { label: 'bun run typecheck', state: 'passed' },
        { label: 'bun run test', state: 'failed', detail: 'exit 1', outputUrl: '/o/test' },
        { label: 'bun run lint', state: 'couldnt_run', detail: 'timed out after 15 minutes', outputUrl: '/o/lint' },
      ],
    })
  })

  it('is green only when every command passed', () => {
    const all = gateCheckLines({
      status: 'ran',
      commit: 'abc1234def567',
      commands: [{ command: 'bun run test', outcome: 'passed', exitCode: 0, outputUrl: '/o/test' }],
    })
    expect(all).toMatchObject({ summary: '1 of 1 checks passed', tone: 'ok' })
    const timedOut = gateCheckLines({
      status: 'ran',
      commit: 'abc1234def567',
      commands: [{ command: 'bun run test', outcome: 'couldnt_run', exitCode: null, outputUrl: '/o/test' }],
    })
    expect(timedOut).toMatchObject({ summary: '0 of 1 checks passed', tone: 'warn' })
    expect(timedOut.lines).toEqual([{ label: 'bun run test', state: 'couldnt_run', outputUrl: '/o/test' }])
  })
})

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

  /** Decision 9a: building gets the same Status tier, led by the burn. */
  describe('while building', () => {
    const building = {
      artifact: null,
      outcome: { kind: 'none' } as const,
      currentLap: 1,
      landedSince: 0,
      runState: 'running',
      building: { elapsed: '12m' },
      tickets: [
        { kind: 'implementation' as const, status: 'done', lap: 1 },
        { kind: 'implementation' as const, status: 'done', lap: 1 },
        { kind: 'implementation' as const, status: 'burning', lap: 1 },
        { kind: 'implementation' as const, status: 'pending', lap: 1 },
        { kind: 'review' as const, status: 'pending', lap: 1 },
      ],
    }

    it('states Burn, Tickets and Review — no Test drive', () => {
      expect(statusProperties({ ...building, driveLap: null }).map((p) => p.label)).toEqual([
        'Burn',
        'Tickets',
        'Review',
      ])
    })

    it('says the burn’s status with its elapsed time beside it', () => {
      expect(rowOf(building, 'run')).toMatchObject({ value: 'Running', sub: '12m' })
      expect(rowOf({ ...building, runState: 'failed' }, 'run')).toMatchObject({ value: 'Failed', tone: 'danger' })
    })

    it('counts this lap’s work tickets, never the review pass', () => {
      expect(rowOf(building, 'tickets')).toMatchObject({ value: '2 of 4 landed', sub: '1 burning' })
    })

    it('counts the lap a past run’s record belongs to', () => {
      const tickets = [...building.tickets, { kind: 'implementation' as const, status: 'done', lap: 2 }]
      const record = { ...building, tickets, currentLap: 2, building: { lap: 1 } }
      expect(rowOf(record, 'tickets')?.value).toBe('2 of 4 landed')
    })

    it('reads a review still to come as quiet, not amber', () => {
      expect(rowOf(building, 'review')).toMatchObject({ value: 'Not reviewed yet', tone: 'idle' })
    })
  })

  it('leaves waived tickets out of the total and says them on their own', () => {
    const waived = [...tickets, { kind: 'implementation' as const, status: 'cancelled', lap: 2 }]
    expect(rowOf({ ...base, tickets: waived }, 'tickets')).toMatchObject({
      value: '1 of 1 landed',
      sub: '1 waived',
      tone: 'warn',
    })
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

    /** The walked contradiction: a pass that finished before completion was stamped. */
    it('reads "Reviewed" over a finished pass that carries no completion stamp', () => {
      const legacy = { ticketId: 't8', seq: 8, lap: 2, completedAt: null, landedSince: 0 }
      const tickets = [{ id: 't8', lap: 2, kind: 'review' as const, status: 'done' }]
      const artifact = stampedReview([legacy], tickets)
      expect(artifact?.seq).toBe(8)
      expect(rowOf({ ...base, artifact, outcome: { kind: 'none' } }, 'review')).toMatchObject({ value: 'Reviewed', tone: 'ok' })
      // A pass still burning vouches for nothing, stamp or no stamp.
      expect(stampedReview([legacy], [{ ...tickets[0]!, status: 'burning' }])).toBeNull()
    })
  })

  /** Gates-mode decision 6: the headline carries only the latest pass's checks. */
  describe("the Review row's checks", () => {
    const ran = (commit: string, outcome: 'passed' | 'failed'): ReviewGateRunWire => ({
      status: 'ran',
      commit,
      commands: [
        { command: 'bun run typecheck', outcome: 'passed', exitCode: 0, outputUrl: '/o/1' },
        { command: 'bun run test', outcome, exitCode: outcome === 'passed' ? 0 : 1, outputUrl: '/o/2' },
      ],
    })

    it("adds the stamped pass's checks to the sub-note, with the sha they ran on", () => {
      const row = rowOf({ ...base, artifact: { lap: 2, gateRun: ran('abc1234def', 'passed') } }, 'review')
      expect(row).toMatchObject({ value: 'Verified', sub: 'gates mode · this build · checks 2/2 passed @abc1234', tone: 'ok' })
    })

    it("says when checks couldn't run or none are configured — never passed", () => {
      const couldnt: ReviewGateRunWire = { status: 'couldnt_run', commit: 'abc1234def', reason: 'install failed', outputUrl: null }
      expect(rowOf({ ...base, artifact: { lap: 2, gateRun: couldnt } }, 'review')?.sub).toBe(
        "gates mode · this build · checks couldn't run",
      )
      expect(rowOf({ ...base, artifact: { lap: 2, gateRun: { status: 'none_configured' } } }, 'review')?.sub).toBe(
        'gates mode · this build · no checks configured',
      )
    })

    it('says nothing about checks for a pass with no gate run recorded', () => {
      expect(rowOf({ ...base, artifact: { lap: 2, gateRun: null } }, 'review')?.sub).toBe('gates mode · this build')
    })

    it("leaves an earlier pass's failure the latest pass fixed out of the headline", () => {
      const row = (over: Partial<ReviewArtifactFigure>): ReviewArtifactFigure => ({
        ticketId: 't1',
        seq: 1,
        lap: 2,
        passKind: 'review',
        reviewedCommit: null,
        completedAt: 10,
        landedSince: 0,
        hasVideo: false,
        videoUrl: null,
        ...over,
      })
      const passes = [
        row({ gateRun: ran('1111111aaa', 'failed') }),
        row({ ticketId: 't2', seq: 3, passKind: 'verification', completedAt: 20, gateRun: ran('2222222bbb', 'passed') }),
      ]
      const tickets = passes.map((p) => ({ id: p.ticketId, status: 'done' }))
      const sub = rowOf({ ...base, artifact: stampedReview(passes, tickets) }, 'review')?.sub
      expect(sub).toBe('gates mode · this build · checks 2/2 passed @2222222')
      expect(sub).not.toContain('1111111')
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
