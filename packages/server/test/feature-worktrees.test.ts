import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, projectWorktreesDir, worktreeDir, worktreesRoot } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { sweepFeatureWorktrees } from '../src/services/feature-worktrees'
import { archiveFeature, unarchiveFeature } from '../src/services/features'
import { __resetTestDriveState, createFeatureBranch, ensureTalkWorktree } from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * A finished feature's talk worktree is retired: removed on ship, removed on
 * archive when clean, and swept at boot — against REAL git in temp repos. The
 * data dir is pinned to a temp home for every test, so no worktree is ever
 * created under (or swept from) the developer's real `~/.runcastle`.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
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

let ctx: AppCtx
let project: Project
let g: SimpleGit
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = useDataDir(mkTmp('rc-home-'))
  __resetTestDriveState()
  ctx = await makeTestCtx()
  const repo = mkTmp('rc-wt-')
  g = await initRepo(repo)
  project = seedProject(ctx, repo)
})

afterEach(() => {
  restoreDataDir()
  __resetTestDriveState()
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (!dir) continue
    try {
      rmTemp(dir)
    } catch {
      // best-effort cleanup
    }
  }
})

/** A feature with its branch cut and its talk worktree checked out. */
async function featureWithWorktree(overrides: Partial<Feature> & { slug: string }): Promise<{
  feature: Feature
  worktree: string
}> {
  await createFeatureBranch(project, overrides.slug, 'main')
  const feature = seedFeature(ctx, project.id, overrides)
  return { feature, worktree: await ensureTalkWorktree(project, feature) }
}

async function branchExists(branch: string): Promise<boolean> {
  return (await g.branchLocal()).all.includes(branch)
}

function eventOf(feature: Feature, type: string) {
  return listAfter(ctx, feature.id, 0).find((e) => e.type === type)
}

describe('ship', () => {
  it('removes the talk worktree, keeps the branch, and a relaunch recreates it', async () => {
    const { feature, worktree } = await featureWithWorktree({ slug: 'happy', phase: 'review' })
    writeFileSync(join(worktree, 'feature.txt'), 'hi\n')
    await simpleGit(worktree).add(['feature.txt']).commit('feat: work')

    const res = await createCallerFactory(appRouter)(ctx).feature.merge({ featureId: feature.id })

    expect(res.ok).toBe(true)
    expect(getFeatureRow(ctx, feature.id).status).toBe('shipped')
    expect(existsSync(worktree)).toBe(false)
    expect(await branchExists('feature/happy')).toBe(true)
    expect(eventOf(feature, 'feature.worktree_removed')?.data).toEqual({ path: worktree })

    await ensureTalkWorktree(project, getFeatureRow(ctx, feature.id))
    expect(existsSync(join(worktree, 'feature.txt'))).toBe(true)
  }, 20_000)

  // POSIX-only: a read-only parent is the Linux stand-in for a Windows locked
  // file; on Windows chmod does not block the delete.
  it.skipIf(process.platform === 'win32')(
    'still ships when the worktree cannot be removed, and says so in an event',
    async () => {
      const { feature, worktree } = await featureWithWorktree({ slug: 'locked', phase: 'review' })

      const parent = projectWorktreesDir(project.id)
      chmodSync(parent, 0o500)
      let res
      try {
        res = await createCallerFactory(appRouter)(ctx).feature.merge({ featureId: feature.id })
      } finally {
        chmodSync(parent, 0o700)
      }

      expect(res.ok).toBe(true)
      const row = getFeatureRow(ctx, feature.id)
      expect(row.phase).toBe('shipped')
      expect(row.status).toBe('shipped')
      expect(existsSync(worktree)).toBe(true)
      expect(eventOf(feature, 'feature.worktree_remove_failed')?.data).toEqual({ path: worktree })
    },
    20_000,
  )
})

describe('archive', () => {
  it('removes a clean worktree; unarchive + relaunch recreates it', async () => {
    const { feature, worktree } = await featureWithWorktree({ slug: 'tidy', phase: 'building' })

    await archiveFeature(ctx, feature.id)

    expect(existsSync(worktree)).toBe(false)
    expect(await branchExists('feature/tidy')).toBe(true)
    expect(eventOf(feature, 'feature.worktree_removed')?.data).toEqual({ path: worktree })

    unarchiveFeature(ctx, feature.id)
    await ensureTalkWorktree(project, getFeatureRow(ctx, feature.id))
    expect(existsSync(join(worktree, 'README.md'))).toBe(true)
  })

  it('keeps a dirty worktree and emits why', async () => {
    const { feature, worktree } = await featureWithWorktree({ slug: 'messy', phase: 'building' })
    writeFileSync(join(worktree, 'draft.md'), 'not committed\n')

    await archiveFeature(ctx, feature.id)

    expect(getFeatureRow(ctx, feature.id).status).toBe('archived')
    expect(existsSync(join(worktree, 'draft.md'))).toBe(true)
    expect(eventOf(feature, 'feature.worktree_kept')?.data).toEqual({
      path: worktree,
      reason: 'uncommitted changes',
    })
  })
})

describe('boot sweep', () => {
  it('removes finished and orphaned worktrees, and leaves everything else alone', async () => {
    const shipped = await featureWithWorktree({ slug: 'shipped', phase: 'shipped', status: 'shipped' })
    const archivedDirty = await featureWithWorktree({ slug: 'dirty', status: 'archived' })
    writeFileSync(join(archivedDirty.worktree, 'wip.md'), 'wip\n')
    const active = await featureWithWorktree({ slug: 'active', status: 'active' })

    // The project session's worktree, and a leftover no feature row owns.
    const projectSession = worktreeDir(project.id, PROJECT_WORKTREE_SLUG)
    mkdirSync(projectSession, { recursive: true })
    const stray = worktreeDir(project.id, 'stray')
    mkdirSync(stray, { recursive: true })
    writeFileSync(join(stray, 'junk.txt'), 'junk\n')

    // Dirs of projects that no longer exist — a leading `_` on a project id
    // means nothing (`newId` can mint one).
    const gone = join(worktreesRoot(), 'proj_gone')
    mkdirSync(join(gone, 'some-slug'), { recursive: true })
    const underscored = join(worktreesRoot(), '_proj_gone')
    mkdirSync(underscored, { recursive: true })

    const sweep = await sweepFeatureWorktrees(ctx)

    expect(existsSync(shipped.worktree)).toBe(false)
    expect(existsSync(stray)).toBe(false)
    expect(existsSync(gone)).toBe(false)
    expect(existsSync(underscored)).toBe(false)
    expect(existsSync(join(archivedDirty.worktree, 'wip.md'))).toBe(true)
    expect(existsSync(active.worktree)).toBe(true)
    expect(existsSync(projectSession)).toBe(true)
    expect(sweep).toEqual({ removed: 2, kept: 1, failed: 0, orphanProjects: 2 })
    expect(await branchExists('feature/shipped')).toBe(true)
  }, 20_000)

  it('is a no-op when there is no worktrees dir yet', async () => {
    expect(await sweepFeatureWorktrees(ctx)).toEqual({
      removed: 0,
      kept: 0,
      failed: 0,
      orphanProjects: 0,
    })
  })
})
