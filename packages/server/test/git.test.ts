import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { newId, worktreeDir } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { listAfter } from '../src/services/events'
import {
  __resetTestDriveState,
  commitDocs,
  createFeatureBranch,
  detachWorktree,
  ensureTalkWorktree,
  mergeFeature,
  reattachWorktree,
  testDrive,
} from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * B2 git service against REAL git in temp fixture repos. Fixtures pin
 * `core.autocrlf false` so Windows CRLF conversion never dirties the tree, and
 * set a local identity so commits succeed with no global git config.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

/** git init -b main + local identity + autocrlf false + one seed commit. */
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

function insertRun(ctx: AppCtx, featureId: string, status: 'running' | 'succeeded'): void {
  ctx.db
    .insert(runs)
    .values({
      id: newId('run'),
      featureId,
      workflow: 'ticket-burner',
      status,
      startedAt: Date.now(),
      endedAt: null,
      summary: null,
    })
    .run()
}

async function currentBranch(g: SimpleGit): Promise<string> {
  return (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
}

beforeEach(() => {
  __resetTestDriveState()
})

afterEach(() => {
  __resetTestDriveState()
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup — a lingering handle on Windows is non-fatal
      }
    }
  }
})

describe('createFeatureBranch', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-branch-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  it('creates feature/<slug> from main without switching the main checkout', async () => {
    const branch = await createFeatureBranch(project, 'my-feat')
    expect(branch).toBe('feature/my-feat')

    const g = simpleGit(project.repoPath)
    const branches = await g.branchLocal()
    expect(branches.all).toContain('feature/my-feat')
    // main checkout must be untouched
    expect(await currentBranch(g)).toBe('main')
  })

  it('is idempotent when the branch already exists', async () => {
    await createFeatureBranch(project, 'dup')
    const again = await createFeatureBranch(project, 'dup')
    expect(again).toBe('feature/dup')
    const branches = await simpleGit(project.repoPath).branchLocal()
    expect(branches.all.filter((b) => b === 'feature/dup')).toHaveLength(1)
  })
})

describe('ensureTalkWorktree', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let prevUserProfile: string | undefined
  let prevHome: string | undefined

  beforeEach(async () => {
    // Redirect `~/.runcastle` (worktreeDir) into an isolated temp home so the
    // test never writes to the developer's real data dir.
    const home = mkTmp('rc-home-')
    prevUserProfile = process.env.USERPROFILE
    prevHome = process.env.HOME
    process.env.USERPROFILE = home
    process.env.HOME = home

    ctx = await makeTestCtx()
    const repo = mkTmp('rc-wt-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'wt' })
    await createFeatureBranch(project, feature.slug)
  })

  afterEach(() => {
    process.env.USERPROFILE = prevUserProfile
    process.env.HOME = prevHome
  })

  it('creates a worktree checked out to the feature branch', async () => {
    const wt = await ensureTalkWorktree(project, feature)
    expect(wt).toBe(worktreeDir(project.id, feature.slug))
    expect(existsSync(wt)).toBe(true)
    expect(await currentBranch(simpleGit(wt))).toBe('feature/wt')
  })

  it('reuses an existing valid worktree', async () => {
    const first = await ensureTalkWorktree(project, feature)
    const second = await ensureTalkWorktree(project, feature)
    expect(second).toBe(first)
    expect(existsSync(join(second, '.git'))).toBe(true)
  })

  it('recovers from a stale worktree (dir removed) via prune + retry', async () => {
    const first = await ensureTalkWorktree(project, feature)
    // Delete the worktree dir out from under git: registry now disagrees.
    rmSync(first, { recursive: true, force: true })
    expect(existsSync(first)).toBe(false)

    const second = await ensureTalkWorktree(project, feature)
    expect(second).toBe(first)
    expect(existsSync(join(second, '.git'))).toBe(true)
    expect(await currentBranch(simpleGit(second))).toBe('feature/wt')
  })
})

