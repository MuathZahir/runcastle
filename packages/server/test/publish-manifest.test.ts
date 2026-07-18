import { describe, expect, it } from 'vitest'
import { buildPublishedManifest } from '../scripts/publish-manifest'

/**
 * Issue #51 — `packages/server` BECOMES the published `runcastle` package,
 * assembled by the prepack build. The generated manifest is the crux the
 * reviewer flagged: it must carry the public name, drop `private`, and contain
 * NO `workspace:*` / `@runcastle/*` deps (core is bundled in), or `bun add -g
 * runcastle` fails to resolve on a clean machine.
 */

const SERVER_PKG = {
  name: '@runcastle/server',
  version: '0.0.0',
  private: true,
  type: 'module',
  bin: { runcastle: 'src/bin/runcastle.ts' },
  engines: { bun: '>=1.3.14' },
  files: ['src', 'drizzle'],
  scripts: { dev: 'bun --hot src/index.ts', prepack: 'bun run scripts/build-package.ts' },
  dependencies: {
    '@runcastle/core': 'workspace:*',
    'drizzle-orm': '0.45.2',
    hono: '4.12.30',
    zod: '4.4.3',
  },
  devDependencies: { 'bun-types': '1.3.14', 'drizzle-kit': '0.31.10' },
}

const CORE_PKG = {
  name: '@runcastle/core',
  version: '0.0.0',
  private: true,
  dependencies: { 'drizzle-orm': '0.45.2', nanoid: '6.0.0', zod: '4.4.3' },
}

function build(overrides?: { version?: string }) {
  return buildPublishedManifest({ serverPkg: SERVER_PKG, corePkg: CORE_PKG, ...overrides })
}

describe('buildPublishedManifest', () => {
  it('names the package `runcastle` and un-privates it', () => {
    const m = build()
    expect(m.name).toBe('runcastle')
    expect('private' in m).toBe(false)
  })

  it('carries NO workspace:* protocol and NO @runcastle/* dep', () => {
    const m = build()
    const deps = m.dependencies ?? {}
    for (const [name, spec] of Object.entries(deps)) {
      expect(name.startsWith('@runcastle/')).toBe(false)
      expect(String(spec).startsWith('workspace:')).toBe(false)
    }
    expect('@runcastle/core' in deps).toBe(false)
  })

  it("folds core's own runtime deps in (core is bundled, its deps become ours)", () => {
    const m = build()
    // nanoid ships only in core; it must survive into the published deps.
    expect(m.dependencies?.nanoid).toBe('6.0.0')
    // deps present in both keep a single, consistent pin.
    expect(m.dependencies?.['drizzle-orm']).toBe('0.45.2')
  })

  it('points the bin at the built JS, not the TS source', () => {
    const m = build()
    expect(m.bin).toEqual({ runcastle: './bin/runcastle.js' })
  })

  it('lists every vendored asset in `files`', () => {
    const files = build().files ?? []
    for (const f of ['index.js', 'bin', 'hook-client.ts', 'pty-host.cjs', 'drizzle', 'skills', 'web']) {
      expect(files).toContain(f)
    }
  })

  it('drops build-time scripts and devDependencies from the tarball', () => {
    const m = build()
    expect(m.devDependencies).toBeUndefined()
    expect(m.scripts?.prepack).toBeUndefined()
  })

  it('keeps the Bun engine pin', () => {
    expect(build().engines?.bun).toBe('>=1.3.14')
  })

  it('aligns the version to the release when one is given', () => {
    expect(build({ version: '1.4.2' }).version).toBe('1.4.2')
    expect(build().version).toBe('0.0.0')
  })
})
