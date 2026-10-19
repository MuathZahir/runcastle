import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MainCatalogueAttempt,
  MainCatalogueRecord,
  type Project,
  RuncastleConfig,
  type StoriesManifest,
} from '@runcastle/core'
import {
  MAIN_CATALOGUE_ATTEMPT,
  MAIN_CATALOGUE_RECORD,
  STORIES_MANIFEST,
  featureStoriesDir,
  mainStoriesAttemptDir,
  mainStoriesDir,
  storiesRoot,
} from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listByProject } from '../src/services/events'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import {
  __setMainBuildDeps,
  buildMainCatalogue,
  computeStoryHistory,
  mainBuildSettled,
  startMainBuild,
} from '../src/services/main-catalogue'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { type GateExecResult, type WithGateSandbox, burnGateSandbox } from '../src/workflows/review-gates'
import type { StoriesBuildDeps } from '../src/workflows/stories-build'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * Main's catalogue (the-map-of-stories-and-scenarios decision 5) at its seams:
 * `project.buildMapCatalogue` with the sandbox faked, the merge flow's
 * promote-or-build step, and `project.map` reading what they wrote — against
 * a real repo with a `--no-ff` feature merge on main.
 */

let restore: (() => void) | undefined
let ctx: AppCtx
let repo: string
let project: Project

const caller = () => createCallerFactory(appRouter)(ctx)

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

const rev = async (ref: string): Promise<string> => (await simpleGit(repo).revparse([ref])).trim()

function entry(id: string, title: string, importPath: string) {
  return { id, title, name: id.split('--')[1], importPath, type: 'story' }
}

const BUTTON = entry('checkout-button--primary', 'Checkout/Button', './src/Button.stories.tsx')
const CARD = entry('checkout-card--empty', 'Checkout/Card', './src/Card.stories.tsx')
const INDEX = { v: 5, entries: { [BUTTON.id]: BUTTON, [CARD.id]: CARD } }
/** Button's story imports Button; Card's imports Card, which imports Button. */
const STATS = {
  modules: [
    { name: './src/Button.tsx', reasons: [{ moduleName: BUTTON.importPath }, { moduleName: './src/Card.tsx' }] },
    { name: './src/Card.tsx', reasons: [{ moduleName: CARD.importPath }] },
    { name: BUTTON.importPath, reasons: [] },
    { name: CARD.importPath, reasons: [] },
  ],
}
const CATALOGUE = { 'index.json': INDEX, 'preview-stats.json': STATS, 'iframe.html': '<html>catalogue</html>' }

/** main: stories set up, Button and Card with their stories. */
async function baseRepo(): Promise<string> {
  const g = simpleGit(repo)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  put('README.md', 'readme')
  put('.runcastle/stories.json', '{"build":"storybook build --stats-json -o {out}"}')
  put('src/Button.tsx', 'button v1')
  put('src/Card.tsx', 'import "./Button"')
  put('src/Button.stories.tsx', 'import "./Button"')
  put('src/Card.stories.tsx', 'import "./Card"')
  return commitAll('base')
}

/** A `feature/<slug>` branch with `edits` committed, merged `--no-ff` as runcastle does. */
async function mergeFeatureBranch(slug: string, edits: Record<string, string>): Promise<void> {
  const g = simpleGit(repo)
  await g.checkoutLocalBranch(`feature/${slug}`)
  for (const [rel, body] of Object.entries(edits)) put(rel, body)
  await commitAll(`${slug} work`)
  await g.checkout('main')
  await g.merge(['--no-ff', `feature/${slug}`])
}

interface Fake {
  deps: StoriesBuildDeps
  /** The commit each build ran at. */
  builds: string[]
}

/**
 * A host-style sandbox whose build writes `files` into the out dir and exits
 * as `answer` says, after `gate` when given; the branch is pinned for real.
 */
