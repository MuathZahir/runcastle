import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import type { WaypointInput } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { handlePtyExit, workWaypoint } from '../src/launcher/launcher'
import { reconcileStaleSessions } from '../src/launcher/reconcile'
import {
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
import {
  claim,
  frontier,
  getWaypoint,
  promoteLastSession,
  release,
  resolve,
  storeWaypoints,
} from '../src/services/waypoints'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * E2E-findings coverage (session lifecycle):
 *  - boot reconciliation: stale launching/live sessions → ended, claims released,
 *    one `session.reconciled` event each;
 *  - the one-live-session guard reads session ROWS: a run-claim never blocks, a
 *    live HITL session always does (including after `resolve_waypoint`), and an
 *    active run refuses with an honest message;
 *  - a resume attempt that dies before going live preserves `lastSessionId` and
 *    emits `session.resume_failed`.
 */

function wp(title: string, blockedBy: (number | string)[] = []): WaypointInput {
  return { title, type: 'grilling', question: `q: ${title}`, blockedBy }
}

async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  await g.raw(['commit', '--allow-empty', '-m', 'initial commit'])
}

function seedRunningRun(ctx: AppCtx, featureId: string, workflow = 'research'): string {
  const id = newId('run')
  ctx.db
    .insert(runs)
    .values({ id, featureId, workflow, status: 'running', startedAt: Date.now(), endedAt: null, summary: null })
    .run()
  return id
}

describe('boot reconciliation — stale sessions', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    featureId = seedFeature(ctx, project.id, { mapped: true }).id
  })

  it('marks launching AND live sessions ended, releases their claims, one event each', () => {
    const launching = createSessionRow(ctx, { featureId, kind: 'waypoint', worktreePath: 'C:\\wt' })
    const live = createSessionRow(ctx, { featureId, kind: 'waypoint', worktreePath: 'C:\\wt' })
    markSessionLive(ctx, live.id, { ccSessionId: 'cc-live' })
    const [a, b] = storeWaypoints(ctx, featureId, [wp('a'), wp('b')])
    claim(ctx, a.id, live.id)
    promoteLastSession(ctx, live.id)
    claim(ctx, b.id, launching.id)

    const reconciled = reconcileStaleSessions(ctx)
    expect(reconciled.map((s) => s.id).sort()).toEqual([launching.id, live.id].sort())

    // both rows are ended, no active session remains
    expect(getSessionRow(ctx, launching.id)?.status).toBe('ended')
    expect(getSessionRow(ctx, live.id)?.status).toBe('ended')
    expect(activeSessionsForFeature(ctx, featureId)).toEqual([])

    // claims are released back to the frontier; the live session stays resumable
    expect(getWaypoint(ctx, a.id).status).toBe('open')
    expect(getWaypoint(ctx, a.id).lastSessionId).toBe(live.id)
    expect(getWaypoint(ctx, b.id).status).toBe('open')
    expect(frontier(ctx, featureId).map((w) => w.id).sort()).toEqual([a.id, b.id].sort())

    // exactly one session.reconciled event per reconciled session
    const events = listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.reconciled')
    expect(events).toHaveLength(2)
    const ids = events.map((e) => (e.data as { sessionId?: string }).sessionId).sort()
    expect(ids).toEqual([launching.id, live.id].sort())
  })

  it('leaves already-ended sessions alone (no event, no double work)', () => {
    const ended = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'C:\\wt' })
    markSessionEnded(ctx, ended.id)

    expect(reconcileStaleSessions(ctx)).toEqual([])
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.reconciled')).toHaveLength(0)
  })

  it('is idempotent — a second boot reconciles nothing', () => {
    createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'C:\\wt' })
    expect(reconcileStaleSessions(ctx)).toHaveLength(1)
    expect(reconcileStaleSessions(ctx)).toEqual([])
  })
})

describe('one-live-session guard — sessions and runs, never claims', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-guard-'))
    cleanup.push(repoPath)
    await initRepo(repoPath)
    projectId = seedProject(ctx, repoPath).id
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

  it('a run-claim does NOT block HITL work by itself (serial HITL, parallel AFK)', async () => {
    const feature = await mappedFeature('afk')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    // a research run claimed waypoint a… and the run row has since finished
    // (only the claim lingers, e.g. released later by the finalizer)
    claim(ctx, a.id, 'run_ghost')

    // …working waypoint b in a terminal is allowed: no live session, no live run
    const res = await workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false })
    expect('sessionId' in res && res.sessionId).toBeTruthy()
    if ('sessionId' in res) cleanup.push(sessionDir(res.sessionId))
  })

  it('an ACTIVE branch-claiming run refuses HITL spawn with an honest message', async () => {
    const feature = await mappedFeature('busy')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    seedRunningRun(ctx, feature.id, 'ticket-burner')

    const err: unknown = await workWaypoint(
      ctx,
      { featureId: feature.id, waypointId: a.id },
      { spawn: false },
    ).then(
      () => {
        throw new Error('expected workWaypoint to be refused')
      },
      (e: unknown) => e,
    )
    const message = err instanceof Error ? err.message : String(err)
    expect(message).toMatch(/ticket-burner run is in progress/)
    expect(message).toMatch(/terminals are available when it finishes/)
    // and it never lies about a "waypoint session" being live
    expect(message).not.toMatch(/already live/)
  })

  it('an ACTIVE research run does NOT block HITL spawn (parallel AFK, ADR-0001 §7)', async () => {
    const feature = await mappedFeature('parallel')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    claim(ctx, a.id, 'run_live')
    seedRunningRun(ctx, feature.id, 'research')

    const res = await workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false })
    expect('sessionId' in res && res.sessionId).toBeTruthy()
    if ('sessionId' in res) cleanup.push(sessionDir(res.sessionId))
  })

  it('resolving a waypoint while its terminal is still open cannot sneak in a second session', async () => {
    const feature = await mappedFeature('sneaky')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    const first = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    if (!('sessionId' in first)) throw new Error('expected a session')
    cleanup.push(sessionDir(first.sessionId))
    markSessionLive(ctx, first.sessionId, { ccSessionId: 'cc-a' })

    // the agent resolves its waypoint — the CLAIM is gone, but the terminal is live
    resolve(ctx, a.id, 'resolved', 'answered')

    // the old claim-based guard passed here; the session-based guard must refuse
    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false }),
    ).rejects.toThrow(/already live/i)
    expect(activeSessionsForFeature(ctx, feature.id)).toHaveLength(1)

    // once the terminal actually ends, work resumes normally
    markSessionEnded(ctx, first.sessionId)
    const second = await workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false })
    if ('sessionId' in second) cleanup.push(sessionDir(second.sessionId))
    expect('sessionId' in second).toBe(true)
  })
})

