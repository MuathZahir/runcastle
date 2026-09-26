import { describe, expect, it } from 'vitest'
import { InstallLocalUsageError, localBuildVersion, parseInstallLocalArgs } from '../src/dev/install-local'

/** `bun run install:local` — the argv parse and the local version stamp. */
describe('parseInstallLocalArgs', () => {
  it('builds main with a fresh install and no checks by default', () => {
    expect(parseInstallLocalArgs([])).toEqual({ ref: 'main', install: true, check: false, skipRunningCheck: false })
  })

  it('takes an optional ref and the three flags in any order', () => {
    expect(parseInstallLocalArgs(['--check', 'feature/x', '--no-install', '--skip-running-check'])).toEqual({
      ref: 'feature/x',
      install: false,
      check: true,
      skipRunningCheck: true,
    })
  })

  it('rejects an unknown flag', () => {
    expect(() => parseInstallLocalArgs(['--yes'])).toThrow(InstallLocalUsageError)
  })

  it('rejects more than one ref', () => {
    expect(() => parseInstallLocalArgs(['main', 'dev'])).toThrow(InstallLocalUsageError)
  })
})

describe('localBuildVersion', () => {
  it('stamps the highest release tag with -local.<sha>', () => {
    expect(localBuildVersion(['v1.3.9', 'v1.4.1', 'v1.4.0', 'v1.10.0-beta.1'], 'ebc6eaab')).toBe(
      '1.10.0-beta.1-local.ebc6eaab',
    )
    expect(localBuildVersion(['v1.4.1', 'v1.4.1-beta.2'], 'ebc6eaab')).toBe('1.4.1-local.ebc6eaab')
  })

  it('ignores tags that are not release tags', () => {
    expect(localBuildVersion(['v2-wip', 'nightly', 'v1.4.1'], 'abc1234')).toBe('1.4.1-local.abc1234')
  })

  it('falls back to 0.0.0 when no release tag exists', () => {
    expect(localBuildVersion([], 'abc1234')).toBe('0.0.0-local.abc1234')
  })
})
