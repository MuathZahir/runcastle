import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSET_ENV,
  applyInstalledAssetEnv,
  resolveAsset,
  vendoredAssetPaths,
} from '../src/launcher/asset-paths'

/**
 * Issue #51 — a published `runcastle` vendors its runtime assets (migrations,
 * hook client, PTY host, skills, web SPA) as real files and names them by env
 * var; a contributor checkout uses the workspace source paths. One resolver
 * covers both layouts: the env override wins and fails loudly if wrong, else the
 * workspace fallback is returned untouched.
 */

const ALL_ENV = Object.values(ASSET_ENV)

afterEach(() => {
  for (const v of ALL_ENV) delete process.env[v]
})

describe('resolveAsset', () => {
  it('returns the fallback untouched when the override is unset', () => {
    expect(resolveAsset(ASSET_ENV.migrations, '/workspace/drizzle')).toBe('/workspace/drizzle')
  })

  it('honours an override that exists on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runcastle-asset-'))
    process.env[ASSET_ENV.migrations] = dir
    expect(resolveAsset(ASSET_ENV.migrations, '/workspace/drizzle')).toBe(dir)
  })

  it('throws loudly when the override does not exist', () => {
    process.env[ASSET_ENV.hookClient] = '/nope/hook-client.ts'
    expect(() => resolveAsset(ASSET_ENV.hookClient, '/fallback')).toThrow(
      /RUNCASTLE_HOOK_CLIENT.*does not exist/,
    )
  })
})

describe('applyInstalledAssetEnv', () => {
  /** Build a package root that looks like the vendored install layout. */
  function vendoredRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'runcastle-pkg-'))
    mkdirSync(join(root, 'skills', 'packs', 'runcastle'), { recursive: true })
    mkdirSync(join(root, 'web'), { recursive: true })
    mkdirSync(join(root, 'drizzle'), { recursive: true })
    writeFileSync(join(root, 'hook-client.ts'), '')
    writeFileSync(join(root, 'pty-host.cjs'), '')
    mkdirSync(join(root, 'sandcastle-template'), { recursive: true })
    return root
  }

  it('points every asset var at the vendored copy when present', () => {
    const root = vendoredRoot()
    applyInstalledAssetEnv(root)
    const paths = vendoredAssetPaths(root)
    for (const v of ALL_ENV) expect(process.env[v]).toBe(paths[v])
  })

  it('sets nothing when the assets are not beside the root (contributor checkout)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'runcastle-src-'))
    applyInstalledAssetEnv(empty)
    for (const v of ALL_ENV) expect(process.env[v]).toBeUndefined()
  })

  it('never clobbers a var the operator already set', () => {
    const root = vendoredRoot()
    process.env[ASSET_ENV.webDist] = '/custom/web'
    applyInstalledAssetEnv(root)
    expect(process.env[ASSET_ENV.webDist]).toBe('/custom/web')
  })
})