describe('failed resume — lastSessionId preservation + events', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-resume-'))
    cleanup.push(repoPath)
    await initRepo(repoPath)
    projectId = seedProject(ctx, repoPath).id
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

  it('a resume attempt that dies before live preserves the previous good id and emits session.resume_failed', async () => {
    const feature = await mappedFeature('preserve')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])

    // session 1: went live with a cc id, then closed without resolving
    const first = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    if (!('sessionId' in first)) throw new Error('expected a session')
    cleanup.push(sessionDir(first.sessionId))
    markSessionLive(ctx, first.sessionId, { ccSessionId: 'cc-good' })
    handlePtyExit(ctx, getFeatureRow(ctx, feature.id), getSessionRow(ctx, first.sessionId)!, {}, 0)
    expect(getWaypoint(ctx, a.id).lastSessionId).toBe(first.sessionId)

    // session 2: a resume attempt that dies BEFORE the session-start hook
    const second = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    if (!('sessionId' in second)) throw new Error('expected a session')
    cleanup.push(sessionDir(second.sessionId))
    const secondRow = getSessionRow(ctx, second.sessionId)!
    expect(secondRow.status).toBe('launching')
    handlePtyExit(
      ctx,
      getFeatureRow(ctx, feature.id),
      secondRow,
      { waypoint: getWaypoint(ctx, a.id), resumeSessionId: 'cc-good' },
      1,
    )

    // the dead resume did NOT clobber the resume pointer
    const back = getWaypoint(ctx, a.id)
    expect(back.status).toBe('open')
    expect(back.lastSessionId).toBe(first.sessionId)

    // a third Work still targets the good conversation
    const third = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    if (!('sessionId' in third)) throw new Error('expected a session')
    cleanup.push(sessionDir(third.sessionId))
    const launched = listAfter(ctx, feature.id, 0).find(
      (e) => e.type === 'session.launched' && String(e.data?.sessionId) === third.sessionId,
    )
    expect(String(launched?.data?.command)).toContain('--resume cc-good')

    // and the failure was announced distinctly (the UI toasts on exactly this)
    const failed = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.resume_failed')
    expect(failed).toBeTruthy()
    expect(failed?.message).toContain('waypoint 1')
    expect((failed?.data as { resumeSessionId?: string }).resumeSessionId).toBe('cc-good')
  })

  it('a normal (non-resume) pty exit emits no session.resume_failed', async () => {
    const feature = await mappedFeature('normal')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])
    const res = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    if (!('sessionId' in res)) throw new Error('expected a session')
    cleanup.push(sessionDir(res.sessionId))
    handlePtyExit(ctx, getFeatureRow(ctx, feature.id), getSessionRow(ctx, res.sessionId)!, {}, 1)

    expect(listAfter(ctx, feature.id, 0).some((e) => e.type === 'session.resume_failed')).toBe(false)
  })

  it('spawns fresh WITHOUT --resume and says so when the remembered session has no cc id', async () => {
    const feature = await mappedFeature('nocc')
    const [a] = storeWaypoints(ctx, feature.id, [wp('a')])

    // a previous session is remembered, but it never reported a cc session id
    const ghost = createSessionRow(ctx, { featureId: feature.id, kind: 'waypoint', worktreePath: 'C:\\wt' })
    markSessionEnded(ctx, ghost.id)
    claim(ctx, a.id, ghost.id)
    promoteLastSession(ctx, ghost.id)
    release(ctx, a.id)
    expect(getWaypoint(ctx, a.id).lastSessionId).toBe(ghost.id)

    const res = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    if (!('sessionId' in res)) throw new Error('expected a session')
    cleanup.push(sessionDir(res.sessionId))

    const launched = listAfter(ctx, feature.id, 0).find(
      (e) => e.type === 'session.launched' && String(e.data?.sessionId) === res.sessionId,
    )
    expect(String(launched?.data?.command)).not.toContain('--resume')
    const note = listAfter(ctx, feature.id, 0).find((e) => e.type === 'session.resume_unavailable')
    expect(note).toBeTruthy()
    expect((note?.data as { sessionId?: string }).sessionId).toBe(res.sessionId)
  })
})
