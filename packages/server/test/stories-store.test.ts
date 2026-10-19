import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project, StoriesManifest } from '@runcastle/core'
import {
  STORIES_MANIFEST,
  baseStoriesDir,
  featureStoriesDir,
  storiesRoot,
} from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { deleteFeature } from '../src/services/features'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
import { sweepBaseStories } from '../src/services/stories-store'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * Built story catalogues in the data dir (decision 5): a feature's build is
 * gone after merge or delete, and a base build no remaining feature's manifest
 * references is swept — never failing the flow that triggered it.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

let restoreEnv: (() => void) | undefined
beforeEach(() => {
  restoreEnv = useDataDir(mkTmp('rc-home-'))
})
afterEach(() => {
  restoreEnv?.()
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (dir) {
      try {
        rmTemp(dir)
      } catch {
        // best-effort
      }
    }
  }
})

/** A feature build whose manifest points at `baseCommit`. */
function writeFeatureBuild(featureId: string, baseCommit: string | null): void {
  const dir = featureStoriesDir(featureId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  const manifest: StoriesManifest = {
    featureId,
    commit: 'aaaaaaa',
    baseCommit,
    base: baseCommit ? 'built' : 'none',
    lap: 1,
    reviewTicketId: 't1',
    builtAt: 1,
    status: 'built',
    stories: [],
  }
  writeFileSync(join(dir, STORIES_MANIFEST), JSON.stringify(manifest))
}

function writeBaseBuild(commit: string): string {
  const dir = baseStoriesDir(commit)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.json'), '{"v":5,"entries":{}}')
  return dir
}

async function initRepo(dir: string): Promise<SimpleGit> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return g
}

describe('sweepBaseStories', () => {
  it('keeps base builds a feature manifest references and deletes the rest', () => {
    writeFeatureBuild('f1', 'b1b1b1b')
    const kept = writeBaseBuild('b1b1b1b')
    const orphan = writeBaseBuild('c2c2c2c')

    sweepBaseStories()

    expect(existsSync(kept)).toBe(true)
    expect(existsSync(orphan)).toBe(false)
  })

  it('is a no-op on a data dir with no stories', () => {
    expect(() => sweepBaseStories()).not.toThrow()
    expect(existsSync(storiesRoot())).toBe(false)
  })
})

describe('feature lifecycle', () => {
  let ctx: AppCtx
  let project: Project
  let g: SimpleGit

  beforeEach(async () => {
    __resetTestDriveState()
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-stories-')
    g = await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  afterEach(() => {
    __resetTestDriveState()
  })

  it('a merge removes the feature build and sweeps its now-orphaned base', async () => {
    await createFeatureBranch(project, 'shipme', 'main')
    await g.checkout('feature/shipme')
    writeFileSync(join(project.repoPath, 'feature.txt'), 'hi\n')
    await g.add(['feature.txt'])
    await g.commit('feat: work')
    await g.checkout('main')
    const feature = seedFeature(ctx, project.id, { slug: 'shipme', phase: 'review' })
    const other = seedFeature(ctx, project.id, { slug: 'other', phase: 'building' })
    writeFeatureBuild(feature.id, 'b1b1b1b')
    writeFeatureBuild(other.id, 'c2c2c2c')
    const ownBase = writeBaseBuild('b1b1b1b')
    const sharedBase = writeBaseBuild('c2c2c2c')

    const res = await createCallerFactory(appRouter)(ctx).feature.merge({ featureId: feature.id })

    expect(res.ok).toBe(true)
    expect(existsSync(featureStoriesDir(feature.id))).toBe(false)
    expect(existsSync(ownBase)).toBe(false)
    expect(existsSync(featureStoriesDir(other.id))).toBe(true)
    expect(existsSync(sharedBase)).toBe(true)
  }, 15_000)

  it('a delete removes the feature build and sweeps its now-orphaned base', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'del-me', phase: 'review' })
    writeFeatureBuild(feature.id, 'b1b1b1b')
    const base = writeBaseBuild('b1b1b1b')

    const res = await deleteFeature(ctx, feature.id)

    expect(res.ok).toBe(true)
    expect(existsSync(featureStoriesDir(feature.id))).toBe(false)
    expect(existsSync(base)).toBe(false)
  })

  // Root ignores directory permissions, so the removal cannot be made to fail.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a removal that fails never fails the merge',
    async () => {
      await createFeatureBranch(project, 'stuck', 'main')
      await g.checkout('feature/stuck')
      writeFileSync(join(project.repoPath, 'stuck.txt'), 'hi\n')
      await g.add(['stuck.txt'])
      await g.commit('feat: work')
      await g.checkout('main')
      const feature = seedFeature(ctx, project.id, { slug: 'stuck', phase: 'review' })
      writeFeatureBuild(feature.id, null)
      const base = writeBaseBuild('b1b1b1b')
      // Neither the feature build nor the base build can be unlinked.
      const featuresRoot = join(storiesRoot(), 'features')
      const baseRoot = join(storiesRoot(), 'base')
      chmodSync(featuresRoot, 0o500)
      chmodSync(baseRoot, 0o500)
      try {
        const res = await createCallerFactory(appRouter)(ctx).feature.merge({
          featureId: feature.id,
        })
        expect(res.ok).toBe(true)
        expect(getFeatureRow(ctx, feature.id).status).toBe('shipped')
        expect(existsSync(featureStoriesDir(feature.id))).toBe(true)
        expect(existsSync(base)).toBe(true)
      } finally {
        chmodSync(featuresRoot, 0o700)
        chmodSync(baseRoot, 0o700)
      }
    },
    15_000,
  )
})