function fakeSandbox(
  opts: { files?: Record<string, unknown>; answer?: GateExecResult; gate?: Promise<void> } = {},
): Fake {
  const fake: Fake = { builds: [], deps: {} }
  const withSandbox: WithGateSandbox = async (branch, use, options) =>
    use({
      ...(options?.outDir ? { outPath: options.outDir } : {}),
      exec: async () => {
        fake.builds.push(await rev(branch))
        await opts.gate
        for (const [name, body] of Object.entries(opts.files ?? CATALOGUE)) {
          writeFileSync(join(options!.outDir!, name), typeof body === 'string' ? body : JSON.stringify(body))
        }
        return opts.answer ?? { exitCode: 0, stdout: 'built ok', stderr: '' }
      },
    })
  fake.deps = { withSandbox, now: () => 1234 }
  return fake
}

function readRecord(): MainCatalogueRecord {
  return MainCatalogueRecord.parse(
    JSON.parse(readFileSync(join(mainStoriesDir(project.id), MAIN_CATALOGUE_RECORD), 'utf8')),
  )
}

function readAttempt(): MainCatalogueAttempt {
  return MainCatalogueAttempt.parse(
    JSON.parse(readFileSync(join(mainStoriesAttemptDir(project.id), MAIN_CATALOGUE_ATTEMPT), 'utf8')),
  )
}

const catalogueEvents = (): string[] =>
  listByProject(ctx, project.id)
    .map((e) => e.type)
    .filter((t) => t.startsWith('map.catalogue.'))

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(async () => {
  __resetTestDriveState()
  restore = withTempDataDir()
  ctx = await makeTestCtx()
  repo = tmpRepo()
  await baseRepo()
  project = seedProject(ctx, repo)
})

afterEach(async () => {
  await mainBuildSettled(project.id)
  __setMainBuildDeps(undefined)
  __resetTestDriveState()
  restore?.()
  rmTemp(repo)
})

