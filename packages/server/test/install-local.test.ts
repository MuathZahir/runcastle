import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  InstallLocalUsageError,
  bunGlobalManifestPath,
  globalRuncastleSpec,
  localBuildVersion,
  parseInstallLocalArgs,
  snapshotLinkTarget,
} from '../src/dev/install-local'

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

describe('snapshotLinkTarget', () => {
  const checkout = join('/', 'repo')
  const snapshot = join('/', 'tmp', 'snapshot')

  it('rebases a workspace package onto the snapshot, so the ref is what gets built', () => {
    expect(snapshotLinkTarget(join(checkout, 'packages', 'core'), checkout, snapshot)).toBe(
      join(snapshot, 'packages', 'core'),
    )
  })

  it('reuses an installed package from the checkout', () => {
    const hono = join(checkout, 'node_modules', '.bun', 'hono@4.0.0', 'node_modules', 'hono')
    expect(snapshotLinkTarget(hono, checkout, snapshot)).toBe(hono)
  })

  it('reuses a target outside the checkout', () => {
    const global = join('/', 'cache', 'bun', 'zod')
    expect(snapshotLinkTarget(global, checkout, snapshot)).toBe(global)
  })
})

describe('bunGlobalManifestPath', () => {
  const home = join('C:', 'Users', 'u')

  it('defaults to ~/.bun/install/global', () => {
    expect(bunGlobalManifestPath({}, home)).toBe(join(home, '.bun', 'install', 'global', 'package.json'))
  })

  it('follows BUN_INSTALL, and BUN_INSTALL_GLOBAL_DIR over it', () => {
    const bunInstall = join('D:', 'bun')
    const globalDir = join('E:', 'g')
    expect(bunGlobalManifestPath({ BUN_INSTALL: bunInstall }, home)).toBe(join(bunInstall, 'install', 'global', 'package.json'))
    expect(bunGlobalManifestPath({ BUN_INSTALL: bunInstall, BUN_INSTALL_GLOBAL_DIR: globalDir }, home)).toBe(join(globalDir, 'package.json'))
  })
})

describe('globalRuncastleSpec', () => {
  it('reads a registry spec or a tarball path', () => {
    expect(globalRuncastleSpec('{"dependencies":{"runcastle":"^1.4.1"}}')).toBe('^1.4.1')
    expect(globalRuncastleSpec('{"dependencies":{"runcastle":"C:/x/runcastle-1.4.1-local.ab.tgz"}}')).toBe('C:/x/runcastle-1.4.1-local.ab.tgz')
  })

  it('is null when runcastle is not installed or the manifest is missing or unreadable', () => {
    expect(globalRuncastleSpec('{"dependencies":{"@resvg/resvg-js":"^2.6.2"}}')).toBeNull()
    expect(globalRuncastleSpec('{}')).toBeNull()
    expect(globalRuncastleSpec(null)).toBeNull()
    expect(globalRuncastleSpec('{not json')).toBeNull()
  })
})
