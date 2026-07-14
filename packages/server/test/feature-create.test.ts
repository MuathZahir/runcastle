import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { createFeature } from '../src/services/features'
import { makeTestCtx } from './helpers/db'
import { seedProject, tmpRepo } from './helpers/fixtures'

describe('feature.create', () => {
  let ctx: AppCtx
  let repoPath: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    seedProject(ctx, repoPath)
  })

  it('slugifies the title and dedupes against existing slugs', async () => {
    const a = await createFeature(ctx, { title: 'My Feature!', oneLiner: 'x', size: 'full' })
    const b = await createFeature(ctx, { title: 'My Feature', oneLiner: 'x', size: 'full' })
    const c = await createFeature(ctx, { title: 'my   feature', oneLiner: 'x', size: 'collapsed' })

    expect(a.slug).toBe('my-feature')
    expect(b.slug).toBe('my-feature-2')
    expect(c.slug).toBe('my-feature-3')
    expect(a.branch).toBe('feature/my-feature')
    expect(a.phase).toBe('ideation')
    expect(a.status).toBe('active')
  })

  it('creates the row + scaffolds brief.md while the B2 branch stub is pending', async () => {
    const f = await createFeature(ctx, { title: 'Brancher', oneLiner: 'y', size: 'full' })

    // git.createFeatureBranch is a NotImplemented stub → branch pending
    const created = listAfter(ctx, f.id, 0).find((e) => e.type === 'feature.created')
    expect(created?.message).toContain('branch pending')

    // brief.md scaffolded into the target repo docs dir
    expect(existsSync(join(repoPath, 'docs', 'features', 'brancher', 'brief.md'))).toBe(true)
  })
})
