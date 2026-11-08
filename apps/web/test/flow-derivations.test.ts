import { describe, expect, it } from 'vitest'
import { driveView, type DriveState } from '../src/lib/feature-ui/drive'

describe('drive view', () => {
  const states: DriveState[] = ['idle', 'starting', 'serving', 'bare-checkout', 'setup-failed', 'review-agent-driving']
  it('has an honest row for all six states and merge copy only while serving', () => {
    expect(states.map((state) => driveView(state))).toHaveLength(6)
    expect(states.filter((state) => driveView(state).barTitle.includes('merge when it looks right'))).toEqual(['serving'])
    expect(driveView('bare-checkout').barDesc).toBe('Branch checked out — nothing started. This project has no dev command · Set one in Settings')
    expect(driveView('setup-failed').barTitle).toBe('Drive setup failed — fix it or stop the drive')
  })
})
