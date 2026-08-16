import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { listAfter } from '../src/services/events'
import {
  __resetTestDriveState,
  activeDriveInfo,
  activeTestDriveFeatureId,
  burnWorktreePath,
  cleanupBurnWorktree,
  cleanupTempBranches,
  commitDocs,
  createFeatureBranch,
  listBranches,
  detachWorktree,
  ensureTalkWorktree,
  mergeFeature,
  commitSummaries,
  mergeTempBranch,
  reattachWorktree,
  recordDriveUrl,
  researchBranchName,
  resolveBaseBranch,
  reviewCommitCount,
  testDrive,
  ticketBranchName,
} from '../src/services/git'
import { useDataDir } from './helpers/data-dir'
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

/**
 * Give `repo` an `origin` remote (a bare clone) that carries `branch`, WITHOUT a
 * local copy of it — i.e. `origin/<branch>` exists as a remote-tracking ref only.
 * Mirrors a fresh clone where the team's base line lives only on the remote.
 */
async function addRemoteOnlyBranch(g: SimpleGit, repoDir: string, branch: string): Promise<void> {
  const remote = mkTmp('rc-origin-')
  await simpleGit(remote).init(['--bare', '-b', 'main'])
  await g.addRemote('origin', remote)
  await g.push(['-u', 'origin', 'main'])
  await g.checkoutLocalBranch(branch)
  writeFileSync(join(repoDir, `${branch}.txt`), 'seed\n')
  await g.add([`${branch}.txt`])
  await g.commit(`seed ${branch}`)
  await g.push(['-u', 'origin', branch])
  await g.checkout('main')
  await g.branch(['-D', branch])
  await g.fetch()
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

  it('forks off an explicit base branch, not just mainBranch', async () => {
    const g = simpleGit(project.repoPath)
    // A release line diverged from main by one commit.
    await g.raw(['branch', 'release'])
    await g.checkout('release')
    writeFileSync(join(project.repoPath, 'REL.md'), 'rel\n')
    await g.add(['REL.md'])
    await g.commit('release-only commit')
    const releaseTip = (await g.revparse(['release'])).trim()
    await g.checkout('main')

    const branch = await createFeatureBranch(project, 'off-release', 'release')
    expect(branch).toBe('feature/off-release')
    // The new branch points at the release tip, not main's tip.
    expect((await g.revparse(['feature/off-release'])).trim()).toBe(releaseTip)
    expect(await currentBranch(g)).toBe('main')
  })

  it('falls back to mainBranch when base is blank/undefined', async () => {
    const g = simpleGit(project.repoPath)
    const mainTip = (await g.revparse(['main'])).trim()
    await createFeatureBranch(project, 'blank-base', '   ')
    expect((await g.revparse(['feature/blank-base'])).trim()).toBe(mainTip)
  })

  it('throws a clear error when the base branch does not exist', async () => {
    await expect(createFeatureBranch(project, 'bad-base', 'nope')).rejects.toThrow(/"nope"/)
    const branches = await simpleGit(project.repoPath).branchLocal()
    expect(branches.all).not.toContain('feature/bad-base')
  })
})

describe('listBranches', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-listbr-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  it('reports current + mainBranch and excludes feature/* branches', async () => {
    const g = simpleGit(project.repoPath)
    await g.raw(['branch', 'dev'])
    await createFeatureBranch(project, 'hidden')

    const res = await listBranches(project)
    expect(res.mainBranch).toBe('main')
    expect(res.current).toBe('main')
    expect(res.branches).toContain('main')
    expect(res.branches).toContain('dev')
    expect(res.branches).not.toContain('feature/hidden')
    expect(res.remoteBranches).toEqual([])
  })

  it('surfaces remote-only branches and hides ones shadowed by a local twin', async () => {
    const g = simpleGit(project.repoPath)
    await addRemoteOnlyBranch(g, project.repoPath, 'release')

    const res = await listBranches(project)
    // release lives only on the remote → offered as origin/release.
    expect(res.remoteBranches).toContain('origin/release')
    // main has a local twin → not repeated as a remote option; no symbolic HEAD.
    expect(res.remoteBranches).not.toContain('origin/main')
    expect(res.remoteBranches.some((b) => b.endsWith('/HEAD'))).toBe(false)
    expect(res.branches).not.toContain('origin/release')
  })
})

