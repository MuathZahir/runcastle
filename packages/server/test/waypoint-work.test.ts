import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import type { WaypointInput } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { launchSession, workWaypoint } from '../src/launcher/launcher'
import { getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { createFeatureBranch, ensureTalkWorktree } from '../src/services/git'
import { listAfter } from '../src/services/events'
import {
  claim,
  frontier,
  getWaypoint,
  promoteLastSession,
  releaseForSession,
  resolve,
  storeWaypoints,
} from '../src/services/waypoints'
import { research } from '../src/workflows/research'
import { workflowRegistry } from '../src/workflows/registry'
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

    // the waypoint is now claimed by the new session, off the frontier.
    // lastSessionId is NOT set yet — it is promoted when the session goes live,
    // so a spawn that dies on arrival never clobbers a previous resumable id.
    const claimed = getWaypoint(ctx, a.id)
    expect(claimed.status).toBe('claimed')
    expect(claimed.claimedBy).toBe(sessionId)
    expect(claimed.lastSessionId).toBeUndefined()
    expect(frontier(ctx, feature.id)).toHaveLength(0)

    // going live (session-start hook) promotes the resume pointer
    markSessionLive(ctx, sessionId, { ccSessionId: 'cc-1' })
    expect(getWaypoint(ctx, a.id).lastSessionId).toBe(sessionId)

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

  // A research waypoint is worked headlessly by a run, not a HITL session — the
  // routing + run behaviour is covered in research.test.ts.

  it('resumes the remembered cc session when re-working a released waypoint', async () => {
    const feature = await mappedFeature('resume')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])

    // first work → the session goes live with a cc id, then closes without resolving
    const first = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    cleanup.push(sessionDir(first.sessionId))
    markSessionLive(ctx, first.sessionId, { ccSessionId: 'cc-remembered' })
    // simulate terminal close (what the pty onExit / session-end hook does)
    markSessionEnded(ctx, first.sessionId)
    releaseForSession(ctx, first.sessionId)

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

/**
 * Ticket 2 — the implicit handoff (decision #8): Work on a frontier waypoint
 * ends the live session itself when it can prove that session is finished, and
 * abandons one that is still mid-work only behind the explicit `endLive` flag.
 */
describe('workWaypoint — implicit handoff', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-handoff-'))
    cleanup.push(repoPath)
    await initRepo(repoPath)
    const project = seedProject(ctx, repoPath)
    projectId = project.id
  })

  afterEach(() => {
    workflowRegistry.set('research', research)
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  async function mappedFeature(slug: string) {
    const feature = seedFeature(ctx, projectId, { slug, mapped: true })
    await createFeatureBranch({ id: projectId, name: 't', repoPath, mainBranch: 'main' }, slug)
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /** Work `waypointId`, registering the session dir for cleanup. */
  async function work(featureId: string, waypointId: string, endLive?: boolean) {
    const result = await workWaypoint(ctx, { featureId, waypointId, endLive }, { spawn: false })
    const { sessionId } = result as { sessionId: string }
    cleanup.push(sessionDir(sessionId))
    return sessionId
  }

  /** A live waypoint session on `waypointId` (live promotes `lastSessionId`). */
  async function liveSessionOn(featureId: string, waypointId: string) {
    const sessionId = await work(featureId, waypointId)
    markSessionLive(ctx, sessionId, { ccSessionId: `cc-${sessionId}` })
    return sessionId
  }

  const autoEnded = (featureId: string) =>
    listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.auto_ended')

  it('ends a resolved waypoint session and spawns the next one in a single call', async () => {
    const feature = await mappedFeature('finished')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])

    const first = await liveSessionOn(feature.id, a.id)
    resolve(ctx, a.id, 'resolved', 'answered')

    const second = await work(feature.id, b.id)

    expect(second).not.toBe(first)
    expect(getSessionRow(ctx, first)?.status).toBe('ended')
    expect(getWaypoint(ctx, b.id).claimedBy).toBe(second)
  })

  it('ends a dropped waypoint session too', async () => {
    const feature = await mappedFeature('dropped')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])

    const first = await liveSessionOn(feature.id, a.id)
    resolve(ctx, a.id, 'dropped', 'not worth it')

    await work(feature.id, b.id)
    expect(getSessionRow(ctx, first)?.status).toBe('ended')
  })

  it('still refuses while the live session is mid-work, leaving it untouched', async () => {
    const feature = await mappedFeature('midwork')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])

    const first = await liveSessionOn(feature.id, a.id)

    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false }),
    ).rejects.toThrow(GateError)

    expect(getSessionRow(ctx, first)?.status).toBe('live')
    expect(getWaypoint(ctx, a.id).status).toBe('claimed')
    expect(getWaypoint(ctx, b.id).status).toBe('open')
    expect(autoEnded(feature.id)).toHaveLength(0)
  })

  it('abandons a mid-work session with endLive, releasing its waypoint to the frontier', async () => {
    const feature = await mappedFeature('abandon')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])

    const first = await liveSessionOn(feature.id, a.id)
    const second = await work(feature.id, b.id, true)

    expect(getSessionRow(ctx, first)?.status).toBe('ended')
    // the abandoned waypoint is back on the frontier, remembering its session
    const abandoned = getWaypoint(ctx, a.id)
    expect(abandoned.status).toBe('open')
    expect(abandoned.lastSessionId).toBe(first)
    expect(frontier(ctx, feature.id).map((w) => w.id)).toContain(a.id)
    expect(getWaypoint(ctx, b.id).claimedBy).toBe(second)
  })

  it('ends the live grill session once the feature is mapped (the first handoff)', async () => {
    const feature = await mappedFeature('grill')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    const grill = await launchSession(ctx, { featureId: feature.id, kind: 'ideation' }, { spawn: false })
    cleanup.push(sessionDir(grill.sessionId))
    markSessionLive(ctx, grill.sessionId, { ccSessionId: 'cc-grill' })

    const worked = await work(feature.id, a.id)

    expect(getSessionRow(ctx, grill.sessionId)?.status).toBe('ended')
    expect(getWaypoint(ctx, a.id).claimedBy).toBe(worked)
  })

  /**
   * REPORT 1.4 — `sessionFinished` answered `feature.mapped` for every
   * non-waypoint kind, and the sweep only runs on a mapped feature, so it was
   * constant true: a live qa conversation was killed mid-sentence and the
   * timeline recorded it as "finished".
   */
  it('refuses to sweep a live qa conversation, which nothing can prove is over', async () => {
    const feature = await mappedFeature('qa-live')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    const qa = await launchSession(ctx, { featureId: feature.id, kind: 'qa' }, { spawn: false })
    cleanup.push(sessionDir(qa.sessionId))
    markSessionLive(ctx, qa.sessionId, { ccSessionId: 'cc-qa' })

    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false }),
    ).rejects.toThrow(GateError)

    expect(getSessionRow(ctx, qa.sessionId)?.status).toBe('live')
    expect(autoEnded(feature.id)).toHaveLength(0)
  })

  it('abandons the qa conversation once the human confirms with endLive', async () => {
    const feature = await mappedFeature('qa-abandon')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    const qa = await launchSession(ctx, { featureId: feature.id, kind: 'qa' }, { spawn: false })
    cleanup.push(sessionDir(qa.sessionId))
    markSessionLive(ctx, qa.sessionId, { ccSessionId: 'cc-qa' })

    await work(feature.id, a.id, true)

    expect(getSessionRow(ctx, qa.sessionId)?.status).toBe('ended')
    expect(autoEnded(feature.id).map((e) => e.data?.reason)).toEqual(['abandoned'])
  })

  it('ends the swept session through endSession — session.ended is emitted', async () => {
    const feature = await mappedFeature('events')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])

    const first = await liveSessionOn(feature.id, a.id)
    resolve(ctx, a.id, 'resolved', 'answered')
    await work(feature.id, b.id)

    const ended = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'session.ended')
    expect(ended.map((e) => e.data?.sessionId)).toEqual([first])
  })

  it('records why the sweep ended a session — finished vs abandoned', async () => {
    const feature = await mappedFeature('why')
    const [a, b, c] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b'), wp('c')])

    const finished = await liveSessionOn(feature.id, a.id)
    resolve(ctx, a.id, 'resolved', 'answered')
    await liveSessionOn(feature.id, b.id)
    expect(autoEnded(feature.id).map((e) => e.data)).toEqual([
      { sessionId: finished, kind: 'waypoint', reason: 'finished' },
    ])

    // b is still mid-work — only the confirmed abandon ends it
    const abandoned = await work(feature.id, c.id, true)
    expect(abandoned).toBeTruthy()
    expect(autoEnded(feature.id).map((e) => e.data?.reason)).toEqual(['finished', 'abandoned'])
  })

  it('leaves a research waypoint AFK — no sweep, and a live session does not block it', async () => {
    const feature = await mappedFeature('research')
    workflowRegistry.set('research', { id: 'research', run: async () => {} })
    const [a, r] = storeWaypoints(ctx, feature.id, [
      wp('a'),
      wp('dig', [], { type: 'research' }),
    ])

    const live = await liveSessionOn(feature.id, a.id)
    const result = await workWaypoint(ctx, { featureId: feature.id, waypointId: r.id }, { spawn: false })

    expect(result).toHaveProperty('runId')
    // the HITL session is untouched: research is a run, not a session
    expect(getSessionRow(ctx, live)?.status).toBe('live')
    expect(getWaypoint(ctx, a.id).status).toBe('claimed')
    expect(autoEnded(feature.id)).toHaveLength(0)
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
    promoteLastSession(ctx, 'sess_1') // the session reached live before ending
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
