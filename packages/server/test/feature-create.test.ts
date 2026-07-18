import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { createFeature } from '../src/services/features'
import { makeTestCtx } from './helpers/db'
import { seedProject, tmpRepo } from './helpers/fixtures'

describe('feature.create', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string

  beforeEach(async () => {
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

  it('slugifies the title and dedupes against existing slugs', async () => {
    const a = await createFeature(ctx, { projectId, title: 'My Feature!', oneLiner: 'x', size: 'full' })
    const b = await createFeature(ctx, { projectId, title: 'My Feature', oneLiner: 'x', size: 'full' })
    const c = await createFeature(ctx, { projectId, title: 'my   feature', oneLiner: 'x', size: 'collapsed' })

    expect(a.slug).toBe('my-feature')
    expect(b.slug).toBe('my-feature-2')
    expect(c.slug).toBe('my-feature-3')
    expect(a.branch).toBe('feature/my-feature')
    expect(a.phase).toBe('ideation')
    expect(a.status).toBe('active')
  })

  it('creates the row + real feature branch + scaffolds brief.md', async () => {
    const f = await createFeature(ctx, { projectId, title: 'Brancher', oneLiner: 'y', size: 'full' })

    // B2's git service creates the real branch → message reports it (not pending)
    const created = listAfter(ctx, f.id, 0).find((e) => e.type === 'feature.created')
    expect(created?.message).toContain('feature/brancher')
    expect(created?.message).not.toContain('branch pending')
    const branches = await simpleGit(repoPath).branchLocal()
    expect(branches.all).toContain('feature/brancher')

    // brief.md scaffolded into the target repo docs dir
    expect(existsSync(join(repoPath, 'docs', 'features', 'brancher', 'brief.md'))).toBe(true)
  })

  it('commits the scaffolded brief so the working tree stays clean (ship gates)', async () => {
    await createFeature(ctx, { projectId, title: 'Cleanly', oneLiner: 'z', size: 'full' })
    const g = simpleGit(repoPath)

    // The brief must be committed, not left untracked — an untracked doc would
    // dirty the checkout and block test-drive / merge.
    expect((await g.raw(['status', '--porcelain'])).trim()).toBe('')
    const tracked = (await g.raw(['ls-files', 'docs/features/cleanly/brief.md'])).trim()
    expect(tracked).toBe('docs/features/cleanly/brief.md')
  })
})
