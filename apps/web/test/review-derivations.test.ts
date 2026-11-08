import { describe, expect, it } from 'vitest'
import {
  freshness,
  latestReview,
  reviewOutcome,
  reviewWalkthroughUrl,
  stampedOutcome,
  stampedReview,
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
