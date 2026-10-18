import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type Project, RuncastleConfig, StoriesManifest } from '@runcastle/core'
import { STORIES_MANIFEST, baseStoriesDir, featureStoriesDir, storiesRoot } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GateExecResult, WithGateSandbox } from '../src/workflows/review-gates'
import { runStoriesBuild } from '../src/workflows/stories-build'
import { withTempDataDir } from './helpers/data-dir'
import { rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * A review pass's UI-states build, observed at its seam with the sandbox faked:
 * the record, what lands in the feature and base dirs, how many builds ran, and
 * the event the feature page refreshes on.
 */

const FEATURE = 'feat_1'
const BUILD = 'bunx storybook build -c .runcastle/storybook --stats-json -o {out}'

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

function write(repo: string, rel: string, text: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), text)
}

function entry(id: string, importPath: string) {
  return { id, title: id.split('--')[0], name: id.split('--')[1], importPath, type: 'story' }
}

const BUTTON = entry('button--primary', './.runcastle/stories/ui/Button.stories.tsx')
const CARD = entry('card--empty', './.runcastle/stories/ui/Card.stories.tsx')
const COUPON = entry('coupon--expired', './.runcastle/stories/ui/Coupon.stories.tsx')

const BASE_INDEX = { v: 5, entries: { [BUTTON.id]: BUTTON, [CARD.id]: CARD } }
const FEATURE_INDEX = { v: 5, entries: { [BUTTON.id]: BUTTON, [CARD.id]: CARD, [COUPON.id]: COUPON } }
/** Button's story imports Button; Card's imports Card, which imports Button. */
const FEATURE_STATS = {
  modules: [
    { name: './src/Button.tsx', reasons: [{ moduleName: BUTTON.importPath }, { moduleName: './src/Card.tsx' }] },
    { name: './src/Card.tsx', reasons: [{ moduleName: CARD.importPath }] },
    { name: COUPON.importPath, reasons: [] },
  ],
}

type BuildAnswer = GateExecResult | Error
interface Fake {
  withSandbox: WithGateSandbox
  /** Each build: which throwaway branch, at which commit. */
  builds: { branch: string; sha: string }[]
}

/**
 * A host-style sandbox (out path = the host dir) whose build writes `files`
 * into the out dir and exits as `answer` says; base builds (on the
 * `stories-base` branch) answer from `base`.
 */
function fakeSandbox(
  repo: string,
  feature: { files?: Record<string, unknown>; answer?: BuildAnswer },
  base: { files?: Record<string, unknown>; answer?: BuildAnswer } = {},
): Fake {
  const fake: Fake = {
    builds: [],
    withSandbox: async (branch, use, options) =>
      use({
        ...(options?.outDir ? { outPath: options.outDir } : {}),
        exec: async (command) => {
          fake.builds.push({ branch, sha: git(repo, 'rev-parse', branch) })
          const side = branch.startsWith('runcastle/stories-base/') ? base : feature
          const out = options?.outDir
          expect(out).toBeDefined()
          expect(command).toBe(BUILD.replace('{out}', `"${out}"`))
          for (const [name, body] of Object.entries(side.files ?? {})) {
            writeFileSync(join(out!, name), typeof body === 'string' ? body : JSON.stringify(body))
          }
          if (side.answer instanceof Error) throw side.answer
          return side.answer ?? { exitCode: 0, stdout: 'built ok', stderr: '' }
        },
      }),
  }
  return fake
}

const FEATURE_BUILD = {
  files: { 'index.json': FEATURE_INDEX, 'preview-stats.json': FEATURE_STATS, 'iframe.html': '<html>' },
}
const BASE_BUILD = { files: { 'index.json': BASE_INDEX, 'iframe.html': '<html>' } }

function readManifest(featureId = FEATURE): StoriesManifest {
  return StoriesManifest.parse(JSON.parse(readFileSync(join(featureStoriesDir(featureId), STORIES_MANIFEST), 'utf8')))
}

