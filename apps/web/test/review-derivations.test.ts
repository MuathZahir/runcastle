import { describe, expect, it } from 'vitest'
import {
  freshness,
  latestReview,
  reviewOutcome,
  reviewWalkthroughUrl,
  stampedOutcome,
  stampedReview,
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

  it('shows no commit for a run whose feature branch never resolved', () => {
    expect(gateCheckLines({ status: 'couldnt_run', commit: '', reason: 'x', outputUrl: null }).commit).toBeNull()
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
 * Walkthrough row; Test drive says whether the build was driven.
 */
describe('statusProperties', () => {
  const tickets = [{ kind: 'implementation' as const, status: 'done', completedAt: 10 }]
  const base = {
    artifact: { ticketId: 't1' },
    outcome: { kind: 'verified', mode: 'gates' } as const,
    landedSince: 0,
    tickets,
    drivenAt: null,
  }
  const rowOf = (props: Parameters<typeof statusProperties>[0], key: string) =>
    statusProperties(props).find((p) => p.key === key)

  it('states Review, Tickets, Test drive and Round on review — no Checks or Laps', () => {
    expect(statusProperties({ ...base, runState: 'succeeded' }).map((p) => p.label)).toEqual([
      'Review',
      'Tickets',
      'Test drive',
      'Round',
    ])
  })

  it('states Review, Tickets and Test drive on shipped — no Checks, Laps or Walkthrough', () => {
    const props = { ...base, drivenAt: 20, noWalkthrough: true, runState: 'succeeded', shipped: true }
    expect(statusProperties(props).map((p) => p.label)).toEqual(['Review', 'Tickets', 'Test drive'])
  })

  /** Decision 9a: building gets the same Status tier, led by the burn. */
  describe('while building', () => {
    const building = {
      artifact: null,
      outcome: { kind: 'none' } as const,
      landedSince: 0,
      runState: 'running',
      building: { elapsed: '12m' },
      tickets: [
        { kind: 'implementation' as const, status: 'done' },
        { kind: 'implementation' as const, status: 'done' },
        { kind: 'implementation' as const, status: 'burning' },
        { kind: 'implementation' as const, status: 'pending' },
        { kind: 'review' as const, status: 'pending' },
      ],
    }

    it('states Round, Tickets and Review — no Test drive', () => {
      expect(statusProperties({ ...building, drivenAt: null }).map((p) => p.label)).toEqual([
        'Round',
        'Tickets',
        'Review',
      ])
    })

    it('says the burn’s status with its elapsed time beside it', () => {
      expect(rowOf(building, 'run')).toMatchObject({ value: 'Running', sub: '12m' })
      expect(rowOf({ ...building, runState: 'failed' }, 'run')).toMatchObject({ value: 'Failed', tone: 'danger' })
    })

    it('counts the feature’s work tickets, never the review pass', () => {
      expect(rowOf(building, 'tickets')).toMatchObject({ value: '2 of 4 landed', sub: '1 running' })
    })

    it('reads a review still to come as quiet, not amber', () => {
      expect(rowOf(building, 'review')).toMatchObject({ value: 'Not reviewed yet', tone: 'idle' })
    })
  })

  it('leaves waived tickets out of the total and says them on their own', () => {
    const waived = [...tickets, { kind: 'implementation' as const, status: 'cancelled' }]
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

    it('ambers a verified pass later work has left behind, and what landed since', () => {
      const row = rowOf({ ...base, landedSince: 3 }, 'review')
      expect(row).toMatchObject({ value: 'Verified earlier', sub: '3 landed since', tone: 'warn' })
    })

    it('says "Not reviewed yet" when no pass has finished', () => {
      expect(rowOf({ ...base, artifact: null, outcome: { kind: 'none' } }, 'review')?.value).toBe('Not reviewed yet')
    })

    it('reads the verdict off the stamped pass', () => {
      const pass = (over: Partial<ReviewPassFigure>): ReviewPassFigure => ({
        ticketId: 't1',
        seq: 1,
        passKind: 'review',
        reviewMode: 'gates',
        reviewVerdict: 'verified',
        reviewVerdictReason: null,
        completedAt: 10,
        videoUrl: null,
        ...over,
      })
      const passes = [pass({}), pass({ ticketId: 't2', seq: 2, reviewVerdict: 'unverified', completedAt: 20 })]
      expect(stampedOutcome({ passes, tickets: [] }).kind).toBe('unverified')
      expect(stampedOutcome({ passes: [], tickets: [] }).kind).toBe('none')
    })

    /** The walked contradiction: a pass that finished before completion was stamped. */
    it('reads "Reviewed" over a finished pass that carries no completion stamp', () => {
      const legacy = { ticketId: 't8', seq: 8, completedAt: null, landedSince: 0 }
      const tickets = [{ id: 't8', kind: 'review' as const, status: 'done' }]
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
      const row = rowOf({ ...base, artifact: { ticketId: 't1', gateRun: ran('abc1234def', 'passed') } }, 'review')
      expect(row).toMatchObject({ value: 'Verified', sub: 'gates mode · this build · checks 2/2 passed @abc1234', tone: 'ok' })
    })

    it("says when checks couldn't run or none are configured — never passed", () => {
      const couldnt: ReviewGateRunWire = { status: 'couldnt_run', commit: 'abc1234def', reason: 'install failed', outputUrl: null }
      expect(rowOf({ ...base, artifact: { ticketId: 't1', gateRun: couldnt } }, 'review')?.sub).toBe(
        "gates mode · this build · checks couldn't run",
      )
      expect(rowOf({ ...base, artifact: { ticketId: 't1', gateRun: { status: 'none_configured' } } }, 'review')?.sub).toBe(
        'gates mode · this build · no checks configured',
      )
    })

    it('says nothing about checks for a pass with no gate run recorded', () => {
      expect(rowOf({ ...base, artifact: { ticketId: 't1', gateRun: null } }, 'review')?.sub).toBe('gates mode · this build')
    })

    it("leaves an earlier pass's failure the latest pass fixed out of the headline", () => {
      const row = (over: Partial<ReviewArtifactFigure>): ReviewArtifactFigure => ({
        ticketId: 't1',
        seq: 1,
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

  it('reads the Test drive row as taken, amber when work landed after the drive', () => {
    expect(rowOf({ ...base, drivenAt: 5 }, 'drive')).toMatchObject({ value: 'Taken', sub: 'not since', tone: 'warn' })
    expect(rowOf({ ...base, drivenAt: 20 }, 'drive')).toMatchObject({ value: 'Taken', tone: 'ok' })
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
  const artifact = {}
  it.each([
    [undefined, { landedSince: 0 }, undefined, 'none', 'no review yet'],
    [artifact, { landedSince: 0 }, undefined, 'fresh', 'Reviewed ✓ · this build'],
    [artifact, { landedSince: 2 }, undefined, 'stale', 'Reviewed earlier · 2 tickets landed since — evidence may be outdated'],
    [artifact, { landedSince: 5 }, undefined, 'stale', 'Reviewed earlier · 5 tickets landed since — evidence may be outdated'],
    [artifact, { landedSince: 2 }, { state: 'running' as const }, 'verifying', 'Verification running — evidence below predates it'],
    [artifact, { landedSince: 2 }, { state: 'failed' as const, reason: 'recorder exited' }, 'failed', 'verification could not run: recorder exited'],
  ])('derives %s freshness', (a, branch, verification, tone, text) => expect(freshness(a, branch, verification)).toEqual({ tone, text }))
})
