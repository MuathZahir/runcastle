import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { createFeature } from '../src/services/features'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedProject, tmpRepo } from './helpers/fixtures'

describe('feature.create', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let home: string
  let restoreDataDir: () => void

  beforeEach(async () => {
    // Creation now cuts the feature's talk worktree (that is where the scaffolded
    // docs are written and committed), so the data dir has to be a temp tree.
    home = tmpRepo()
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    // A project always points at a real git repo (validated by project.init);
    // now that B2's git service is live, createFeature creates a real branch,
    // so the fixture must be an actual repo with a seed commit on main.
    repoPath = tmpRepo()
    const g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repoPath, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => {
    restoreDataDir()
    rmTemp(home)
  })

  it('slugifies the title and dedupes against existing slugs', async () => {
    const a = await createFeature(ctx, { projectId, title: 'My Feature!', oneLiner: 'x' })
    const b = await createFeature(ctx, { projectId, title: 'My Feature', oneLiner: 'x' })
    const c = await createFeature(ctx, { projectId, title: 'my   feature', oneLiner: 'x' })

    expect(a.slug).toBe('my-feature')
    expect(b.slug).toBe('my-feature-2')
    expect(c.slug).toBe('my-feature-3')
    expect(a.branch).toBe('feature/my-feature')
    expect(a.phase).toBe('ideation')
    expect(a.status).toBe('active')
    expect(a.lap).toBe(1) // every feature starts on lap 1 (ADR-0010)
  })

  it('creates the row + real feature branch + scaffolds brief.md', async () => {
    const f = await createFeature(ctx, { projectId, title: 'Brancher', oneLiner: 'y' })

    // B2's git service creates the real branch → message reports it (not pending)
    const created = listAfter(ctx, f.id, 0).find((e) => e.type === 'feature.created')
    expect(created?.message).toContain('feature/brancher')
    expect(created?.message).not.toContain('branch pending')
    const branches = await simpleGit(repoPath).branchLocal()
    expect(branches.all).toContain('feature/brancher')

    // brief.md scaffolded onto the FEATURE branch — never into the human's checkout
    const brief = await simpleGit(repoPath).show([
      'feature/brancher:docs/features/brancher/brief.md',
    ])
    expect(brief).toContain('# Brancher')
    expect(existsSync(join(repoPath, 'docs', 'features', 'brancher', 'brief.md'))).toBe(false)
  })

  it('falls back to the branch the checkout is standing on, not a stored default', async () => {
    // The project's stored main line is `main`; the human is working on develop.
    const g = simpleGit(repoPath)
    await g.checkoutLocalBranch('develop')

    const f = await createFeature(ctx, { projectId, title: 'Defaulted', oneLiner: 'x' })

    expect(f.baseBranch).toBe('develop')
    const created = listAfter(ctx, f.id, 0).find((e) => e.type === 'feature.created')
    expect(created?.message).toContain('← develop')
  })

  it('forks the feature off an explicit baseBranch when given', async () => {
    const g = simpleGit(repoPath)
    await g.raw(['branch', 'develop'])
    await g.checkout('develop')
    writeFileSync(join(repoPath, 'DEV.md'), 'dev\n')
    await g.add(['DEV.md'])
    await g.commit('develop-only commit')
    const developTip = (await g.revparse(['develop'])).trim()
    await g.checkout('main')

    const f = await createFeature(ctx, {
      projectId,
      title: 'Off Develop',
      oneLiner: 'x',
      baseBranch: 'develop',
    })
    expect(f.baseBranch).toBe('develop')
    // The feature branch tip is develop's tip (before its own doc commit).
    const mergeBase = (await g.raw(['merge-base', 'feature/off-develop', 'develop'])).trim()
    expect(mergeBase).toBe(developTip)
  })

  it('materializes a local base for a remote-only pick and stores the local name', async () => {
    const g = simpleGit(repoPath)
    // Give the repo an origin carrying `release` with no local copy.
    const remote = tmpRepo()
    await simpleGit(remote).init(['--bare', '-b', 'main'])
    await g.addRemote('origin', remote)
    await g.push(['-u', 'origin', 'main'])
    await g.checkoutLocalBranch('release')
    writeFileSync(join(repoPath, 'rel.txt'), 'r\n')
    await g.add(['rel.txt'])
    await g.commit('seed release')
    await g.push(['-u', 'origin', 'release'])
    await g.checkout('main')
    await g.branch(['-D', 'release'])
    await g.fetch()

    const f = await createFeature(ctx, {
      projectId,
      title: 'Off Remote',
      oneLiner: 'x',
      baseBranch: 'origin/release',
    })

    // Stored base is the resolved LOCAL branch, a real future merge target.
    expect(f.baseBranch).toBe('release')
    const local = await g.branchLocal()
    expect(local.all).toContain('release')
    expect(local.all).toContain('feature/off-remote')
  })

  it('creates every feature unmapped — mapping is escalation-only', async () => {
    // No `mapped` input exists at creation anymore (ticket 2); the only door into
    // the mapped flow is the MCP escalate_to_map tool mid-grill.
    const f = await createFeature(ctx, { projectId, title: 'Unmapped', oneLiner: 'x' })
    expect(f.mapped).toBe(false)
  })

  it('commits the scaffolded brief onto the feature branch, leaving the checkout alone', async () => {
    // The bug this pins: the scaffold was written into the human's checkout and
    // committed there, so it landed on whatever branch they were standing on (in
    // practice `main`) and the feature branch reached its grill session with no
    // brief.md at all — the grill worktree is cut from the branch.
    const g = simpleGit(repoPath)
    const tipBefore = (await g.revparse(['HEAD'])).trim()
    const body = '# Cleanly\n\nThe reasoning the intake conversation settled.\n'

    await createFeature(ctx, { projectId, title: 'Cleanly', oneLiner: 'z', brief: body })

    // (a) the brief is on the FEATURE branch, verbatim
    expect(await g.show(['feature/cleanly:docs/features/cleanly/brief.md'])).toBe(body)
    // (b) the checkout's own branch gained no commit
    expect((await g.revparse(['HEAD'])).trim()).toBe(tipBefore)
    expect((await g.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('main')
    // (c) and no untracked doc dirties it — a dirty tree is what test-drive and
    // merge both refuse on
    expect((await g.raw(['status', '--porcelain'])).trim()).toBe('')
  })
})
