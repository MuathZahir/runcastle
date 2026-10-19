import { describe, expect, it } from 'vitest'
import {
  classifyFeatureStories,
  parseStoriesConfig,
  PreviewStats,
  renderStoriesBuildCommand,
  StoriesBuildRecord,
  StoriesManifest,
  StoryIndex,
  type StoriesBase,
} from '../src/stories'

/**
 * Fixture catalogue, shaped like a `storybook build --stats-json` output:
 *
 *   CouponField.stories.tsx → CouponField.tsx → Button.tsx → tokens.ts
 *   Header.stories.tsx      → Header.tsx      → Button.tsx
 *   Footer.stories.tsx      → Footer.tsx
 */
const index = StoryIndex.parse({
  v: 5,
  entries: {
    'checkout-couponfield--expired': {
      id: 'checkout-couponfield--expired',
      title: 'checkout/CouponField',
      name: 'Expired',
      importPath: './.runcastle/stories/checkout/CouponField.stories.tsx',
      type: 'story',
      tags: ['story'],
    },
    'checkout-couponfield--docs': {
      id: 'checkout-couponfield--docs',
      title: 'checkout/CouponField',
      name: 'Docs',
      importPath: './.runcastle/stories/checkout/CouponField.stories.tsx',
      type: 'docs',
    },
    'layout-header--default': {
      id: 'layout-header--default',
      title: 'layout/Header',
      name: 'Default',
      importPath: './.runcastle/stories/layout/Header.stories.tsx',
      type: 'story',
    },
    'layout-footer--default': {
      id: 'layout-footer--default',
      title: 'layout/Footer',
      name: 'Default',
      importPath: './.runcastle/stories/layout/Footer.stories.tsx',
      type: 'story',
    },
  },
})

const stats = PreviewStats.parse({
  modules: [
    {
      id: 1,
      name: './src/CouponField.tsx',
      reasons: [{ moduleName: './.runcastle/stories/checkout/CouponField.stories.tsx' }],
    },
    {
      name: './src/Button.tsx?v=abc123',
      reasons: [{ moduleName: './src/CouponField.tsx' }, { moduleName: '.\\src\\Header.tsx' }],
    },
    { name: './src/tokens.ts', reasons: [{ moduleName: './src/Button.tsx' }] },
    {
      name: './src/Header.tsx',
      reasons: [{ moduleName: './.runcastle/stories/layout/Header.stories.tsx' }],
    },
    {
      name: './src/Footer.tsx',
      reasons: [{ moduleName: './.runcastle/stories/layout/Footer.stories.tsx' }],
    },
    // node_modules are never a path to a story, even when they import app code.
    {
      name: './node_modules/react/index.js',
      reasons: [{ moduleName: './src/Footer.tsx' }],
    },
    { name: './src/lodash-shim.ts', reasons: [{ moduleName: './node_modules/lib/x.js' }] },
  ],
})

const builtBase = (ids: string[]): StoriesBase => ({
  status: 'built',
  index: { v: 5, entries: Object.fromEntries(ids.map((id) => [id, index.entries[id]!])) },
})
const allBase = builtBase(Object.keys(index.entries))

const classify = (changedFiles: string[], base: StoriesBase = allBase) =>
  classifyFeatureStories({ changedFiles, index, stats, base }).map((s) => ({
    id: s.id,
    kind: s.kind,
    distance: s.distance,
  }))

describe('parseStoriesConfig', () => {
  it('accepts a build command with the {out} placeholder', () => {
    expect(parseStoriesConfig('{"build":"bunx storybook build --stats-json -o {out}"}')).toEqual({
      build: 'bunx storybook build --stats-json -o {out}',
    })
  })

  it('returns null for invalid JSON, a missing or empty build, or no {out}', () => {
    expect(parseStoriesConfig('{not json')).toBeNull()
    expect(parseStoriesConfig('{}')).toBeNull()
    expect(parseStoriesConfig('{"build":"  "}')).toBeNull()
    expect(parseStoriesConfig('{"build":"storybook build -o dist"}')).toBeNull()
    expect(parseStoriesConfig('null')).toBeNull()
  })

  it('renders the command with every {out} replaced by the quoted path', () => {
    const cfg = parseStoriesConfig('{"build":"sb build -o {out} && ls {out}"}')!
    expect(renderStoriesBuildCommand(cfg, '/work/.runcastle-stories out')).toBe(
      'sb build -o "/work/.runcastle-stories out" && ls "/work/.runcastle-stories out"',
    )
  })
})

