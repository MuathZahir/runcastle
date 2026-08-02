import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import {
  createSessionRow,
  markAgentWorking,
  markAwaitingInput,
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import { emit } from '../src/services/events'
import { list } from '../src/services/features'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * improve-features-section ticket 2 — the sidebar row's relative activity stamp
 * ("10m") reads `lastActivityAt` off `feature.list`. The list carried only
 * `createdAt`, which answers "when was this made", not "is anything happening".
 */
describe('feature.list lastActivityAt', () => {
  let ctx: AppCtx
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
  })

  it('is the feature’s latest event timestamp', () => {
    const feature = seedFeature(ctx, projectId, { createdAt: 1_000 })
    emit(ctx, feature.id, { type: 'a', message: 'older' })
    const latest = emit(ctx, feature.id, { type: 'b', message: 'newer' })

    const [item] = list(ctx, projectId)
    expect(item.lastActivityAt).toBe(latest.ts)
    expect(item.lastActivityAt).toBeGreaterThan(1_000)
  })

  it('falls back to createdAt for a feature with no events', () => {
    seedFeature(ctx, projectId, { createdAt: 1_700_000_000_000 })

    const [item] = list(ctx, projectId)
    expect(item.lastActivityAt).toBe(1_700_000_000_000)
  })

  it('scopes activity to its own feature', () => {
    const quiet = seedFeature(ctx, projectId, { slug: 'quiet', createdAt: 5_000 })
    const busy = seedFeature(ctx, projectId, { slug: 'busy', createdAt: 5_000 })
    const busyEvent = emit(ctx, busy.id, { type: 'a', message: 'work' })

    const items = list(ctx, projectId)
    const byId = new Map(items.map((f) => [f.id, f.lastActivityAt]))
    expect(byId.get(busy.id)).toBe(busyEvent.ts)
    expect(byId.get(quiet.id)).toBe(5_000)
  })

  it('ignores events belonging to another project', () => {
    const otherProjectId = seedProject(ctx).id
    const mine = seedFeature(ctx, projectId, { slug: 'mine', createdAt: 5_000 })
    const theirs = seedFeature(ctx, otherProjectId, { slug: 'theirs', createdAt: 5_000 })
    emit(ctx, theirs.id, { type: 'a', message: 'not mine' })

    const [item] = list(ctx, projectId)
    expect(item.id).toBe(mine.id)
    expect(item.lastActivityAt).toBe(5_000)
  })
})

/**
 * improve-features-section ticket 4 — the lanes cannot be honest about a
 * feature they cannot see the terminal of. `feature.list` carried `activeRun`
 * (the unattended burner) but nothing at all about HITL sessions, so the rail
 * read every active ideation feature as "Needs you" whether or not someone was
 * mid-conversation with it (decisions §3).
 */
describe('feature.list liveSession', () => {
  let ctx: AppCtx
  let projectId: string
  let featureId: string

  const liveSession = (): ReturnType<typeof list>[number]['liveSession'] =>
    list(ctx, projectId)[0].liveSession

  function openSession(): string {
    return createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: '/wt' }).id
  }

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    featureId = seedFeature(ctx, projectId).id
  })

  it('is null for a feature with no session at all', () => {
    expect(liveSession()).toBeNull()
  })

  it('reports a terminal that is still launching as working, not waiting', () => {
    openSession()
    expect(liveSession()).toEqual({ status: 'launching', awaitingInput: false })
  })

  it('reports a live session, and whether its agent is waiting on the human', () => {
    const sessionId = openSession()
    markSessionLive(ctx, sessionId)
    expect(liveSession()).toEqual({ status: 'live', awaitingInput: false })

    markAwaitingInput(ctx, sessionId)
    expect(liveSession()).toEqual({ status: 'live', awaitingInput: true })

    markAgentWorking(ctx, sessionId)
    expect(liveSession()).toEqual({ status: 'live', awaitingInput: false })
  })

  it('clears entirely when the session ends, whatever the turn was left at', () => {
    const sessionId = openSession()
    markSessionLive(ctx, sessionId)
    markAwaitingInput(ctx, sessionId)

    markSessionEnded(ctx, sessionId)
    expect(liveSession()).toBeNull()
  })

  it('scopes the session to its own feature', () => {
    const other = seedFeature(ctx, projectId, { slug: 'other' })
    createSessionRow(ctx, { featureId: other.id, kind: 'ideation', worktreePath: '/wt' })

    const byId = new Map(list(ctx, projectId).map((f) => [f.id, f.liveSession]))
    expect(byId.get(other.id)).not.toBeNull()
    expect(byId.get(featureId)).toBeNull()
  })

  it('prefers the session that reached live over one still launching', () => {
    const first = openSession()
    markSessionLive(ctx, first)
    markAwaitingInput(ctx, first)
    openSession()

    expect(liveSession()).toEqual({ status: 'live', awaitingInput: true })
  })
})
