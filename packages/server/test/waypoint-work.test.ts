import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import type { WaypointInput } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { workWaypoint } from '../src/launcher/launcher'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { createFeatureBranch, ensureTalkWorktree } from '../src/services/git'
import { listAfter } from '../src/services/events'
import {
  claim,
  frontier,
  getWaypoint,
  releaseForSession,
  resolve,
  storeWaypoints,
} from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Issue #6 — the Work path: `feature.workWaypoint` claims transactionally and
 * opens a waypoint session; a session that ends without resolving auto-releases
 * its waypoint back to the frontier (and remembers the session for Resume).
 */

function wp(
  title: string,
  blockedBy: (number | string)[] = [],
  overrides: Partial<WaypointInput> = {},
): WaypointInput {
  return { title, type: 'grilling', question: `q: ${title}`, blockedBy, ...overrides }
}

/** git init -b main + identity + one seed commit — a real repo for the worktree. */
async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  await g.raw(['commit', '--allow-empty', '-m', 'initial commit'])
}

describe('workWaypoint — claim before spawn', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-work-'))
    cleanup.push(repoPath)
    await initRepo(repoPath)
    const project = seedProject(ctx, repoPath)
    projectId = project.id
  })

  afterEach(() => {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  async function mappedFeature(slug: string) {
    const feature = seedFeature(ctx, projectId, { slug, mapped: true })
    await createFeatureBranch({ id: projectId, name: 't', repoPath, mainBranch: 'main' }, slug)
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  it('claims the waypoint (before spawn) and opens a kind=waypoint session on it', async () => {
    const feature = await mappedFeature('big')
    const [a] = storeWaypoints(ctx, feature.id, [wp('root question')])

    const { sessionId } = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    // the waypoint is now claimed by the new session, off the frontier
    const claimed = getWaypoint(ctx, a.id)
    expect(claimed.status).toBe('claimed')
    expect(claimed.claimedBy).toBe(sessionId)
    expect(claimed.lastSessionId).toBe(sessionId)
    expect(frontier(ctx, feature.id)).toHaveLength(0)

    // the session is a waypoint-kind session on this feature
    const session = getSessionRow(ctx, sessionId)
    expect(session?.kind).toBe('waypoint')
    expect(session?.featureId).toBe(feature.id)
  })

  it('refuses a waypoint that is not on the frontier (blocked)', async () => {
    const feature = await mappedFeature('blocked')
    const [, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b', [1])])
    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false }),
    ).rejects.toThrow(GateError)
    // no session was left behind claiming it
    expect(getWaypoint(ctx, b.id).status).toBe('open')
  })

  it('allows only one live HITL session per feature', async () => {
    const feature = await mappedFeature('serial')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    const { sessionId } = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    // b is on the frontier, but a is already claimed → second Work is refused
    expect(frontier(ctx, feature.id).map((w) => w.id)).toContain(b.id)
    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false }),
    ).rejects.toThrow(/already live/i)
  })

  it('enforces one-live-session under concurrent Work on two different frontier waypoints', async () => {
    const feature = await mappedFeature('concurrent')
    // Pre-create the talk worktree (as an earlier session would have) so both
    // concurrent calls see it as already valid — otherwise they'd race on
    // `git worktree add` instead, masking the waypoint-claim race this guards.
    await ensureTalkWorktree(
      { id: projectId, name: 't', repoPath, mainBranch: 'main' },
      feature,
    )
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])

    const results = await Promise.allSettled([
      workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false }),
      workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false }),
    ])
    for (const r of results) if (r.status === 'fulfilled') cleanup.push(sessionDir(r.value.sessionId))

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason?.message).toMatch(/already live/i)
  })

  it('refuses to work an unmapped feature', async () => {
    const plain = seedFeature(ctx, projectId, { slug: 'plain', mapped: false })
    await expect(
      workWaypoint(ctx, { featureId: plain.id, waypointId: 'wpt_x' }, { spawn: false }),
    ).rejects.toThrow(/not mapped/i)
  })

  it('refuses a research waypoint (worked headlessly, not HITL)', async () => {
    const feature = await mappedFeature('research')
    const [r] = storeWaypoints(ctx, feature.id, [wp('dig', [], { type: 'research' })])
    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: r.id }, { spawn: false }),
    ).rejects.toThrow(/research/i)
  })

  it('resumes the remembered cc session when re-working a released waypoint', async () => {
    const feature = await mappedFeature('resume')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])

    // first work → the session goes live with a cc id, then closes without resolving
    const first = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    cleanup.push(sessionDir(first.sessionId))
    markSessionLive(ctx, first.sessionId, { ccSessionId: 'cc-remembered' })
    releaseForSession(ctx, first.sessionId) // simulate terminal close

    // back on the frontier, remembering the last session
    expect(frontier(ctx, feature.id).map((w) => w.id)).toContain(a.id)
    expect(getWaypoint(ctx, a.id).lastSessionId).toBe(first.sessionId)

    // re-work → a fresh session, but the map still remembers the prior cc id for --resume
    const second = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    cleanup.push(sessionDir(second.sessionId))
    expect(second.sessionId).not.toBe(first.sessionId)
    // the launched command carries --resume cc-remembered
    const launched = listAfter(ctx, feature.id, 0).find(
      (e) => e.type === 'session.launched' && String(e.data?.sessionId) === second.sessionId,
    )
    expect(String(launched?.data?.command)).toContain('--resume cc-remembered')
  })
})

describe('releaseForSession — auto-release', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    featureId = seedFeature(ctx, project.id, { mapped: true }).id
  })

  it('releases a waypoint claimed by an ending session, keeping lastSessionId', () => {
    const [a] = storeWaypoints(ctx, featureId, [wp('a')])
    claim(ctx, a.id, 'sess_1')
    const released = releaseForSession(ctx, 'sess_1')
    expect(released.map((w) => w.id)).toEqual([a.id])

    const back = getWaypoint(ctx, a.id)
    expect(back.status).toBe('open')
    expect(back.claimedBy).toBeUndefined()
    expect(back.lastSessionId).toBe('sess_1')
    expect(frontier(ctx, featureId).map((w) => w.id)).toContain(a.id)
  })

  it('is a no-op when the session holds no claim (already resolved / never claimed)', () => {
    storeWaypoints(ctx, featureId, [wp('a')])
    expect(releaseForSession(ctx, 'sess_none')).toEqual([])
  })

  it('does not revive a waypoint the session already resolved', () => {
    const [a] = storeWaypoints(ctx, featureId, [wp('a')])
    claim(ctx, a.id, 'sess_1')
    // the agent resolved before closing the terminal — status is terminal, claim cleared
    resolve(ctx, a.id, 'resolved', 'answered')

    // auto-release on the ensuing session-end must be a no-op (never un-resolve)
    expect(releaseForSession(ctx, 'sess_1')).toEqual([])
    expect(getWaypoint(ctx, a.id).status).toBe('resolved')
  })
})
