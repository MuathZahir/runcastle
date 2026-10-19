import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MainCatalogueAttempt, MainCatalogueRecord, MapHistoryEntry } from '@runcastle/core'
import {
  MAIN_CATALOGUE_ATTEMPT,
  MAIN_CATALOGUE_RECORD,
  mainStoriesAttemptDir,
  mainStoriesDir,
} from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { featureContextWithGit } from '../src/mcp/server'
import { mapGroupNames } from '../src/services/map'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * `project.map` at its seam: the map model read from a real repo's main —
 * feature merges, direct commits, docs-only commits — and a hand-written main
 * catalogue under a temp data dir.
 */

let restore: (() => void) | undefined
let ctx: AppCtx
let repo: string
let projectId: string

function put(rel: string, body: string): void {
  const abs = join(repo, ...rel.split('/'))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, body)
}

async function commitAll(message: string): Promise<string> {
  const g = simpleGit(repo)
  await g.add('.')
  await g.commit(message)
  return (await g.revparse(['HEAD'])).trim()
}

const STORY_FILE = 'src/CouponField.stories.tsx'

/** The base commit: stories set up, one story file, two scenarios (one with a call). */
async function baseRepo(opts: { stories?: boolean } = {}): Promise<string> {
  put('README.md', 'readme')
  if (opts.stories !== false) put('.runcastle/stories.json', '{"build":"storybook build -o {out}"}')
  put('src/CouponField.tsx', 'export const CouponField = 1')
  put(STORY_FILE, 'import "./CouponField"')
  put('.runcastle/scenarios/checkout/expired-coupon.ts', 'seed()')
  put('.runcastle/scenarios/checkout/expired-coupon.http', '# the call\nPOST {{base}}/api/coupons\n')
  put('.runcastle/scenarios/fresh-install.ts', 'seed()')
  return commitAll('base')
}

/** Merge a `feature/coupons` branch that changed the scenario, as runcastle does. */
async function mergeCoupons(): Promise<void> {
  const g = simpleGit(repo)
  await g.checkoutLocalBranch('feature/coupons')
  put('.runcastle/scenarios/checkout/expired-coupon.ts', 'seed(2)')
  await commitAll('ticket(1): seed a coupon')
  await g.checkout('main')
  await g.merge(['--no-ff', 'feature/coupons'])
}

function writeCatalogue(record: Partial<MainCatalogueRecord> & { commit: string }): void {
  const dir = mainStoriesDir(projectId)
  mkdirSync(dir, { recursive: true })
  const full: MainCatalogueRecord = {
    projectId,
    builtAt: 1000,
    source: 'built',
    dependsOn: [STORY_FILE, 'src/CouponField.tsx'],
    storyHistory: {},
    ...record,
  }
  writeFileSync(join(dir, MAIN_CATALOGUE_RECORD), JSON.stringify(full))
  const entry = (id: string, title: string, name: string, importPath: string) => ({
    id, title, name, importPath, type: 'story',
  })
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({
      v: 5,
      entries: {
        'checkout-couponfield--expired': entry('checkout-couponfield--expired', 'Checkout/CouponField', 'Expired', `./${STORY_FILE}`),
        'checkout-couponfield--applied': entry('checkout-couponfield--applied', 'Checkout/CouponField', 'Applied', `./${STORY_FILE}`),
        'button--primary': entry('button--primary', 'Button', 'Primary', './src/Button.stories.tsx'),
      },
    }),
  )
}

function writeAttempt(attempt: MainCatalogueAttempt, log?: string): void {
  const dir = mainStoriesAttemptDir(projectId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, MAIN_CATALOGUE_ATTEMPT), JSON.stringify(attempt))
  if (log !== undefined) writeFileSync(join(dir, 'build.log'), log)
}

const readMap = () => createCallerFactory(appRouter)(ctx).project.map({ projectId })

const credits = (history: MapHistoryEntry[]) =>
  history.map((h) => h.featureTitle ?? h.featureSlug ?? `main: ${h.subject}`)

beforeEach(async () => {
  restore = withTempDataDir()
  ctx = await makeTestCtx()
  ctx.config = { ...ctx.config, storiesPort: 4999 }
  repo = tmpRepo()
  const g = simpleGit(repo)
  await g.init(['-b', 'main'])
  await g.addConfig('user.name', 'test')
  await g.addConfig('user.email', 'test@example.com')
  await g.addConfig('commit.gpgsign', 'false')
  projectId = seedProject(ctx, repo).id
})