describe('project.buildMapCatalogue', () => {
  it("builds main's tip, swaps it into main's slot and writes main.json", async () => {
    seedFeature(ctx, project.id, { slug: 'coupons', title: 'Coupons', phase: 'shipped' })
    await mergeFeatureBranch('coupons', { 'src/Button.tsx': 'button v2' })
    const tip = await rev('main')
    const fake = fakeSandbox()
    __setMainBuildDeps(fake.deps)

    const res = await caller().project.buildMapCatalogue({ projectId: project.id })

    expect(res).toEqual({ started: true, commit: tip })
    expect(catalogueEvents()).toEqual(['map.catalogue.started'])
    await mainBuildSettled(project.id)
    expect(fake.builds).toEqual([tip])
    const record = readRecord()
    expect(record).toMatchObject({ projectId: project.id, commit: tip, builtAt: 1234, source: 'built' })
    expect(record.dependsOn).toEqual([
      'src/Button.stories.tsx',
      'src/Button.tsx',
      'src/Card.stories.tsx',
      'src/Card.tsx',
    ])
    expect(readFileSync(join(mainStoriesDir(project.id), 'iframe.html'), 'utf8')).toBe('<html>catalogue</html>')
    expect(existsSync(join(mainStoriesAttemptDir(project.id), MAIN_CATALOGUE_ATTEMPT))).toBe(false)
    expect(catalogueEvents()).toEqual(['map.catalogue.started', 'map.catalogue.built'])

    const map = await caller().project.map({ projectId: project.id })
    expect(map.catalogue).toMatchObject({ state: 'built', commit: tip, stale: false, building: false })
    // Button and Card are component stories: in the catalogue, not on the map.
    expect(map.groups).toEqual([])
  })

  it("credits each story's changes, its imports' included, to the feature merged on main", async () => {
    seedFeature(ctx, project.id, { slug: 'coupons', title: 'Coupons', phase: 'shipped' })
    await mergeFeatureBranch('coupons', { 'src/Button.tsx': 'button v2' })
    put('src/Card.tsx', 'import "./Button" // tweaked')
    await commitAll('tweak the card')
    put('docs/notes.md', 'notes')
    await commitAll('docs only')
    const merge = await rev('main~2')
    __setMainBuildDeps(fakeSandbox().deps)

    await caller().project.buildMapCatalogue({ projectId: project.id })
    await mainBuildSettled(project.id)

    const { storyHistory } = readRecord()
    // Button's story reaches only Button: the merge, then the base commit.
    expect(storyHistory['src/Button.stories.tsx']?.map((e) => e.subject)).toEqual([
      "Merge branch 'feature/coupons'",
      'base',
    ])
    // Card's story reaches Card and, through it, Button: newest first.
    expect(storyHistory['src/Card.stories.tsx']?.map((e) => e.subject)).toEqual([
      'tweak the card',
      "Merge branch 'feature/coupons'",
      'base',
    ])
    expect(storyHistory['src/Button.stories.tsx']?.[0]).toMatchObject({ commit: merge, featureSlug: 'coupons' })
  })

  it('leaves files most stories reach out of history, and keeps a component’s own file', async () => {
    const names = ['A', 'B', 'C', 'D']
    const entries = names.map((n) => entry(`g-${n.toLowerCase()}--x`, `G/${n}`, `./src/${n}.stories.tsx`))
    const index = { v: 5, entries: Object.fromEntries(entries.map((e) => [e.id, e])) }
    const modules = [
      { name: './src/theme.ts', reasons: entries.map((e) => ({ moduleName: e.importPath })) },
      { name: './src/A.tsx', reasons: [{ moduleName: entries[0]!.importPath }] },
      ...entries.map((e) => ({ name: e.importPath, reasons: [] })),
    ]
    seedFeature(ctx, project.id, { slug: 'restyle', title: 'Restyle', phase: 'shipped' })
    seedFeature(ctx, project.id, { slug: 'badge', title: 'Badge', phase: 'shipped' })
    for (const n of names) put(`src/${n}.stories.tsx`, `story ${n}`)
    put('src/A.tsx', 'a v1')
    put('src/theme.ts', 'theme v1')
    await commitAll('stories')
    await mergeFeatureBranch('restyle', { 'src/theme.ts': 'theme v2' })
    await mergeFeatureBranch('badge', { 'src/A.tsx': 'a v2' })
    const tip = await rev('main')

    const history = await computeStoryHistory(repo, tip, index as never, { modules } as never)

    const subjects = (file: string) => history[file]?.map((e) => e.subject)
    expect(subjects('src/A.stories.tsx')).toEqual(["Merge branch 'feature/badge'", 'stories'])
    expect(subjects('src/B.stories.tsx')).toEqual(['stories'])
  })

  it('leaves a barrel two stories reach out of history, with everything it re-exports', async () => {
    // Tile and Page reach the barrel; three modules import it, so it is a hub
    // even though two of eight stories is not more than a quarter.
    const names = ['Tile', 'Page', 'C', 'D', 'E', 'F', 'G', 'H']
    const entries = names.map((n) => entry(`g-${n.toLowerCase()}--x`, `G/${n}`, `./src/${n}.stories.tsx`))
    const index = { v: 5, entries: Object.fromEntries(entries.map((e) => [e.id, e])) }
    const modules = [
      { name: './src/Tile.tsx', reasons: [{ moduleName: './src/Tile.stories.tsx' }, { moduleName: './src/Page.tsx' }] },
      { name: './src/Page.tsx', reasons: [{ moduleName: './src/Page.stories.tsx' }] },
      { name: './src/Other.tsx', reasons: [{ moduleName: './src/Page.tsx' }] },
      {
        name: './src/barrel.ts',
        reasons: ['Tile', 'Page', 'Other'].map((n) => ({ moduleName: `./src/${n}.tsx` })),
      },
      { name: './src/barrel/runs.ts', reasons: [{ moduleName: './src/barrel.ts' }] },
      ...entries.map((e) => ({ name: e.importPath, reasons: [] })),
    ]
    seedFeature(ctx, project.id, { slug: 'runs', title: 'Runs', phase: 'shipped' })
    seedFeature(ctx, project.id, { slug: 'tile', title: 'Tile', phase: 'shipped' })
    for (const n of names) put(`src/${n}.stories.tsx`, `story ${n}`)
    for (const f of ['Tile.tsx', 'Page.tsx', 'Other.tsx', 'barrel.ts', 'barrel/runs.ts']) put(`src/${f}`, 'v1')
    await commitAll('stories')
    await mergeFeatureBranch('runs', { 'src/barrel/runs.ts': 'v2', 'src/barrel.ts': 'v2' })
    await mergeFeatureBranch('tile', { 'src/Tile.tsx': 'v2' })
    const tip = await rev('main')

    const history = await computeStoryHistory(repo, tip, index as never, { modules } as never)

    const subjects = (file: string) => history[file]?.map((e) => e.subject)
    expect(subjects('src/Tile.stories.tsx')).toEqual(["Merge branch 'feature/tile'", 'stories'])
    expect(subjects('src/Page.stories.tsx')).toEqual(["Merge branch 'feature/tile'", 'stories'])
  })

  it('credits a page story with changes to its story file alone, never to what it imports', async () => {
    const PAGE = '.runcastle/stories/pages/1-onboarding/Welcome.stories.tsx'
    const page = entry('onboarding--welcome', 'Onboarding', `./${PAGE}`)
    const index = { v: 5, entries: { [page.id]: page } }
    const modules = [
      { name: `./${PAGE}`, reasons: [] },
      { name: './src/App.tsx', reasons: [{ moduleName: `./${PAGE}` }] },
    ]
    seedFeature(ctx, project.id, { slug: 'app', title: 'App', phase: 'shipped' })
    seedFeature(ctx, project.id, { slug: 'welcome', title: 'Welcome', phase: 'shipped' })
    put(PAGE, 'story v1')
    put('src/App.tsx', 'v1')
    await commitAll('stories')
    await mergeFeatureBranch('app', { 'src/App.tsx': 'v2' })
    await mergeFeatureBranch('welcome', { [PAGE]: 'story v2' })
    const tip = await rev('main')

    const history = await computeStoryHistory(repo, tip, index as never, { modules } as never)

    expect(history[PAGE]?.map((e) => e.subject)).toEqual(["Merge branch 'feature/welcome'", 'stories'])
  })

  it('keeps the last good catalogue and records the failure with its log', async () => {
    __setMainBuildDeps(fakeSandbox().deps)
    const first = await caller().project.buildMapCatalogue({ projectId: project.id })
    await mainBuildSettled(project.id)
    put('src/Button.tsx', 'button v3')
    const tip = await commitAll('break the button')
    __setMainBuildDeps(
      fakeSandbox({ files: {}, answer: { exitCode: 1, stdout: '', stderr: 'boom: Button broke' } }).deps,
    )

    const second = await caller().project.buildMapCatalogue({ projectId: project.id })
    await mainBuildSettled(project.id)

    expect(second).toEqual({ started: true, commit: tip })
    expect(readRecord().commit).toBe(first.commit)
    expect(existsSync(join(mainStoriesDir(project.id), 'iframe.html'))).toBe(true)
    expect(readAttempt()).toMatchObject({ commit: tip, status: 'failed', log: 'build.log', finishedAt: 1234 })
    expect(readFileSync(join(mainStoriesAttemptDir(project.id), 'build.log'), 'utf8')).toContain('boom: Button broke')
    expect(catalogueEvents().slice(-2)).toEqual(['map.catalogue.started', 'map.catalogue.failed'])

    const map = await caller().project.map({ projectId: project.id })
    expect(map.catalogue).toMatchObject({ state: 'built', commit: first.commit, stale: true })
    expect(map.catalogue.failure?.log).toContain('boom: Button broke')
  })

  it("records a failed sandbox setup as couldnt_run, with the setup's output as build.log", async () => {
    const config = RuncastleConfig.parse({ sandbox: 'docker', burnCache: 'off', burnWorkspace: 'isolated' })
    const commands: string[] = []
    const withSandbox = burnGateSandbox(config, project, {
      open: async () => ({
        exec: async (command) => {
          commands.push(command)
          return { exitCode: 128, stdout: '', stderr: "fatal: couldn't find remote ref runcastle/stories-main" }
        },
        close: async () => ({}),
      }),
    })
    __setMainBuildDeps({ withSandbox, now: () => 1234 })

    const { commit } = await caller().project.buildMapCatalogue({ projectId: project.id })
    await mainBuildSettled(project.id)

    expect(commands).toHaveLength(1)
    expect(readAttempt()).toMatchObject({
      commit,
      status: 'couldnt_run',
      reason: 'the sandbox could not be set up: the sync-and-install setup exited 128',
      log: 'build.log',
    })
    expect(readFileSync(join(mainStoriesAttemptDir(project.id), 'build.log'), 'utf8')).toContain(
      "fatal: couldn't find remote ref runcastle/stories-main",
    )
    expect(catalogueEvents()).toEqual(['map.catalogue.started', 'map.catalogue.failed'])
  })

  it('answers a request while a build runs with the running one', async () => {
    const gate = deferred()
    const fake = fakeSandbox({ gate: gate.promise })
    __setMainBuildDeps(fake.deps)

    const first = await caller().project.buildMapCatalogue({ projectId: project.id })
    const second = await caller().project.buildMapCatalogue({ projectId: project.id })
    expect(second).toEqual({ started: false, commit: first.commit })
    expect(readAttempt()).toMatchObject({ status: 'building', commit: first.commit })
    expect((await caller().project.map({ projectId: project.id })).catalogue.building).toBe(true)

    gate.resolve()
    await mainBuildSettled(project.id)
    expect(fake.builds).toHaveLength(1)
    expect(catalogueEvents()).toEqual(['map.catalogue.started', 'map.catalogue.built'])
  })

  it("discards an older commit's result that lands after a newer catalogue", async () => {
    const older = await rev('main')
    put('src/Button.tsx', 'button v2')
    const newer = await commitAll('restyle the button')
    const slow = deferred()
    const olderBuild = fakeSandbox({ gate: slow.promise })
    __setMainBuildDeps(olderBuild.deps)

    expect(await startMainBuild(ctx, project.id, { commit: older })).toEqual({ started: true, commit: older })
    // The newer tip's catalogue lands while the older build is still out.
    expect(await buildMainCatalogue(ctx, project.id, { commit: newer, deps: fakeSandbox().deps })).toEqual({
      status: 'built',
      commit: newer,
    })

    slow.resolve()
    await mainBuildSettled(project.id)
    expect(olderBuild.builds).toEqual([older])
    expect(readRecord().commit).toBe(newer)
    expect(existsSync(join(mainStoriesAttemptDir(project.id), MAIN_CATALOGUE_ATTEMPT))).toBe(false)
    expect(catalogueEvents()).toEqual(['map.catalogue.started', 'map.catalogue.started', 'map.catalogue.built'])
  })
})

