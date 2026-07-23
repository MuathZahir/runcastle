import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { sessions } from '../src/db/schema'
import { newId } from '@runcastle/core'
import { listAfter } from '../src/services/events'
import { archiveFeature, unarchiveFeature } from '../src/services/features'
import { getSessionRow } from '../src/launcher/sessions'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/** A live session row for `featureId`, inserted directly (no PTY spawned). */
function seedLiveSession(ctx: AppCtx, featureId: string): string {
  const id = newId('sess')
  ctx.db
    .insert(sessions)
    .values({
      id,
      featureId,
      kind: 'ideation',
      ccSessionId: null,
      transcriptPath: null,
      status: 'live',
      worktreePath: '/tmp/wt',
    })
    .run()
  return id
}

describe('feature archive / unarchive', () => {
  let ctx: AppCtx
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
  })

  it('archives from any phase, sets status=archived, and emits feature.archived', () => {
    const f = seedFeature(ctx, projectId, { phase: 'tickets', status: 'active' })

    const archived = archiveFeature(ctx, f.id)

    expect(archived.status).toBe('archived')
    const events = listAfter(ctx, f.id, 0)
    expect(events.some((e) => e.type === 'feature.archived')).toBe(true)
  })

  it('ends a live session before archiving', () => {
    const f = seedFeature(ctx, projectId, { phase: 'implementation', status: 'active' })
    const sessionId = seedLiveSession(ctx, f.id)

    archiveFeature(ctx, f.id)

    expect(getSessionRow(ctx, sessionId)?.status).toBe('ended')
    const events = listAfter(ctx, f.id, 0)
    expect(events.some((e) => e.type === 'session.ended')).toBe(true)
  })

  it('archives a shipped feature (any status except archived)', () => {
    const f = seedFeature(ctx, projectId, { phase: 'shipped', status: 'shipped' })
    expect(archiveFeature(ctx, f.id).status).toBe('archived')
  })

  it('refuses to archive an already-archived feature', () => {
    const f = seedFeature(ctx, projectId, { status: 'archived' })
    expect(() => archiveFeature(ctx, f.id)).toThrow(/already archived/)
  })

  it('unarchives a non-shipped feature back to active', () => {
    const f = seedFeature(ctx, projectId, { phase: 'tickets', status: 'archived' })

    const restored = unarchiveFeature(ctx, f.id)

    expect(restored.status).toBe('active')
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'feature.unarchived')).toBe(true)
  })

  it('unarchives a shipped-phase feature back to shipped', () => {
    const f = seedFeature(ctx, projectId, { phase: 'shipped', status: 'archived' })
    expect(unarchiveFeature(ctx, f.id).status).toBe('shipped')
  })

  it('refuses to unarchive a feature that is not archived', () => {
    const f = seedFeature(ctx, projectId, { status: 'active' })
    expect(() => unarchiveFeature(ctx, f.id)).toThrow(/not archived/)
  })
})
