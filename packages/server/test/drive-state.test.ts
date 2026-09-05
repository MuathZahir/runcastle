import type { DriveInfo } from '../src/services/git'
import { describe, expect, it } from 'vitest'
import { deriveDriveState } from '../src/services/git'

const base: Omit<DriveInfo, 'state'> = {
  branch: 'feature/example',
  devConfigured: true,
  devReady: false,
}

describe('deriveDriveState', () => {
  it.each([
    [null, 'idle'],
    [{ ...base }, 'starting'],
    [{ ...base, devReady: true }, 'serving'],
    [{ ...base, devConfigured: false }, 'bare-checkout'],
    [{ ...base, hookFailure: { command: 'setup', exitCode: 1, timedOut: false, output: 'bad' } }, 'setup-failed'],
    [{ ...base, purpose: 'review' }, 'review-agent-driving'],
  ] as const)('maps drive information to %s', (input, expected) => {
    expect(deriveDriveState(input)).toBe(expected)
  })
})