describe('resolveBaseBranch', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-resolve-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  it('passes an existing local branch through unchanged', async () => {
    await simpleGit(project.repoPath).raw(['branch', 'develop'])
    expect(await resolveBaseBranch(project, 'develop')).toBe('develop')
  })

  it('materializes a local tracking branch for a remote-only pick', async () => {
    const g = simpleGit(project.repoPath)
    await addRemoteOnlyBranch(g, project.repoPath, 'release')

    const resolved = await resolveBaseBranch(project, 'origin/release')
    expect(resolved).toBe('release')
    // A real local branch now exists (a valid future merge target)...
    const local = await g.branchLocal()
    expect(local.all).toContain('release')
    // ...tracking origin/release.
    const upstream = (
      await g.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', 'release@{u}'])
    ).trim()
    expect(upstream).toBe('origin/release')
  })

  it('reuses an existing local branch instead of clobbering it', async () => {
    const g = simpleGit(project.repoPath)
    await addRemoteOnlyBranch(g, project.repoPath, 'release')
    // A local `release` diverged from origin/release by a commit.
    await g.checkoutLocalBranch('release')
    writeFileSync(join(project.repoPath, 'local-only.txt'), 'x\n')
    await g.add(['local-only.txt'])
    await g.commit('local divergence')
    const localTip = (await g.revparse(['release'])).trim()
    await g.checkout('main')

    expect(await resolveBaseBranch(project, 'origin/release')).toBe('release')
    // The existing local branch is untouched (not reset to the remote tip).
    expect((await g.revparse(['release'])).trim()).toBe(localTip)
  })

  it('throws when the pick names neither a local nor a remote branch', async () => {
    await expect(resolveBaseBranch(project, 'ghost')).rejects.toThrow(/"ghost"/)
  })
})

