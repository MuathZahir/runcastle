import { describe, expect, it } from 'vitest'
import { sessions } from '../src/db/schema'
import { getFeatureFull } from '../src/services/features'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('shipped Q&A listing', () => {
  it('keeps an ended session with no captured transcript as a missing-transcript row', async () => {
    const ctx = await makeTestCtx()
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { phase: 'shipped', status: 'shipped' })
    ctx.db.insert(sessions).values({
      id: 'session_qa', featureId: feature.id, kind: 'qa', status: 'ended', awaitingInput: false,
      worktreePath: '/tmp/worktree', createdAt: 100,
    }).run()

    expect(getFeatureFull(ctx, feature.id).sessions).toContainEqual(expect.objectContaining({
      id: 'session_qa', title: null, transcriptMissing: true,
    }))
  })
})
