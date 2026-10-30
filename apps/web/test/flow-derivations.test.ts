import { describe, expect, it } from 'vitest'
import { driveView, type DriveState } from '../src/lib/feature-ui/drive'
import { burnExpectation, laneState, repoRelative, stripProtocolTokens } from '../src/lib/feature-ui/run'

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
    // The run halt stops a doomed lane the same way a human does.
    expect(laneState({ seq: 1, status: 'failed', error: 'stopped: run halted (usage limit reached)' })).toBe('stopped')
    expect(laneState({ seq: 1, status: 'failed', error: 'docker mount failed', hadOutput: false })).toBe('launch-failed')
    expect(laneState({ seq: 1, status: 'cancelled' })).toBe('waived')
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