describe('detachWorktree / reattachWorktree', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let prevUserProfile: string | undefined
  let prevHome: string | undefined

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    prevUserProfile = process.env.USERPROFILE
    prevHome = process.env.HOME
    process.env.USERPROFILE = home
    process.env.HOME = home

    ctx = await makeTestCtx()
    const repo = mkTmp('rc-detach-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'dt' })
    await createFeatureBranch(project, feature.slug)
  })

  afterEach(() => {
    process.env.USERPROFILE = prevUserProfile
    process.env.HOME = prevHome
  })

  it('detaches the talk worktree, freeing the branch, then reattaches it', async () => {
    const wt = await ensureTalkWorktree(project, feature)
    expect(await currentBranch(simpleGit(wt))).toBe('feature/dt')

    const detached = await detachWorktree(wt)
    expect(detached).toBe(true)
    expect(await currentBranch(simpleGit(wt))).toBe('HEAD') // detached
    // feature docs / files remain present while detached
    expect(existsSync(join(wt, '.git'))).toBe(true)

    // the branch is now free: the MAIN checkout can switch onto it
    const g = simpleGit(project.repoPath)
    await g.checkout('feature/dt')
    expect(await currentBranch(g)).toBe('feature/dt')
    await g.checkout('main')

    await reattachWorktree(wt, feature.branch)
    expect(await currentBranch(simpleGit(wt))).toBe('feature/dt')
  })

  it('returns false for a missing path or an already-detached worktree', async () => {
    expect(await detachWorktree(join(project.repoPath, 'nope'))).toBe(false)

    const wt = await ensureTalkWorktree(project, feature)
    expect(await detachWorktree(wt)).toBe(true)
    expect(await detachWorktree(wt)).toBe(false) // already detached
  })
})

describe('testDrive with a live talk worktree', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let prevUserProfile: string | undefined
  let prevHome: string | undefined

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    prevUserProfile = process.env.USERPROFILE
    prevHome = process.env.HOME
    process.env.USERPROFILE = home
    process.env.HOME = home

    ctx = await makeTestCtx()
    const repo = mkTmp('rc-drive-wt-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'drivewt' })
    await createFeatureBranch(project, feature.slug)
    // A live talk worktree holds feature/drivewt checked out (the collision).
    await ensureTalkWorktree(project, feature)
  })

  afterEach(() => {
    __resetTestDriveState()
    process.env.USERPROFILE = prevUserProfile
    process.env.HOME = prevHome
  })

  it('start switches the main checkout onto the feature branch despite the talk worktree; stop restores + reattaches', async () => {
    const g = simpleGit(project.repoPath)
    const wt = worktreeDir(project.id, feature.slug)
    expect(await currentBranch(g)).toBe('main')

    const start = await testDrive(ctx, project, feature, 'start')
    expect(start.ok).toBe(true)
    expect(start.branch).toBe('feature/drivewt')
    expect(await currentBranch(g)).toBe('feature/drivewt')
    // talk worktree was detached to free the branch
    expect(await currentBranch(simpleGit(wt))).toBe('HEAD')

    const stop = await testDrive(ctx, project, feature, 'stop')
    expect(stop.ok).toBe(true)
    expect(await currentBranch(g)).toBe('main')
    // talk worktree reattached to the feature branch
    expect(await currentBranch(simpleGit(wt))).toBe('feature/drivewt')
  })
})

describe('commitDocs', () => {
  let ctx: AppCtx
  let repo: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repo = mkTmp('rc-docs-')
    await initRepo(repo)
    seedProject(ctx, repo)
  })

  it('commits only docs/features and never touches other staged paths', async () => {
    const docsDir = join(repo, 'docs', 'features', 'x')
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'decisions.md'), '# Decisions\n')

    // A pre-staged non-docs change that must NOT be swept into the commit.
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', 'app.ts'), 'export const x = 1\n')
    const g = simpleGit(repo)
    await g.add(['src/app.ts'])

    await commitDocs(repo, 'docs(x): checkpoint')

    const committed = (await g.raw(['show', '--pretty=format:', '--name-only', 'HEAD']))
      .trim()
      .split('\n')
      .filter(Boolean)
    expect(committed).toContain('docs/features/x/decisions.md')
    expect(committed).not.toContain('src/app.ts')

    // The non-docs change is still staged (uncommitted), proving scoping.
    const status = await g.status()
    expect(status.staged).toContain('src/app.ts')
  })

  it('is a no-op when there are no docs changes', async () => {
    const g = simpleGit(repo)

    // No docs/features dir at all → early return, HEAD unchanged.
    const before = (await g.revparse(['HEAD'])).trim()
    await commitDocs(repo, 'docs: noop')
    expect((await g.revparse(['HEAD'])).trim()).toBe(before)

    // Commit once, then a second call with nothing new is also a no-op.
    const docsDir = join(repo, 'docs', 'features', 'y')
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# Brief\n')
    await commitDocs(repo, 'docs(y): first')
    const afterFirst = (await g.revparse(['HEAD'])).trim()
    await commitDocs(repo, 'docs(y): again')
    expect((await g.revparse(['HEAD'])).trim()).toBe(afterFirst)
  })
})