describe('classifyFeatureStories', () => {
  it('marks a story whose own file changed as changed at distance 0', () => {
    expect(classify(['.runcastle/stories/layout/Footer.stories.tsx'])).toEqual([
      { id: 'layout-footer--default', kind: 'changed', distance: 0 },
    ])
  })

  it('marks a story that directly imports a changed file as changed at distance 1', () => {
    expect(classify(['src/Footer.tsx'])).toEqual([
      { id: 'layout-footer--default', kind: 'changed', distance: 1 },
    ])
  })

  it('marks a story reaching a changed file through 2+ hops as affected', () => {
    expect(classify(['src/tokens.ts'])).toEqual([
      { id: 'checkout-couponfield--expired', kind: 'affected', distance: 3 },
      { id: 'layout-header--default', kind: 'affected', distance: 3 },
    ])
    expect(classify(['src/Button.tsx'])).toEqual([
      { id: 'checkout-couponfield--expired', kind: 'affected', distance: 2 },
      { id: 'layout-header--default', kind: 'affected', distance: 2 },
    ])
  })

  it('leaves out stories no changed file reaches, and ignores docs entries', () => {
    expect(classify(['README.md', 'src/CouponField.tsx'])).toEqual([
      { id: 'checkout-couponfield--expired', kind: 'changed', distance: 1 },
    ])
  })

  it('takes the nearest changed file and sorts changed, new, affected, then by title', () => {
    const out = classify(
      ['src/Button.tsx', 'src/Header.tsx', 'src/Footer.tsx'],
      builtBase(['checkout-couponfield--expired', 'layout-header--default']),
    )
    expect(out).toEqual([
      { id: 'layout-header--default', kind: 'changed', distance: 1 },
      { id: 'layout-footer--default', kind: 'new', distance: 1 },
      { id: 'checkout-couponfield--expired', kind: 'affected', distance: 2 },
    ])
  })

  it('with base none, every match is new', () => {
    expect(classify(['src/Button.tsx', 'src/Footer.tsx'], { status: 'none' })).toEqual([
      { id: 'checkout-couponfield--expired', kind: 'new', distance: 2 },
      { id: 'layout-footer--default', kind: 'new', distance: 1 },
      { id: 'layout-header--default', kind: 'new', distance: 2 },
    ])
  })

  it('with base failed, kinds stay changed and affected', () => {
    expect(classify(['src/Button.tsx', 'src/Footer.tsx'], { status: 'failed' })).toEqual([
      { id: 'layout-footer--default', kind: 'changed', distance: 1 },
      { id: 'checkout-couponfield--expired', kind: 'affected', distance: 2 },
      { id: 'layout-header--default', kind: 'affected', distance: 2 },
    ])
  })

  it('matches regardless of ./ prefixes, backslashes and Vite ? suffixes', () => {
    // Changed file in Windows form; Button's stats name carries `?v=`, and
    // Header's import of it is recorded with backslashes.
    expect(classify(['.\\src\\Button.tsx'])).toEqual([
      { id: 'checkout-couponfield--expired', kind: 'affected', distance: 2 },
      { id: 'layout-header--default', kind: 'affected', distance: 2 },
    ])
  })

  it('ignores node_modules modules in the import list', () => {
    expect(classify(['node_modules/react/index.js'])).toEqual([])
    expect(classify(['src/lodash-shim.ts'])).toEqual([])
  })

  it('returns the full story fields', () => {
    const [story] = classifyFeatureStories({
      changedFiles: ['src/Footer.tsx'],
      index,
      stats,
      base: allBase,
    })
    expect(story).toEqual({
      id: 'layout-footer--default',
      title: 'layout/Footer',
      name: 'Default',
      importPath: './.runcastle/stories/layout/Footer.stories.tsx',
      kind: 'changed',
      distance: 1,
    })
  })
})

describe('Storybook output schemas', () => {
  it('tolerate unknown keys', () => {
    const parsed = StoryIndex.parse({ v: 5, entries: {}, extra: true })
    expect(parsed.entries).toEqual({})
    expect(PreviewStats.parse({ modules: [{ name: 'a.ts', size: 3 }], chunks: [] }).modules).toHaveLength(1)
  })
})

describe('records', () => {
  it('StoriesManifest round-trips a built feature', () => {
    const manifest = {
      featureId: 'f1',
      commit: 'abc1234',
      baseCommit: 'def5678',
      base: 'built' as const,
      lap: 1,
      reviewTicketId: 't1',
      builtAt: 1,
      status: 'built' as const,
      log: 'build.log',
      stories: [],
    }
    expect(StoriesManifest.parse(manifest)).toEqual(manifest)
  })

  it('StoriesBuildRecord carries each honest outcome', () => {
    expect(StoriesBuildRecord.parse({ status: 'none' })).toEqual({ status: 'none' })
    expect(
      StoriesBuildRecord.parse({ status: 'failed', commit: 'abc', exitCode: 1, log: 'build.log' })
        .status,
    ).toBe('failed')
    expect(
      StoriesBuildRecord.safeParse({ status: 'couldnt_run', commit: 'abc', reason: 'x' }).success,
    ).toBe(false)
  })
})