describe('at merge', () => {
  /** A review build of `feature/<slug>` at its tip, as a review pass leaves it. */
  function writeReviewBuild(featureId: string, commit: string): void {
    const dir = featureStoriesDir(featureId)
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(CATALOGUE)) {
      writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
    }
    writeFileSync(join(dir, 'build.log'), 'built ok')
    const manifest: StoriesManifest = {
      featureId,
      commit,
      baseCommit: null,
      base: 'none',
      lap: 1,
      reviewTicketId: 't1',
      builtAt: 1,
      status: 'built',
      log: 'build.log',
      stories: [],
    }
    writeFileSync(join(dir, STORIES_MANIFEST), JSON.stringify(manifest))
  }

  /** A feature at review on `feature/<slug>`, its review build at the branch's first commit. */
  async function featureAtReview(slug: string, base = 'main') {
    await createFeatureBranch(project, slug, base)
    const g = simpleGit(repo)
    await g.checkout(`feature/${slug}`)
    put('src/Button.tsx', 'button v2')
    const reviewed = await commitAll('restyle the button')
    const feature = seedFeature(ctx, project.id, { slug, title: 'Coupons', phase: 'review', baseBranch: base })
    writeReviewBuild(feature.id, reviewed)
    return { feature, g }
  }

  async function merge(featureId: string) {
    const g = simpleGit(repo)
    await g.checkout('main')
    return caller().feature.merge({ featureId })
  }

  it("promotes the review build into main's slot when nothing it depends on changed", async () => {
    const { feature } = await featureAtReview('coupons')
    // A docs-only commit after the review build, as a checkpoint lands.
    put('docs/features/coupons/spec.md', 'checkpoint')
    await commitAll('runcastle: checkpoint')
    const fake = fakeSandbox()
    __setMainBuildDeps(fake.deps)

    const res = await merge(feature.id)

    expect(res.ok).toBe(true)
    const mergeCommit = (await simpleGit(repo).raw(['log', '--merges', '-1', '--format=%H', 'main'])).trim()
    const record = readRecord()
    expect(record).toMatchObject({ projectId: project.id, commit: mergeCommit, source: 'promoted', featureId: feature.id })
    expect(record.storyHistory['src/Button.stories.tsx']?.[0]).toMatchObject({ featureSlug: 'coupons' })
    expect(readFileSync(join(mainStoriesDir(project.id), 'iframe.html'), 'utf8')).toBe('<html>catalogue</html>')
    for (const name of [STORIES_MANIFEST, 'build.log']) {
      expect(existsSync(join(mainStoriesDir(project.id), name))).toBe(false)
    }
    expect(existsSync(featureStoriesDir(feature.id))).toBe(false)
    expect(fake.builds).toEqual([])
    expect(catalogueEvents()).toEqual(['map.catalogue.promoted'])

    const map = await caller().project.map({ projectId: project.id })
    expect(map.catalogue).toMatchObject({ state: 'built', commit: mergeCommit, stale: false })
  })

  it("builds main in the background when a story's imported file changed after review", async () => {
    const { feature } = await featureAtReview('coupons')
    put('src/Button.tsx', 'button v3')
    await commitAll('restyle again after review')
    const fake = fakeSandbox()
    __setMainBuildDeps(fake.deps)

    const res = await merge(feature.id)
    await mainBuildSettled(project.id)

    expect(res.ok).toBe(true)
    expect(fake.builds).toEqual([await rev('main')])
    expect(readRecord()).toMatchObject({ source: 'built', commit: await rev('main') })
    expect(existsSync(featureStoriesDir(feature.id))).toBe(false)
    expect(catalogueEvents()).toEqual(['map.catalogue.started', 'map.catalogue.built'])
  })

  it('changes nothing about the map when the feature merges into another branch', async () => {
    await simpleGit(repo).branch(['develop'])
    const { feature } = await featureAtReview('coupons', 'develop')
    const fake = fakeSandbox()
    __setMainBuildDeps(fake.deps)

    const res = await merge(feature.id)

    expect(res.ok).toBe(true)
    expect(existsSync(mainStoriesDir(project.id))).toBe(false)
    expect(existsSync(featureStoriesDir(feature.id))).toBe(false)
    expect(fake.builds).toEqual([])
    expect(catalogueEvents()).toEqual([])
  })

  it('never fails the ship when the catalogue cannot be kept', async () => {
    const { feature } = await featureAtReview('coupons')
    // Main's slot cannot be made: its parent is a file.
    mkdirSync(storiesRoot(), { recursive: true })
    writeFileSync(join(storiesRoot(), 'main'), 'in the way')

    const res = await merge(feature.id)

    expect(res.ok).toBe(true)
    expect(getFeatureRow(ctx, feature.id).status).toBe('shipped')
    expect(catalogueEvents()).toEqual(['map.catalogue.failed'])
  })
})
