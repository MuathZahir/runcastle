import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClassifiedStory, StoriesManifest } from '@runcastle/core'
import { STORIES_MANIFEST, featureStoriesDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'

/**
 * `feature.uiStates` (decision 12): the feature's stories manifest as the
 * section model, with frame URLs on the stories port — or null.
 */

const FEATURE = 'feat_uiStates0001'
const COMMIT = 'c'.repeat(40)
const BASE = 'b'.repeat(40)

let restore: (() => void) | undefined
let ctx: AppCtx
beforeEach(async () => {
  restore = withTempDataDir()
  ctx = await makeTestCtx()
  ctx.config = { ...ctx.config, storiesPort: 4999 }
})
afterEach(() => restore?.())

const story = (id: string, kind: ClassifiedStory['kind']): ClassifiedStory => ({
  id,
  title: 'Checkout/Coupon field',
  name: id,
  importPath: `.runcastle/stories/checkout/${id}.stories.tsx`,
  kind,
  distance: kind === 'affected' ? 2 : 0,
})

function writeManifest(over: Partial<StoriesManifest>, files: Record<string, string> = {}): void {
  const dir = featureStoriesDir(FEATURE)
  mkdirSync(dir, { recursive: true })
  const manifest: StoriesManifest = {
    featureId: FEATURE,
    commit: COMMIT,
    baseCommit: BASE,
    base: 'built',
    lap: 1,
    reviewTicketId: 'tkt_1',
    builtAt: 1000,
    status: 'built',
    stories: [],
    ...over,
  }
  writeFileSync(join(dir, STORIES_MANIFEST), JSON.stringify(manifest))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
}

const query = (featureId = FEATURE) =>
  createCallerFactory(appRouter)(ctx).feature.uiStates({ featureId })

describe('feature.uiStates', () => {
  it('is null without a manifest', async () => {
    expect(await query()).toBeNull()
  })

  it('is null for an invalid manifest or an id outside the pattern', async () => {
    mkdirSync(featureStoriesDir(FEATURE), { recursive: true })
    writeFileSync(join(featureStoriesDir(FEATURE), STORIES_MANIFEST), '{"status":"built"}')
    expect(await query()).toBeNull()
    expect(await query('../features/x')).toBeNull()
  })

  it('groups stories and builds frame URLs on the stories port, with a base twin for changed ones', async () => {
    writeManifest({
      stories: [story('changed-one', 'changed'), story('new-one', 'new'), story('far-one', 'affected')],
    })
    const model = await query()
    expect(model?.status).toBe('built')
    expect(model?.changed).toEqual([
      {
        id: 'changed-one',
        title: 'Checkout/Coupon field',
        name: 'changed-one',
        frameUrl: `http://localhost:4999/features/${FEATURE}/iframe.html?id=changed-one&viewMode=story`,
        baseFrameUrl: `http://localhost:4999/base/${BASE}/iframe.html?id=changed-one&viewMode=story`,
        page: false,
      },
    ])
    expect(model?.new.map((s) => [s.id, s.baseFrameUrl])).toEqual([['new-one', null]])
    expect(model?.affected.map((s) => [s.id, s.baseFrameUrl])).toEqual([['far-one', null]])
    expect(model?.log).toBeNull()
  })

  it('marks a story from .runcastle/stories/pages/ as a page, and no other', async () => {
    const pageStory: ClassifiedStory = {
      ...story('page-one', 'new'),
      importPath: './.runcastle/stories/pages/1-onboarding/Welcome.stories.tsx',
    }
    writeManifest({ stories: [pageStory, story('part-one', 'new')] })
    expect((await query())?.new.map((s) => [s.id, s.page])).toEqual([
      ['page-one', true],
      ['part-one', false],
    ])
  })

  it('gives a changed story no base twin when the base did not build', async () => {
    writeManifest({ base: 'failed', stories: [story('changed-one', 'changed')] })
    const model = await query()
    expect(model?.base).toBe('failed')
    expect(model?.changed[0]?.baseFrameUrl).toBeNull()
  })

  it("carries a failed build's log tail", async () => {
    const log = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n')
    writeManifest({ status: 'failed', log: 'build.log' }, { 'build.log': `${log}\n` })
    const model = await query()
    expect(model?.status).toBe('failed')
    const lines = model?.log?.split('\n') ?? []
    expect(lines).toHaveLength(200)
    expect(lines[0]).toBe('line 51')
    expect(lines.at(-1)).toBe('line 250')
  })

  it("carries couldnt_run's reason and log", async () => {
    writeManifest(
      { status: 'couldnt_run', reason: 'isolated sandbox has no host path', log: 'build.log' },
      { 'build.log': 'no host path' },
    )
    const model = await query()
    expect(model?.reason).toBe('isolated sandbox has no host path')
    expect(model?.log).toBe('no host path')
  })
})