describe('testDrive', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-drive-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'drive' })
    await createFeatureBranch(project, feature.slug)
  })

  it('denies start when the main checkout is dirty', async () => {
    writeFileSync(join(project.repoPath, 'dirty.txt'), 'x')
    const res = await testDrive(ctx, project, feature, 'start')
    expect(res.ok).toBe(false)
    expect(res.deniedReason).toBe('Working tree has uncommitted changes — commit or stash first')
  })

  it('denies start when the feature has an active run', async () => {
    insertRun(ctx, feature.id, 'running')
    const res = await testDrive(ctx, project, feature, 'start')
    expect(res.ok).toBe(false)
    expect(res.deniedReason).toBe('Feature has an active run — wait for it to finish')
  })

  it('denies a second start while a test drive is already active', async () => {
    const first = await testDrive(ctx, project, feature, 'start')
    expect(first.ok).toBe(true)

    const second = await testDrive(ctx, project, feature, 'start')
    expect(second.ok).toBe(false)
    expect(second.deniedReason).toBe('A test drive is already active — stop it first')

    await testDrive(ctx, project, feature, 'stop')
  })

  it('happy path: start switches to the feature branch, stop restores the previous branch', async () => {
    const g = simpleGit(project.repoPath)
    expect(await currentBranch(g)).toBe('main')

    const start = await testDrive(ctx, project, feature, 'start')
    expect(start.ok).toBe(true)
    expect(start.branch).toBe('feature/drive')
    expect(await currentBranch(g)).toBe('feature/drive')

    const stop = await testDrive(ctx, project, feature, 'stop')
    expect(stop.ok).toBe(true)
    expect(stop.branch).toBe('main')
    expect(await currentBranch(g)).toBe('main')

    const types = listAfter(ctx, feature.id, 0).map((e) => e.type)
    expect(types).toContain('testdrive.started')
    expect(types).toContain('testdrive.stopped')
  })

  it('stop is a no-op denial when nothing is active', async () => {
    const res = await testDrive(ctx, project, feature, 'stop')
    expect(res.ok).toBe(false)
    expect(res.deniedReason).toBe('No test drive is active')
  })
})

describe('mergeFeature', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-merge-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  it('happy path: merges the feature branch with --no-ff and stays on main', async () => {
    await createFeatureBranch(project, 'happy')
    const g = simpleGit(project.repoPath)
    await g.checkout('feature/happy')
    writeFileSync(join(project.repoPath, 'feature.txt'), 'hello\n')
    await g.add(['feature.txt'])
    await g.commit('feat: add feature.txt')
    await g.checkout('main')

    const feature = seedFeature(ctx, project.id, { slug: 'happy' })
    const res = await mergeFeature(project, feature)

    expect(res.ok).toBe(true)
    expect(res.conflict).toBeUndefined()
    expect(await currentBranch(g)).toBe('main')
    expect(existsSync(join(project.repoPath, 'feature.txt'))).toBe(true)
    // --no-ff → the merge produces a dedicated merge commit (two parents)
    const parents = (await g.raw(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(/\s+/)
    expect(parents.length).toBe(3)
  })

  it('conflict: aborts, reports conflict, and leaves a clean checkout on main', async () => {
    await createFeatureBranch(project, 'clash')
    const g = simpleGit(project.repoPath)

    // Both branches edit the same line of README.md (seeded as 'base').
    await g.checkout('feature/clash')
    writeFileSync(join(project.repoPath, 'README.md'), 'feature-line\n')
    await g.add(['README.md'])
    await g.commit('feat: edit readme')

    await g.checkout('main')
    writeFileSync(join(project.repoPath, 'README.md'), 'main-line\n')
    await g.add(['README.md'])
    await g.commit('chore: edit readme on main')

    const feature = seedFeature(ctx, project.id, { slug: 'clash' })
    const res = await mergeFeature(project, feature)

    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    // abort must leave the working tree clean and back on main
    expect((await g.raw(['status', '--porcelain'])).trim()).toBe('')
    expect(await currentBranch(g)).toBe('main')
  })

  it('denies merge while a test drive is active', async () => {
    await createFeatureBranch(project, 'guard')
    const feature = seedFeature(ctx, project.id, { slug: 'guard' })

    const start = await testDrive(ctx, project, feature, 'start')
    expect(start.ok).toBe(true)

    await expect(mergeFeature(project, feature)).rejects.toThrow(/test drive/i)

    await testDrive(ctx, project, feature, 'stop')
  })

  it('denies merge when the checkout is dirty', async () => {
    await createFeatureBranch(project, 'dirtymerge')
    writeFileSync(join(project.repoPath, 'junk.txt'), 'x')
    const feature = seedFeature(ctx, project.id, { slug: 'dirtymerge' })

    await expect(mergeFeature(project, feature)).rejects.toThrow(/uncommitted changes/i)
  })
})