describe('runStoriesBuild', () => {
  let repo: string
  let restoreDataDir: () => void
  let branchPoint: string
  const config = RuncastleConfig.parse({ sandbox: 'noSandbox' })

  /** main: stories set up (optionally); feature/x: Button restyled, a Coupon story added. */
  function seedRepo(storiesOnMain = true): string {
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@runcastle.invalid')
    git(repo, 'config', 'user.name', 'test')
    write(repo, 'src/Button.tsx', 'button v1\n')
    write(repo, 'src/Card.tsx', 'card\n')
    if (storiesOnMain) write(repo, '.runcastle/stories.json', JSON.stringify({ build: BUILD }))
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base')
    branchPoint = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'checkout', '-q', '-b', 'feature/x')
    write(repo, 'src/Button.tsx', 'button v2\n')
    write(repo, '.runcastle/stories/ui/Coupon.stories.tsx', 'coupon\n')
    if (!storiesOnMain) write(repo, '.runcastle/stories.json', JSON.stringify({ build: BUILD }))
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'feature work')
    const tip = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'checkout', '-q', 'main')
    return tip
  }

  function project(): Project {
    return { id: 'proj_1', name: 'p', repoPath: repo } as Project
  }

  function run(sha: string, fake: Fake, opts: { featureId?: string; ticketId?: string } = {}) {
    const events: { type: string; message: string; data?: unknown }[] = []
    const record = runStoriesBuild({
      config,
      project: project(),
      feature: { id: opts.featureId ?? FEATURE, baseBranch: 'main' },
      ticket: { id: opts.ticketId ?? 'tkt_review1', lap: 2 },
      sha,
      emit: (e) => events.push(e),
      deps: { withSandbox: fake.withSandbox, now: () => 1234 },
    })
    return { record, events }
  }

  beforeEach(() => {
    restoreDataDir = withTempDataDir()
    repo = tmpRepo()
  })

  afterEach(() => {
    restoreDataDir()
    rmTemp(repo)
  })

  it('is none, builds nothing and drops an old build when the branch has no stories.json', async () => {
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@runcastle.invalid')
    git(repo, 'config', 'user.name', 'test')
    write(repo, '.runcastle/stories.json', '{"build": "no placeholder"}')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'invalid stories.json')
    mkdirSync(featureStoriesDir(FEATURE), { recursive: true })
    writeFileSync(join(featureStoriesDir(FEATURE), 'index.json'), '{}')
    const fake = fakeSandbox(repo, FEATURE_BUILD)

    const { record, events } = run(git(repo, 'rev-parse', 'HEAD'), fake)

    expect(await record).toEqual({ status: 'none' })
    expect(fake.builds).toEqual([])
    expect(existsSync(featureStoriesDir(FEATURE))).toBe(false)
    expect(events.map((e) => e.type)).toEqual(['stories.removed'])
  })

  it('builds at the tip and the branch point, and writes a manifest of the classified stories', async () => {
    const tip = seedRepo()
    const fake = fakeSandbox(repo, FEATURE_BUILD, BASE_BUILD)

    const { record, events } = run(tip, fake)

    expect(await record).toEqual({
      status: 'built',
      commit: tip,
      baseCommit: branchPoint,
      base: 'built',
      counts: { changed: 1, new: 1, affected: 1 },
    })
    expect(fake.builds).toEqual([
      { branch: 'runcastle/stories/tkt_review1', sha: tip },
      { branch: 'runcastle/stories-base/tkt_review1', sha: branchPoint },
    ])
    const manifest = readManifest()
    expect(manifest).toMatchObject({
      featureId: FEATURE,
      commit: tip,
      baseCommit: branchPoint,
      base: 'built',
      lap: 2,
      reviewTicketId: 'tkt_review1',
      builtAt: 1234,
      status: 'built',
      log: 'build.log',
    })
    expect(manifest.stories.map((s) => [s.id, s.kind])).toEqual([
      ['button--primary', 'changed'],
      ['coupon--expired', 'new'],
      ['card--empty', 'affected'],
    ])
    expect(readdirSync(featureStoriesDir(FEATURE)).sort()).toEqual(
      ['build.log', 'iframe.html', 'index.json', 'manifest.json', 'preview-stats.json'],
    )
    expect(readFileSync(join(featureStoriesDir(FEATURE), 'build.log'), 'utf8')).toBe('built ok')
    expect(existsSync(join(baseStoriesDir(branchPoint), 'index.json'))).toBe(true)
    expect(readdirSync(join(storiesRoot(), 'incoming'))).toEqual([])
    expect(events).toEqual([
      expect.objectContaining({ type: 'stories.built', data: { changed: 1, new: 1, affected: 1 } }),
    ])
    // The throwaway branches are gone.
    expect(git(repo, 'branch', '--list', 'runcastle/*')).toBe('')
  })

  it('reuses a cached branch-point build on a later pass and for another feature', async () => {
    const tip = seedRepo()
    await run(tip, fakeSandbox(repo, FEATURE_BUILD, BASE_BUILD)).record

    for (const featureId of [FEATURE, 'feat_2']) {
      const fake = fakeSandbox(repo, FEATURE_BUILD, { answer: new Error('base must not rebuild') })
      const record = await run(tip, fake, { featureId, ticketId: 'tkt_review2' }).record
      expect(record).toMatchObject({ status: 'built', base: 'built', baseCommit: branchPoint })
      expect(fake.builds).toHaveLength(1)
      expect(readManifest(featureId).stories.map((s) => s.kind)).toEqual(['changed', 'new', 'affected'])
    }
  })

  it('marks every story new when the branch point has no stories.json', async () => {
    const tip = seedRepo(false)
    const fake = fakeSandbox(repo, FEATURE_BUILD)

    const record = await run(tip, fake).record

    expect(record).toMatchObject({ status: 'built', base: 'none', baseCommit: branchPoint })
    expect(fake.builds).toHaveLength(1)
    expect(readManifest().stories.every((s) => s.kind === 'new')).toBe(true)
    expect(existsSync(baseStoriesDir(branchPoint))).toBe(false)
  })

  it('records a failed base build on the manifest without failing the record or caching it', async () => {
    const tip = seedRepo()
    const fake = fakeSandbox(repo, FEATURE_BUILD, { answer: { exitCode: 2, stdout: '', stderr: 'base broke' } })

    const record = await run(tip, fake).record

    expect(record).toMatchObject({ status: 'built', base: 'failed', baseCommit: branchPoint })
    expect(readManifest()).toMatchObject({ status: 'built', base: 'failed' })
    expect(readManifest().stories.map((s) => s.kind)).toEqual(['changed', 'changed', 'affected'])
    expect(readFileSync(join(featureStoriesDir(FEATURE), 'base-build.log'), 'utf8')).toContain('base broke')
    expect(existsSync(baseStoriesDir(branchPoint))).toBe(false)
  })

  it('leaves only the failed manifest and the log when the build exits non-zero', async () => {
    const tip = seedRepo()
    mkdirSync(featureStoriesDir(FEATURE), { recursive: true })
    writeFileSync(join(featureStoriesDir(FEATURE), 'iframe.html'), 'stale')
    const fake = fakeSandbox(repo, {
      files: { 'index.json': FEATURE_INDEX },
      answer: { exitCode: 1, stdout: 'compiling', stderr: 'boom' },
    })

    const { record, events } = run(tip, fake)

    expect(await record).toEqual({ status: 'failed', commit: tip, exitCode: 1, log: 'build.log' })
    expect(readdirSync(featureStoriesDir(FEATURE)).sort()).toEqual(['build.log', 'manifest.json'])
    expect(readManifest()).toMatchObject({ status: 'failed', commit: tip, stories: [] })
    expect(readFileSync(join(featureStoriesDir(FEATURE), 'build.log'), 'utf8')).toBe('compiling\nboom')
    expect(fake.builds).toHaveLength(1)
    expect(events.map((e) => e.type)).toEqual(['stories.failed'])
  })

  it('fails a build that wrote no preview-stats.json, saying --stats-json is needed', async () => {
    const tip = seedRepo()
    const fake = fakeSandbox(repo, { files: { 'index.json': FEATURE_INDEX } })

    const record = await run(tip, fake).record

    expect(record).toEqual({ status: 'failed', commit: tip, exitCode: 0, log: 'build.log' })
    expect(readFileSync(join(featureStoriesDir(FEATURE), 'build.log'), 'utf8')).toContain(
      'the build command must pass --stats-json',
    )
  })

  it("is couldnt_run, with the reason in the manifest, when the sandbox won't open", async () => {
    const tip = seedRepo()
    const fake: Fake = {
      builds: [],
      withSandbox: async () => {
        throw new Error('docker is not running\nmore detail')
      },
    }

    const record = await run(tip, fake).record

    expect(record).toEqual({
      status: 'couldnt_run',
      commit: tip,
      reason: 'the sandbox could not be set up: docker is not running',
      log: 'build.log',
    })
    expect(readManifest()).toMatchObject({ status: 'couldnt_run', reason: expect.stringContaining('docker') })
  })

  it('is couldnt_run when the build outlives its time limit', async () => {
    const tip = seedRepo()
    const fake: Fake = {
      builds: [],
      withSandbox: async (_branch, use, options) =>
        use({ outPath: options?.outDir, exec: () => new Promise(() => {}) }),
    }

    const record = await runStoriesBuild({
      config,
      project: project(),
      feature: { id: FEATURE, baseBranch: 'main' },
      ticket: { id: 'tkt_review1', lap: 1 },
      sha: tip,
      deps: { withSandbox: fake.withSandbox, commandTimeoutMs: 20 },
    })

    expect(record).toMatchObject({ status: 'couldnt_run', reason: expect.stringContaining('timed out') })
  })
})
