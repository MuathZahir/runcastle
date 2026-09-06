import { describe, expect, it } from 'vitest'
import { driveView, type DriveState } from '../src/lib/feature-ui/drive'
import { burnExpectation, laneState, repoRelative, runHeadline, stripProtocolTokens, summaryCounts, verdictStrip } from '../src/lib/feature-ui/run'

describe('drive view', () => {
  const states: DriveState[] = ['idle', 'starting', 'serving', 'bare-checkout', 'setup-failed', 'review-agent-driving']
  it('has an honest row for all six states and merge copy only while serving', () => {
    expect(states.map((state) => driveView(state))).toHaveLength(6)
    expect(states.filter((state) => driveView(state).barTitle.includes('merge when it looks right'))).toEqual(['serving'])
    expect(driveView('bare-checkout').barDesc).toBe('Branch checked out — nothing started. This project has no dev command · Set one in Settings')
    expect(driveView('setup-failed').barTitle).toBe('Drive setup failed — fix it or stop the drive')
  })
})

describe('run derivations', () => {
  it('separates stopped, launch failures, waived, and failures', () => {
    expect(laneState({ seq: 1, status: 'failed', error: 'stopped by user' })).toBe('stopped')
    expect(laneState({ seq: 1, status: 'failed', error: 'docker mount failed', hadOutput: false })).toBe('launch-failed')
    expect(laneState({ seq: 1, status: 'cancelled' })).toBe('waived')
    expect(summaryCounts([{ seq: 1, status: 'failed', error: 'orphaned — run ended' }, { seq: 2, status: 'failed', error: 'boom' }])).toMatchObject({ stopped: 1, failed: 1 })
  })
  it('explains verdicts and known launch causes', () => {
    expect(verdictStrip({ seq: 1, status: 'failed', error: 'agent made no commits' })?.text).toContain('none did')
    expect(verdictStrip({ seq: 1, status: 'failed', error: 'docker mount failed: Windows path too long', hadOutput: false })?.hint).toContain('Windows')
  })
  it('writes honest headlines', () => {
    const tickets = [{ seq: 1, status: 'done' }, { seq: 2, status: 'failed', error: 'boom' }, { seq: 3, status: 'failed', error: 'stopped by user' }, { seq: 4, status: 'done', reviewFix: true }]
    expect(runHeadline(tickets)).toBe('Burning 3 tickets · +1 fixes from review · 2 done · 1 failed · 1 stopped')
    expect(runHeadline(tickets, {}, 4)).toBe('Retrying #4')
  })
  it('cleans transcript protocol and sandbox paths', () => {
    expect(stripProtocolTokens('done\n<promise>COMPLETE</promise>')).toBe('done')
    expect(repoRelative('/home/agent/cache/slots/3/repo/src/App.tsx')).toBe('src/App.tsx')
    expect(repoRelative('C:\\temp\\repo\\src\\App.tsx')).toBe('src\\App.tsx')
  })
  it('sets a burn expectation from history, and stays generic without it', () => {
    expect(burnExpectation({ medianMs: 132_000, sampleSize: 9 })).toBe('Tickets have been taking ~2 min each.')
    expect(burnExpectation({ medianMs: 40_000, sampleSize: 2 })).toBe('Tickets have been taking under a minute each.')
    expect(burnExpectation({ medianMs: 5_400_000, sampleSize: 4 })).toBe('Tickets have been taking ~1.5h each.')
    expect(burnExpectation({ medianMs: 0, sampleSize: 0 })).toBe('Typically a few minutes per ticket.')
    expect(burnExpectation()).toBe('Typically a few minutes per ticket.')
  })
})
