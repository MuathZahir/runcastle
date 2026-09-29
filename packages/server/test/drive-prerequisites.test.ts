import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOST_PROBE_TTL_MS,
  drivePrerequisites,
  resetDrivePrerequisiteCache,
} from '../src/services/drive-prerequisites'
import type { DriveHostProbe } from '../src/workflows/review-ticket'

/**
 * The review page's standing notice reads this before any review runs: every
 * drive prerequisite the host is missing, in the review's own prose plus the
 * operator's fix — and nothing at all when a drive can be offered.
 */
const HEALTHY: DriveHostProbe = {
  browserPath: '/usr/bin/agent-browser',
  browserFailure: undefined,
  ffmpegPath: '/usr/bin/ffmpeg',
}

function probeOf(probe: Partial<DriveHostProbe>) {
  return vi.fn(() => ({ ...HEALTHY, ...probe }))
}

afterEach(() => resetDrivePrerequisiteCache())

describe('drivePrerequisites', () => {
  it('reports nothing missing when the host and project can drive', () => {
    expect(drivePrerequisites({ devCommand: 'bun dev' }, { probe: probeOf({}) })).toEqual({ missing: [] })
  })

  it('reports a missing ffmpeg with its install hint', () => {
    const { missing } = drivePrerequisites({ devCommand: 'bun dev' }, { probe: probeOf({ ffmpegPath: undefined }) })
    expect(missing).toEqual([
      {
        piece: 'ffmpeg',
        reason: "`ffmpeg` is not on this machine's PATH, so a drive cannot be recorded",
        notice: 'ffmpeg not installed — install it and restart runcastle',
      },
    ])
  })

  it('reports a missing agent-browser', () => {
    const { missing } = drivePrerequisites({ devCommand: 'bun dev' }, { probe: probeOf({ browserPath: undefined }) })
    expect(missing.map((m) => m.piece)).toEqual(['agent-browser'])
    expect(missing[0]?.notice).toBe('agent-browser not installed — install it and restart runcastle')
  })

  it('reports an agent-browser that failed its health check, naming the failure', () => {
    const { missing } = drivePrerequisites(
      { devCommand: 'bun dev' },
      { probe: probeOf({ browserFailure: '/usr/bin/agent-browser --version: ETIMEDOUT after 3001ms' }) },
    )
    expect(missing.map((m) => m.piece)).toEqual(['agent-browser-unhealthy'])
    expect(missing[0]?.reason).toContain('ETIMEDOUT after 3001ms')
  })

  it('reports a project with no dev command', () => {
    const { missing } = drivePrerequisites({ devCommand: '  ' }, { probe: probeOf({}) })
    expect(missing.map((m) => m.piece)).toEqual(['dev-command'])
    expect(missing[0]?.reason).toBe('this project has no dev command configured, so a drive has no app to boot')
  })

  it('reports every missing piece at once', () => {
    const { missing } = drivePrerequisites(
      { devCommand: undefined },
      { probe: probeOf({ browserPath: undefined, ffmpegPath: undefined }) },
    )
    expect(missing.map((m) => m.piece)).toEqual(['agent-browser', 'ffmpeg', 'dev-command'])
  })

  it('caches the host probe rather than spawning per read, and re-probes after the TTL', () => {
    const probe = probeOf({ ffmpegPath: undefined })
    let now = 1_000
    const deps = { probe, now: () => now }
    drivePrerequisites({ devCommand: 'bun dev' }, deps)
    now += HOST_PROBE_TTL_MS - 1
    drivePrerequisites({ devCommand: 'bun dev' }, deps)
    expect(probe).toHaveBeenCalledTimes(1)
    now += 1
    drivePrerequisites({ devCommand: 'bun dev' }, deps)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('reads the dev command fresh even while the host probe is cached', () => {
    const deps = { probe: probeOf({}), now: () => 0 }
    expect(drivePrerequisites({ devCommand: 'bun dev' }, deps).missing).toEqual([])
    expect(drivePrerequisites({ devCommand: undefined }, deps).missing.map((m) => m.piece)).toEqual(['dev-command'])
  })
})