describe('ensureTalkWorktree', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let restoreDataDir: () => void

  beforeEach(async () => {
    // Redirect `~/.runcastle` (worktreeDir) into an isolated temp home so the
    // test never writes to the developer's real data dir.
    const home = mkTmp('rc-home-')
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    const repo = mkTmp('rc-wt-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'wt' })
    await createFeatureBranch(project, feature.slug)
  })

  afterEach(() => {
    restoreDataDir()
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

  it('reattaches a registered-but-detached worktree instead of failing to re-add it', async () => {
    // The post-test-drive state: the drive detached the talk worktree to take the
    // branch, and the reattach on stop did not happen (it is best-effort). git
    // still owns the path, so `worktree add` would refuse it.
    const first = await ensureTalkWorktree(project, feature)
    expect(await detachWorktree(first)).toBe(true)
    expect(await currentBranch(simpleGit(first))).toBe('HEAD')

    const second = await ensureTalkWorktree(project, feature)
    expect(second).toBe(first)
    expect(await currentBranch(simpleGit(second))).toBe('feature/wt')
    // One worktree, not a second one bolted on beside it.
    const list = await simpleGit(project.repoPath).raw(['worktree', 'list', '--porcelain'])
    expect(list.match(/^worktree /gm)?.length).toBe(2) // the main checkout + the talk worktree
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
  let restoreDataDir: () => void

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    const repo = mkTmp('rc-detach-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'dt' })
    await createFeatureBranch(project, feature.slug)
  })

  afterEach(() => {
    restoreDataDir()
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
  let restoreDataDir: () => void

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    restoreDataDir = useDataDir(home)

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
    restoreDataDir()
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

  it('activeDriveInfo surfaces the driven branch and the sniffed dev URL, cleared on stop', async () => {
    expect(activeDriveInfo()).toBeNull()

    await testDrive(ctx, project, feature, 'start')
    // No devCommand on the seeded project → no pane, but the drive is reported.
    // `devConfigured: false` is what lets the review card say the branch is
    // checked out and nothing was started, instead of "driving now" (F22).
    expect(activeDriveInfo()).toMatchObject({
      featureId: feature.id,
      // Whose drive it is, so the UI can tell this apart from a review agent's.
      purpose: 'human',
      branch: 'feature/drive',
      devPaneId: undefined,
      devUrl: undefined,
      devConfigured: false,
    })

    // A sniffed URL becomes the sticky "Open app" link and lands on the timeline.
    recordDriveUrl(ctx, feature.id, 'http://localhost:5173/')
    expect(activeDriveInfo()?.devUrl).toBe('http://localhost:5173/')
    // Sticky: a later/different URL does not overwrite the first.
    recordDriveUrl(ctx, feature.id, 'http://localhost:9999/')
    expect(activeDriveInfo()?.devUrl).toBe('http://localhost:5173/')
    expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain('testdrive.url')

    await testDrive(ctx, project, feature, 'stop')
    expect(activeDriveInfo()).toBeNull()
  })

  it('recordDriveUrl ignores a URL for a feature that is not the active drive', async () => {
    await testDrive(ctx, project, feature, 'start')
    recordDriveUrl(ctx, 'feat_someone_else', 'http://localhost:3000/')
    expect(activeDriveInfo()?.devUrl).toBeUndefined()
    await testDrive(ctx, project, feature, 'stop')
  })

  // Test-drive hooks. runcastle holds no model of what "bringing the project
  // up" means — the project supplies a shell string and we run it, which is the
  // only answer that works across Postgres, SQLite, Mongo, compose stacks and
  // projects with no data layer at all.
  it('runs the project driveSetupCommand on start and reports it on the timeline', async () => {
    const withHook = { ...project, driveSetupCommand: 'echo setup-hook-ran' }
    const start = await testDrive(ctx, withHook, feature, 'start')
    expect(start.ok).toBe(true)
    expect(start.hookFailure).toBeUndefined()

    const events = listAfter(ctx, feature.id, 0)
    expect(events.map((e) => e.type)).toContain('testdrive.setup_ok')

    await testDrive(ctx, withHook, feature, 'stop')
  })

  it('runs driveStopCommand on stop', async () => {
    const withHook = { ...project, driveStopCommand: 'echo teardown-hook-ran' }
    await testDrive(ctx, withHook, feature, 'start')
    const stop = await testDrive(ctx, withHook, feature, 'stop')
    expect(stop.ok).toBe(true)
    expect(stop.hookFailure).toBeUndefined()
    expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain('testdrive.teardown_ok')
  })

  // The checkout has already switched by the time setup runs. Refusing the
  // drive would strand the user on a branch they did not ask to be on, so a
  // failing hook is reported loudly and the drive continues.
  it('a failing setup hook does not fail the drive, but is reported', async () => {
    const withHook = { ...project, driveSetupCommand: 'exit 4' }
    const start = await testDrive(ctx, withHook, feature, 'start')

    expect(start.ok).toBe(true)
    expect(await currentBranch(simpleGit(project.repoPath))).toBe('feature/drive')
    expect(start.hookFailure).toMatchObject({ phase: 'setup', command: 'exit 4', exitCode: 4 })
    expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain('testdrive.setup_failed')

    await testDrive(ctx, withHook, feature, 'stop')
  })

  it('a failing teardown hook still returns the user to their branch', async () => {
    const withHook = { ...project, driveStopCommand: 'exit 5' }
    await testDrive(ctx, withHook, feature, 'start')
    const stop = await testDrive(ctx, withHook, feature, 'stop')

    expect(stop.ok).toBe(true)
    expect(await currentBranch(simpleGit(project.repoPath))).toBe('main')
    expect(stop.hookFailure).toMatchObject({ phase: 'teardown', exitCode: 5 })
  })

  // Teardown describes the environment the FEATURE branch built, and the files
  // that describe it (compose file, migrations) are the ones on that branch.
  it('runs teardown before switching back, while the feature branch is checked out', async () => {
    const marker = join(project.repoPath, 'branch-at-teardown.txt')
    const withHook = {
      ...project,
      driveStopCommand: `git rev-parse --abbrev-ref HEAD > "${marker}"`,
    }
    await testDrive(ctx, withHook, feature, 'start')
    await testDrive(ctx, withHook, feature, 'stop')

    expect(readFileSync(marker, 'utf8').trim()).toBe('feature/drive')
  })

  // The generic half of "a database per branch": we render and inject the
  // variables, the project's own command creates whatever they name.
  it('renders driveEnv into the hook environment, per branch', async () => {
    const marker = join(project.repoPath, 'seen-env.txt')
    const withEnv = {
      ...project,
      driveEnv: 'DATABASE_URL=postgres://localhost:5432/myapp_{{id}}',
      driveSetupCommand:
        process.platform === 'win32'
          ? `echo %DATABASE_URL% > "${marker}"`
          : `echo "$DATABASE_URL" > "${marker}"`,
    }
    await testDrive(ctx, withEnv, feature, 'start')

    expect(readFileSync(marker, 'utf8').trim()).toBe('postgres://localhost:5432/myapp_drive')

    await testDrive(ctx, withEnv, feature, 'stop')
  })

  // Setup creates the database and the dev server has to connect to THAT one;
  // two different renderings would be worse than not doing this at all.
  it('gives the teardown hook the same rendering the setup hook saw', async () => {
    const setupMarker = join(project.repoPath, 'setup-env.txt')
    const stopMarker = join(project.repoPath, 'stop-env.txt')
    const write = (m: string) =>
      process.platform === 'win32' ? `echo %DATABASE_URL% > "${m}"` : `echo "$DATABASE_URL" > "${m}"`
    const withEnv = {
      ...project,
      driveEnv: 'DATABASE_URL=db_{{id}}',
      driveSetupCommand: write(setupMarker),
      driveStopCommand: write(stopMarker),
    }

    await testDrive(ctx, withEnv, feature, 'start')
    await testDrive(ctx, withEnv, feature, 'stop')

    expect(readFileSync(stopMarker, 'utf8').trim()).toBe(readFileSync(setupMarker, 'utf8').trim())
  })

  it('reports an unknown placeholder instead of substituting a blank', async () => {
    const withEnv = { ...project, driveEnv: 'DATABASE_URL=db_{{oops}}' }
    await testDrive(ctx, withEnv, feature, 'start')

    expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).toContain(
      'testdrive.env_unknown_placeholder',
    )
    await testDrive(ctx, withEnv, feature, 'stop')
  })

  // Values routinely hold credentials. The timeline is a shared artifact.
  it('records which variables the drive set, never their values', async () => {
    const withEnv = { ...project, driveEnv: 'DATABASE_URL=postgres://user:hunter2@localhost/x' }
    await testDrive(ctx, withEnv, feature, 'start')

    const event = listAfter(ctx, feature.id, 0).find((e) => e.type === 'testdrive.env')
    expect(event?.message).toContain('DATABASE_URL')
    expect(JSON.stringify(event)).not.toContain('hunter2')

    await testDrive(ctx, withEnv, feature, 'stop')
  })

  it('does nothing when the project has no hooks', async () => {
    await testDrive(ctx, project, feature, 'start')
    await testDrive(ctx, project, feature, 'stop')
    const types = listAfter(ctx, feature.id, 0).map((e) => e.type)
    expect(types.some((t) => t.startsWith('testdrive.setup'))).toBe(false)
    expect(types.some((t) => t.startsWith('testdrive.teardown'))).toBe(false)
  })

  it('treats a whitespace-only hook as unset', async () => {
    const withHook = { ...project, driveSetupCommand: '   ' }
    await testDrive(ctx, withHook, feature, 'start')
    expect(listAfter(ctx, feature.id, 0).map((e) => e.type)).not.toContain(
      'testdrive.setup_started',
    )
    await testDrive(ctx, withHook, feature, 'stop')
  })

  it('start detaches a second worktree (e.g. the burner) that pins the branch', async () => {
    const g = simpleGit(project.repoPath)
    // Simulate sandcastle's `.sandcastle/worktrees/*`: a second worktree holding
    // feature/drive, which pins the branch so a naive `checkout` on main fails.
    const burnerWt = join(mkTmp('rc-burner-'), 'wt')
    await g.raw(['worktree', 'add', burnerWt, 'feature/drive'])
    expect(await currentBranch(simpleGit(burnerWt))).toBe('feature/drive')

    const start = await testDrive(ctx, project, feature, 'start')
    expect(start.ok).toBe(true)
    expect(await currentBranch(g)).toBe('feature/drive')
    // the pinning worktree was detached to free the branch for the main checkout
    expect(await currentBranch(simpleGit(burnerWt))).toBe('HEAD')

    const stop = await testDrive(ctx, project, feature, 'stop')
    expect(stop.ok).toBe(true)
    expect(await currentBranch(g)).toBe('main')
  })
})

describe('mergeTempBranch', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let restoreDataDir: () => void

  beforeEach(async () => {
    const home = mkTmp('rc-home-')
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    const repo = mkTmp('rc-research-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'rsr' })
    await createFeatureBranch(project, feature.slug)
  })

  afterEach(() => {
    restoreDataDir()
  })

  /** Create `branch` from `from` and land one commit on it via a temp worktree
   *  (simulating sandcastle's `.sandcastle/worktrees/<branch>` checkout). */
  async function commitOnTempBranch(
    branch: string,
    from: string,
    file: string,
    content: string,
    opts: { keepWorktree?: boolean } = {},
  ): Promise<{ tip: string; worktreePath: string }> {
    const g = simpleGit(project.repoPath)
    await g.raw(['branch', branch, from])
    const worktreePath = join(mkTmp('rc-scwt-'), 'wt')
    await g.raw(['worktree', 'add', worktreePath, branch])
    writeFileSync(join(worktreePath, file), content)
    const gw = simpleGit(worktreePath)
    await gw.add([file])
    await gw.commit(`research: ${file}`)
    const tip = (await g.revparse([branch])).trim()
    if (!opts.keepWorktree) await g.raw(['worktree', 'remove', worktreePath, '--force'])
    return { tip, worktreePath }
  }

  it('clean case: merges into the talk worktree, deletes the temp branch, detaches its leftover worktree', async () => {
    const talkWt = await ensureTalkWorktree(project, feature)
    const temp = researchBranchName(feature.slug, 1, 'abc123')
    // keepWorktree simulates a preserved (dirty) sandcastle worktree pinning temp
    const { tip, worktreePath } = await commitOnTempBranch(temp, feature.branch, 'research.md', 'findings\n', {
      keepWorktree: true,
    })

    const res = await mergeTempBranch(project.repoPath, feature.branch, temp)
    expect(res).toEqual({ ok: true })

    // feature branch fast-forwarded to the research commit; talk worktree stayed
    // attached the whole time and now shows the doc
    const g = simpleGit(project.repoPath)
    expect((await g.revparse([feature.branch])).trim()).toBe(tip)
    expect(await currentBranch(simpleGit(talkWt))).toBe('feature/rsr')
    expect(existsSync(join(talkWt, 'research.md'))).toBe(true)
    // temp branch is gone; the worktree that pinned it was detached first
    expect((await g.branchLocal()).all).not.toContain(temp)
    expect(await currentBranch(simpleGit(worktreePath))).toBe('HEAD')
  })

  it('no-holder case: fast-forwards the ref with no checkout and leaves the main checkout alone', async () => {
    // no talk worktree — nobody holds feature/rsr
    const temp = researchBranchName(feature.slug, 2, 'def456')
    const { tip } = await commitOnTempBranch(temp, feature.branch, 'notes.md', 'notes\n')

    const res = await mergeTempBranch(project.repoPath, feature.branch, temp)
    expect(res).toEqual({ ok: true })

    const g = simpleGit(project.repoPath)
    expect((await g.revparse([feature.branch])).trim()).toBe(tip)
    expect(await currentBranch(g)).toBe('main') // main checkout untouched
    expect((await g.branchLocal()).all).not.toContain(temp)
  })

  it('no-holder non-FF case (parallel tickets): merges via a disposable worktree', async () => {
    // Two tickets fork the same feature tip; the first lands and moves the ref,
    // so the second cannot fast-forward — the normal shape of burn concurrency
    // (this exact case failed as "From . ! [rejected]" in the first real burn).
    const tempA = researchBranchName(feature.slug, 5, 'aaa111')
    const tempB = researchBranchName(feature.slug, 6, 'bbb222')
    const { tip: tipA } = await commitOnTempBranch(tempA, feature.branch, 'a.md', 'a\n')
    await commitOnTempBranch(tempB, feature.branch, 'b.md', 'b\n')

    expect(await mergeTempBranch(project.repoPath, feature.branch, tempA)).toEqual({ ok: true })
    const res = await mergeTempBranch(project.repoPath, feature.branch, tempB)
    expect(res).toEqual({ ok: true })

    const g = simpleGit(project.repoPath)
    // both tickets' files landed on the feature branch (merged, not clobbered)
    const files = (await g.raw(['ls-tree', '--name-only', feature.branch])).split('\n')
    expect(files).toContain('a.md')
    expect(files).toContain('b.md')
    await g.raw(['merge-base', '--is-ancestor', tipA, feature.branch]) // throws if not
    expect(await currentBranch(g)).toBe('main') // main checkout untouched
    expect((await g.branchLocal()).all).not.toContain(tempB)
    // the disposable merge worktree is gone again
    expect(await g.raw(['worktree', 'list', '--porcelain'])).not.toMatch(/rc-land-/)
  })

  it('no-holder non-FF conflict: aborts in the disposable worktree, preserves the temp branch', async () => {
    const tempA = researchBranchName(feature.slug, 7, 'ccc333')
    const tempB = researchBranchName(feature.slug, 8, 'ddd444')
    await commitOnTempBranch(tempA, feature.branch, 'same.md', 'from-a\n')
    await commitOnTempBranch(tempB, feature.branch, 'same.md', 'from-b\n')

    expect(await mergeTempBranch(project.repoPath, feature.branch, tempA)).toEqual({ ok: true })
    const g = simpleGit(project.repoPath)
    const tipAfterA = (await g.revparse([feature.branch])).trim()

    const res = await mergeTempBranch(project.repoPath, feature.branch, tempB)
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    // captured before the abort cleared the unmerged index — this list is what
    // briefs the resolver agent and what the run lane renders
    expect(res.files).toEqual(['same.md'])

    // feature branch untouched, temp branch preserved, no worktree leaked
    expect((await g.revparse([feature.branch])).trim()).toBe(tipAfterA)
    expect((await g.branchLocal()).all).toContain(tempB)
    expect(await g.raw(['worktree', 'list', '--porcelain'])).not.toMatch(/rc-land-/)
  })

  it('conflict case: aborts the merge, keeps the temp branch, leaves the talk worktree clean', async () => {
    const talkWt = await ensureTalkWorktree(project, feature)
    const temp = researchBranchName(feature.slug, 3, 'ghi789')
    // temp edits README from the ORIGINAL feature tip…
    await commitOnTempBranch(temp, feature.branch, 'README.md', 'research-line\n')
    // …and the feature branch moves mid-run: an HITL session edits the same line
    writeFileSync(join(talkWt, 'README.md'), 'hitl-line\n')
    const gw = simpleGit(talkWt)
    await gw.add(['README.md'])
    await gw.commit('docs: hitl edit mid-run')

    const res = await mergeTempBranch(project.repoPath, feature.branch, temp)
    expect(res.ok).toBe(false)
    expect(res.conflict).toBe(true)
    expect(res.files).toEqual(['README.md'])

    // merge aborted: talk worktree clean, still on the feature branch, HITL edit intact
    expect((await gw.raw(['status', '--porcelain'])).trim()).toBe('')
    expect(await currentBranch(gw)).toBe('feature/rsr')
    expect(readFileSync(join(talkWt, 'README.md'), 'utf8')).toBe('hitl-line\n')
    // temp branch preserved for manual recovery
    expect((await simpleGit(project.repoPath).branchLocal()).all).toContain(temp)
  })

  it('commitSummaries lists what landed on the feature branch, newest first', async () => {
    // The resolver's "other side" brief: the sibling work it must reconcile
    // with, seen from a ticket branch that forked before any of it landed.
    const mine = researchBranchName(feature.slug, 10, 'mine111')
    await simpleGit(project.repoPath).raw(['branch', mine, feature.branch])
    const sibling = researchBranchName(feature.slug, 11, 'sib222')
    await commitOnTempBranch(sibling, feature.branch, 'sibling.md', 'sibling\n')
    expect(await mergeTempBranch(project.repoPath, feature.branch, sibling)).toEqual({ ok: true })

    const summaries = await commitSummaries(project.repoPath, mine, feature.branch)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatch(/^[0-9a-f]{7,} research: sibling\.md$/)

    // nothing landed underneath → nothing to brief, never an error
    expect(await commitSummaries(project.repoPath, feature.branch, feature.branch)).toEqual([])
    expect(await commitSummaries(project.repoPath, 'feature/ghost', feature.branch)).toEqual([])
  })

  it('reports missing branches instead of throwing', async () => {
    const missing = await mergeTempBranch(project.repoPath, feature.branch, 'runcastle/research/rsr/9-none')
    expect(missing.ok).toBe(false)
    expect(missing.conflict).toBeUndefined()
    expect(missing.error).toMatch(/not found/)

    const temp = researchBranchName(feature.slug, 4, 'jkl012')
    await simpleGit(project.repoPath).raw(['branch', temp, feature.branch])
    const noFeature = await mergeTempBranch(project.repoPath, 'feature/ghost', temp)
    expect(noFeature.ok).toBe(false)
    expect(noFeature.error).toMatch(/not found/)
  })
})

describe('temp branch names', () => {
  const longSlug = 'add-the-rest-of-the-act-2-assistant-tools-and-functionalities'

  it('truncates long slugs so sandcastle worktree paths stay under Windows MAX_PATH (ADR-0003)', () => {
    expect(ticketBranchName(longSlug, 5, 'NjflEB0m')).toBe(
      'runcastle/ticket/add-the-rest-of/5-NjflEB0m',
    )
    expect(researchBranchName(longSlug, 2, 'abc123')).toBe(
      'runcastle/research/add-the-rest-of/2-abc123',
    )
  })

  it('passes short slugs through unchanged', () => {
    expect(ticketBranchName('swp', 3, 'ccc333')).toBe('runcastle/ticket/swp/3-ccc333')
    expect(researchBranchName('swp', 1, 'aaa111')).toBe('runcastle/research/swp/1-aaa111')
  })
})

describe('cleanupTempBranches', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-sweep-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
    await createFeatureBranch(project, 'swp')
  })

  it('deletes merged temp branches, keeps unmerged ones, never touches foreign branches', async () => {
    const g = simpleGit(project.repoPath)
    // merged: points at the feature branch tip (an ancestor by definition)
    const merged = researchBranchName('swp', 1, 'aaa111')
    await g.raw(['branch', merged, 'feature/swp'])
    // a merged TICKET temp branch is swept by the same pass (M2)
    const mergedTicket = ticketBranchName('swp', 3, 'ccc333')
    await g.raw(['branch', mergedTicket, 'feature/swp'])
    // unmerged: one commit ahead of the feature branch
    const unmerged = researchBranchName('swp', 2, 'bbb222')
    await g.raw(['branch', unmerged, 'feature/swp'])
    const wt = join(mkTmp('rc-sweepwt-'), 'wt')
    await g.raw(['worktree', 'add', wt, unmerged])
    writeFileSync(join(wt, 'orphan.md'), 'never landed\n')
    const gw = simpleGit(wt)
    await gw.add(['orphan.md'])
    await gw.commit('research: orphan')
    await g.raw(['worktree', 'remove', wt, '--force'])
    // an unmerged ticket branch (conflict leftover) must be kept too
    const unmergedTicket = ticketBranchName('swp', 4, 'ddd444')
    await g.raw(['branch', unmergedTicket, unmerged])
    // a user's own branch under a similar-but-not-ours prefix must survive
    await g.raw(['branch', 'research/user-branch', 'main'])
    await g.raw(['branch', 'ticket/user-branch', 'main'])

    const result = await cleanupTempBranches(project.repoPath)
    expect(result.deleted.sort()).toEqual([merged, mergedTicket].sort())
    expect(result.kept.sort()).toEqual([unmerged, unmergedTicket].sort())

    const all = (await g.branchLocal()).all
    expect(all).not.toContain(merged)
    expect(all).not.toContain(mergedTicket)
    expect(all).toContain(unmerged)
    expect(all).toContain(unmergedTicket)
    expect(all).toContain('research/user-branch')
    expect(all).toContain('ticket/user-branch')
  })

  it('maps truncated slug segments to their feature branch and still sweeps old full-slug leftovers', async () => {
    const g = simpleGit(project.repoPath)
    const longSlug = 'add-the-rest-of-the-act-2-assistant-tools-and-functionalities'
    await createFeatureBranch(project, longSlug)
    // current format (ADR-0003): segment is the truncated slug
    const merged = ticketBranchName(longSlug, 1, 'eee555')
    await g.raw(['branch', merged, `feature/${longSlug}`])
    // pre-ADR-0003 leftover: full slug embedded in the branch name
    const oldFormat = `runcastle/ticket/${longSlug}/2-fff666`
    await g.raw(['branch', oldFormat, `feature/${longSlug}`])

    const result = await cleanupTempBranches(project.repoPath)
    expect(result.deleted.sort()).toEqual([merged, oldFormat].sort())
    expect(result.kept).toEqual([])

    const all = (await g.branchLocal()).all
    expect(all).not.toContain(merged)
    expect(all).not.toContain(oldFormat)
  })

  it('is a best-effort no-op on a directory that is not a git repo', async () => {
    const notRepo = mkTmp('rc-notrepo-')
    await expect(cleanupTempBranches(notRepo)).resolves.toEqual({ deleted: [], kept: [] })
  })
})

/**
 * Ticket 4 / findings F23 — the review SUMMARY's commit count must come from git,
 * not from ticket rows (which are empty on any branch a human committed to), and
 * "cannot tell" must never arrive as the number 0.
 */
describe('reviewCommitCount', () => {
  let ctx: AppCtx
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('rc-count-')
    await initRepo(repo)
    project = seedProject(ctx, repo)
  })

  /** Commit `name.txt` on `branch`, leaving the checkout back on main. */
  async function commitOn(branch: string, name: string): Promise<void> {
    const g = simpleGit(project.repoPath)
    await g.checkout(branch)
    writeFileSync(join(project.repoPath, `${name}.txt`), `${name}\n`)
    await g.add([`${name}.txt`])
    await g.commit(`feat: ${name}`)
    await g.checkout('main')
  }

  it('counts a branch that is one commit ahead as 1, never 0', async () => {
    await createFeatureBranch(project, 'ahead')
    await commitOn('feature/ahead', 'one')

    const feature = seedFeature(ctx, project.id, { slug: 'ahead' })
    expect(await reviewCommitCount(project, feature)).toEqual({ base: 'main', count: 1 })
  })

  it('counts every commit on the branch', async () => {
    await createFeatureBranch(project, 'three')
    for (const n of ['a', 'b', 'c']) await commitOn('feature/three', n)

    const feature = seedFeature(ctx, project.id, { slug: 'three' })
    expect((await reviewCommitCount(project, feature)).count).toBe(3)
  })

  it('is merge-base relative — commits that land on the base afterwards do not count', async () => {
    await createFeatureBranch(project, 'forked')
    await commitOn('feature/forked', 'mine')
    // main moves on underneath the feature — that is the base's work, not ours.
    await commitOn('main', 'theirs')

    const feature = seedFeature(ctx, project.id, { slug: 'forked' })
    expect((await reviewCommitCount(project, feature)).count).toBe(1)
  })

  it('counts against the feature base branch, not main — the branch merge will target', async () => {
    const g = simpleGit(project.repoPath)
    await g.raw(['branch', 'develop'])
    await createFeatureBranch(project, 'on-dev', 'develop')
    await commitOn('develop', 'dev-line')
    await commitOn('feature/on-dev', 'mine')

    const feature = seedFeature(ctx, project.id, { slug: 'on-dev', baseBranch: 'develop' })
    // Against main this branch is 2 ahead (develop's commit + its own); against
    // its real base it is 1 — and 1 is what merge will land.
    expect(await reviewCommitCount(project, feature)).toEqual({ base: 'develop', count: 1 })
  })

  it('reports 0 for a branch with nothing on it', async () => {
    await createFeatureBranch(project, 'empty')
    const feature = seedFeature(ctx, project.id, { slug: 'empty' })
    expect((await reviewCommitCount(project, feature)).count).toBe(0)
  })

  it('reports undefined (unknown) — not 0 — when the branch does not exist', async () => {
    const feature = seedFeature(ctx, project.id, { slug: 'never-made' })
    const res = await reviewCommitCount(project, feature)
    expect(res.count).toBeUndefined()
    expect(res.base).toBe('main')
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
    expect(res.target).toBe('main')
    expect(await currentBranch(g)).toBe('main')
    expect(existsSync(join(project.repoPath, 'feature.txt'))).toBe(true)
    // --no-ff → the merge produces a dedicated merge commit (two parents)
    const parents = (await g.raw(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(/\s+/)
    expect(parents.length).toBe(3)
  })

  it('merges back into the feature base branch, not main', async () => {
    const g = simpleGit(project.repoPath)
    // A develop line forked off main; the feature forks off develop.
    await g.raw(['branch', 'develop'])
    await createFeatureBranch(project, 'on-dev', 'develop')
    await g.checkout('feature/on-dev')
    writeFileSync(join(project.repoPath, 'dev-feat.txt'), 'hi\n')
    await g.add(['dev-feat.txt'])
    await g.commit('feat: dev work')
    await g.checkout('main')

    const feature = seedFeature(ctx, project.id, { slug: 'on-dev', baseBranch: 'develop' })
    const res = await mergeFeature(project, feature)

    expect(res.ok).toBe(true)
    expect(res.target).toBe('develop')
    // The merge landed on develop, but the checkout is RESTORED to main (where it
    // was pre-merge) — the shared checkout isn't silently parked on the base.
    expect(await currentBranch(g)).toBe('main')
    // develop now contains the feature commit; main does NOT (never touched main).
    const contains = await g.raw(['branch', '--contains', 'feature/on-dev'])
    expect(contains).toMatch(/\bdevelop\b/)
    expect(contains).not.toMatch(/\bmain\b/)
  })

  it('restores the pre-merge branch even when merging into main', async () => {
    // Checkout sits on a scratch branch at merge time; after merging into main it
    // must come back to that scratch branch, not stay on main.
    await createFeatureBranch(project, 'scratchy')
    const g = simpleGit(project.repoPath)
    await g.checkout('feature/scratchy')
    writeFileSync(join(project.repoPath, 'f.txt'), 'x\n')
    await g.add(['f.txt'])
    await g.commit('feat: work')
    await g.checkout('main')
    await g.checkoutLocalBranch('scratch')

    const feature = seedFeature(ctx, project.id, { slug: 'scratchy' })
    const res = await mergeFeature(project, feature)

    expect(res.ok).toBe(true)
    expect(res.target).toBe('main')
    expect(await currentBranch(g)).toBe('scratch')
    // main still got the merge.
    const contains = await g.raw(['branch', '--contains', 'feature/scratchy'])
    expect(contains).toMatch(/\bmain\b/)
  })

  it('denies merge when the base branch no longer exists', async () => {
    const g = simpleGit(project.repoPath)
    await g.raw(['branch', 'temp-base'])
    await createFeatureBranch(project, 'orphan', 'temp-base')
    await g.branch(['-D', 'temp-base'])

    const feature = seedFeature(ctx, project.id, { slug: 'orphan', baseBranch: 'temp-base' })
    await expect(mergeFeature(project, feature)).rejects.toThrow(/"temp-base" no longer exists/)
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
    // the conflicting files are reported (captured before the abort) so the
    // review UI can list them and brief the resolve-with-agent session
    expect(res.files).toEqual(['README.md'])
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

  it('activeTestDriveFeatureId reports the driven feature and clears on stop', async () => {
    await createFeatureBranch(project, 'whichfeat')
    const feature = seedFeature(ctx, project.id, { slug: 'whichfeat' })

    expect(activeTestDriveFeatureId()).toBeUndefined()
    await testDrive(ctx, project, feature, 'start')
    expect(activeTestDriveFeatureId()).toBe(feature.id)
    await testDrive(ctx, project, feature, 'stop')
    expect(activeTestDriveFeatureId()).toBeUndefined()
  })

  it('ship flow: stopping the active drive first lets the merge proceed', async () => {
    await createFeatureBranch(project, 'shipflow')
    const g = simpleGit(project.repoPath)
    await g.checkout('feature/shipflow')
    writeFileSync(join(project.repoPath, 'feature.txt'), 'hi\n')
    await g.add(['feature.txt'])
    await g.commit('feat: work')
    await g.checkout('main')

    const feature = seedFeature(ctx, project.id, { slug: 'shipflow' })
    await testDrive(ctx, project, feature, 'start')
    // the merge handler stops this feature's active drive before merging:
    expect(activeTestDriveFeatureId()).toBe(feature.id)
    await testDrive(ctx, project, feature, 'stop')

    const res = await mergeFeature(project, feature)
    expect(res.ok).toBe(true)
    expect(await currentBranch(g)).toBe('main')
    expect(existsSync(join(project.repoPath, 'feature.txt'))).toBe(true)
  })
})

describe('burn worktree cleanup (sandcastle teardown flake)', () => {
  let repo: string
  let g: SimpleGit

  const branch = 'runcastle/ticket/make-act-1-more/6-gX46ogOP'
  /** No retries/sleeps in tests — the retry pacing exists for real file locks. */
  const fast = { attempts: 1, delayMs: 0 }

  async function addBurnWorktree(): Promise<string> {
    const path = burnWorktreePath(repo, branch)
    mkdirSync(join(repo, '.sandcastle', 'worktrees'), { recursive: true })
    await g.raw(['worktree', 'add', '-b', branch, path, 'main'])
    return path
  }

  async function registeredPaths(): Promise<string[]> {
    return (await g.raw(['worktree', 'list', '--porcelain']))
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length).trim())
  }

  beforeEach(async () => {
    repo = mkTmp('rc-burnwt-')
    g = await initRepo(repo)
  })

  it('maps a branch to sandcastle`s worktree dir name (slashes → dashes)', () => {
    expect(burnWorktreePath(repo, branch)).toBe(
      join(repo, '.sandcastle', 'worktrees', 'runcastle-ticket-make-act-1-more-6-gX46ogOP'),
    )
  })

  it('removes the worktree and deregisters it', async () => {
    const path = await addBurnWorktree()
    expect(existsSync(path)).toBe(true)

    expect(await cleanupBurnWorktree(repo, branch, fast)).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(await registeredPaths()).toHaveLength(1) // the main checkout only
  })

  it('removes one left dirty + holding untracked files (--force)', async () => {
    const path = await addBurnWorktree()
    writeFileSync(join(path, 'README.md'), 'edited\n')
    mkdirSync(join(path, 'node_modules'), { recursive: true })
    writeFileSync(join(path, 'node_modules', 'junk.js'), 'x\n')

    expect(await cleanupBurnWorktree(repo, branch, fast)).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('prunes the registry entry a half-failed removal left behind', async () => {
    // The real leftover state: git deleted enough to be useless but kept the
    // `.git/worktrees/<name>` entry, since it only drops that once the work-tree
    // delete succeeded. Stand in for it by deleting the dir out from under git.
    const path = await addBurnWorktree()
    rmSync(path, { recursive: true, force: true })
    expect((await registeredPaths()).length).toBe(2)

    expect(await cleanupBurnWorktree(repo, branch, fast)).toBe(true)
    expect(await registeredPaths()).toHaveLength(1)
  })

  it('never throws when there is nothing to clean (or no repo at all)', async () => {
    expect(await cleanupBurnWorktree(repo, branch, fast)).toBe(true)
    expect(await cleanupBurnWorktree(mkTmp('rc-norepo-'), branch, fast)).toBe(true)
  })
})