afterEach(() => {
  rmTemp(repo)
  restore?.()
})

describe('the groups a planner names new stories and scenarios after', () => {
  it('lists main’s group names in map order, Ungrouped left out, without a build', async () => {
    expect(await mapGroupNames(ctx, projectId)).toEqual([])
    const base = await baseRepo()
    put('.runcastle/scenarios/checkout/coupons/expired.ts', 'seed()')
    await commitAll('coupon scenarios')
    expect(await mapGroupNames(ctx, projectId)).toEqual(['Checkout', 'Checkout › Coupons'])

    // A built catalogue's story titles spell the group the way the story does, and add no new name.
    writeCatalogue({ commit: base })
    expect(await mapGroupNames(ctx, projectId)).toEqual(['Checkout', 'Checkout › Coupons'])
  })

  it('carries the same names as get_feature_context’s mapGroups', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'coupons', baseBranch: 'main' })
    await baseRepo()
    expect((await featureContextWithGit(ctx, { featureId: feature.id })).mapGroups).toEqual(['Checkout'])
  })
})

describe('project.map', () => {
  it('groups scenarios and calls from main, with history credited to features and to main', async () => {
    const feature = seedFeature(ctx, projectId, { slug: 'coupons', title: 'Coupons' })
    await baseRepo()
    await mergeCoupons()
    put('.runcastle/scenarios/checkout/expired-coupon.http', 'GET /api/coupons/expired\n')
    await commitAll('tweak the coupon call')

    const model = await readMap()
    expect(model.groups.map((g) => g.id)).toEqual(['checkout', '~ungrouped'])
    const [checkout, ungrouped] = model.groups
    expect(checkout?.scenarios).toHaveLength(1)
    const expired = checkout?.scenarios[0]
    expect(expired?.name).toBe('Expired coupon')
    expect(expired?.call).toEqual({
      file: '.runcastle/scenarios/checkout/expired-coupon.http',
      requestLine: 'GET /api/coupons/expired',
    })
    // Newest first: the direct commit, then the merge (credited by title), then base.
    expect(credits(expired?.history ?? [])).toEqual([
      'main: tweak the coupon call',
      'Coupons',
      'main: base',
    ])
    expect(expired?.history[1]).toMatchObject({ featureSlug: 'coupons', featureId: feature.id })
    expect(ungrouped?.scenarios.map((s) => s.name)).toEqual(['Fresh install'])
    expect(ungrouped?.scenarios[0]?.call).toBeUndefined()
  })

  it('lists runcastle’s own review call with its request line', async () => {
    put('.runcastle/scenarios/feature/review/feature-at-review.ts', 'seed()')
    put(
      '.runcastle/scenarios/feature/review/feature-at-review.http',
      '### Runcastle version\n# A harmless read.\nGET /api/trpc/system.version\n',
    )
    await baseRepo()
    const review = (await readMap()).groups.find((g) => g.id === 'feature/review')
    expect(review?.scenarios[0]?.call).toEqual({
      file: '.runcastle/scenarios/feature/review/feature-at-review.http',
      requestLine: 'GET /api/trpc/system.version',
    })
  })

  it('keeps the slug for a merge of a feature the project does not know, and omits an unparseable request line', async () => {
    await baseRepo()
    await mergeCoupons()
    put('.runcastle/scenarios/checkout/expired-coupon.http', '# only a comment\n')
    await commitAll('break the call')
    const expired = (await readMap()).groups[0]?.scenarios[0]
    expect(expired?.history[1]).toEqual(expect.objectContaining({ featureSlug: 'coupons' }))
    expect(expired?.history[1]?.featureTitle).toBeUndefined()
    expect(expired?.call).toEqual({ file: '.runcastle/scenarios/checkout/expired-coupon.http' })
  })

  it('is not_set_up without .runcastle/stories.json on main, and shows no UI states', async () => {
    const base = await baseRepo({ stories: false })
    writeCatalogue({ commit: base })
    const model = await readMap()
    expect(model.storiesSetUp).toBe(false)
    expect(model.catalogue).toEqual({ state: 'not_set_up', stale: false, building: false })
    expect(model.groups.flatMap((g) => g.components)).toEqual([])
  })

  it('is never_built with stories set up but no main catalogue, building from the attempt', async () => {
    const base = await baseRepo()
    writeAttempt({ commit: base, startedAt: 5, status: 'building' })
    const model = await readMap()
    expect(model.storiesSetUp).toBe(true)
    expect(model.catalogue).toEqual({ state: 'never_built', stale: false, building: true })
  })

  it('serves the built catalogue: components, states, frame URLs under /main/<projectId>/ and story history', async () => {
    const base = await baseRepo()
    const history: MapHistoryEntry[] = [
      { commit: 'abc', at: 2000, subject: "Merge branch 'feature/coupons'", featureSlug: 'coupons' },
    ]
    const feature = seedFeature(ctx, projectId, { slug: 'coupons', title: 'Coupons' })
    writeCatalogue({ commit: base, builtAt: 1234, storyHistory: { [STORY_FILE]: history } })

    const model = await readMap()
    expect(model.catalogue).toEqual({
      state: 'built', commit: base, builtAt: 1234, stale: false, building: false,
    })
    const checkout = model.groups.find((g) => g.id === 'checkout')
    expect(checkout?.components).toEqual([
      {
        importPath: STORY_FILE,
        name: 'CouponField',
        history: [{ ...history[0], featureId: feature.id, featureTitle: 'Coupons' }],
        states: [
          {
            id: 'checkout-couponfield--expired',
            name: 'Expired',
            frameUrl: `http://localhost:4999/main/${projectId}/iframe.html?id=checkout-couponfield--expired&viewMode=story`,
          },
          {
            id: 'checkout-couponfield--applied',
            name: 'Applied',
            frameUrl: `http://localhost:4999/main/${projectId}/iframe.html?id=checkout-couponfield--applied&viewMode=story`,
          },
        ],
      },
    ])
    const ungrouped = model.groups.find((g) => g.id === '~ungrouped')
    expect(ungrouped?.components.map((c) => [c.name, c.history])).toEqual([['Button', []]])
  })

  it('reports a failed attempt with its log tail, keeping the last good catalogue', async () => {
    const base = await baseRepo()
    writeCatalogue({ commit: base })
    const log = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n')
    writeAttempt(
      { commit: base, startedAt: 5, finishedAt: 9, status: 'failed', reason: 'exit 1', log: 'build.log' },
      log,
    )
    const { catalogue } = await readMap()
    expect(catalogue.state).toBe('built')
    expect(catalogue.building).toBe(false)
    expect(catalogue.failure?.reason).toBe('exit 1')
    expect(catalogue.failure?.at).toBe(9)
    expect(catalogue.failure?.log.split('\n')).toHaveLength(200)
    expect(catalogue.failure?.log.endsWith('line 250')).toBe(true)
  })

  it('treats an invalid main.json as no catalogue', async () => {
    await baseRepo()
    mkdirSync(mainStoriesDir(projectId), { recursive: true })
    writeFileSync(join(mainStoriesDir(projectId), MAIN_CATALOGUE_RECORD), '{"commit":1}')
    expect((await readMap()).catalogue.state).toBe('never_built')
  })

  describe('stale', () => {
    it('stays fresh after docs-only and scenario commits', async () => {
      const base = await baseRepo()
      writeCatalogue({ commit: base })
      await mergeCoupons()
      put('docs/features/coupons/outcome.md', 'shipped')
      await commitAll('runcastle: outcome for coupons')
      expect((await readMap()).catalogue.stale).toBe(false)
    })

    it('turns stale when a file the catalogue depends on changes', async () => {
      const base = await baseRepo()
      writeCatalogue({ commit: base })
      expect((await readMap()).catalogue.stale).toBe(false)
      put('src/CouponField.tsx', 'export const CouponField = 2')
      await commitAll('change the component')
      expect((await readMap()).catalogue.stale).toBe(true)
    })

    it('turns stale when the stories set-up under .runcastle/ changes', async () => {
      const base = await baseRepo()
      writeCatalogue({ commit: base })
      put('.runcastle/storybook/preview.ts', 'export {}')
      await commitAll('tweak the preview')
      expect((await readMap()).catalogue.stale).toBe(true)
    })

    it('counts a catalogue commit missing from the repo as stale', async () => {
      await baseRepo()
      writeCatalogue({ commit: 'f'.repeat(40) })
      expect((await readMap()).catalogue.stale).toBe(true)
    })
  })
})
