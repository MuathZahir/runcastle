import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import type { SessionKind, WaypointInput } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { handlePtyExit, launchSession, workWaypoint } from '../src/launcher/launcher'
import { reconcileStaleSessions } from '../src/launcher/reconcile'
import type { PtyEntry } from '../src/pty/registry'
import { ptyRegistry } from '../src/pty/registry'
import { KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import {
  KICKOFF_DELAY_MS,
  KICKOFF_SUBMIT_DELAY_MS,
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
  mostRecentResumableSession,
  resumeKickoffLine,
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
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
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

  it('keeps exactly one live session across the resolve → work handoff', async () => {
    const feature = await mappedFeature('sneaky')
    const [a, b] = storeWaypoints(ctx, feature.id, [wp('a'), wp('b')])
    const first = await workWaypoint(ctx, { featureId: feature.id, waypointId: a.id }, { spawn: false })
    if (!('sessionId' in first)) throw new Error('expected a session')
    cleanup.push(sessionDir(first.sessionId))
    markSessionLive(ctx, first.sessionId, { ccSessionId: 'cc-a' })

    // mid-work: the claim is still held, so a second terminal is refused outright
    await expect(
      workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false }),
    ).rejects.toThrow(/already live/i)

    // the agent resolves its waypoint — the CLAIM is gone, but the terminal is live.
    // Working the next waypoint now ends that finished terminal for us (ticket 2),
    // so the guard is satisfied by the handoff rather than by a refusal.
    resolve(ctx, a.id, 'resolved', 'answered')
    const second = await workWaypoint(ctx, { featureId: feature.id, waypointId: b.id }, { spawn: false })
    if ('sessionId' in second) cleanup.push(sessionDir(second.sessionId))
    expect('sessionId' in second).toBe(true)
    expect(activeSessionsForFeature(ctx, feature.id).map((s) => s.id)).toEqual([
      'sessionId' in second ? second.sessionId : '',
    ])
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
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
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

/**
 * Reopening a terminal resumes ITS OWN conversation, at every phase. A session is
 * a real `claude` process in a server-owned PTY, so quitting runcastle kills it
 * and boot reconciliation ends the row — but the transcript survives on disk and
 * the row kept its `ccSessionId`, so the next terminal of that kind `--resume`s
 * it instead of starting cold from the docs.
 */
describe('relaunching a terminal resumes its own conversation', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-relaunch-'))
    cleanup.push(repoPath)
    await initRepo(repoPath)
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  async function feature(slug: string) {
    const f = seedFeature(ctx, projectId, { slug })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return f
  }

  /** Launch a session (no process), tracking its artifact dir for cleanup. */
  async function launch(featureId: string, kind: SessionKind): Promise<string> {
    const { sessionId } = await launchSession(ctx, { featureId, kind }, { spawn: false })
    cleanup.push(sessionDir(sessionId))
    return sessionId
  }

  /** The `claude` argv recorded on this session's `session.launched` event. */
  function commandFor(featureId: string, sessionId: string): string {
    const launched = listAfter(ctx, featureId, 0).find(
      (e) => e.type === 'session.launched' && String(e.data?.sessionId) === sessionId,
    )
    return String(launched?.data?.command ?? '')
  }

  it('the FIRST grill launch starts fresh — no --resume, no session.resumed', async () => {
    const f = await feature('first')
    const id = await launch(f.id, 'ideation')

    expect(commandFor(f.id, id)).not.toContain('--resume')
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.resumed')).toBe(false)
    // and no "unavailable" noise either — a first launch has nothing to resume
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.resume_unavailable')).toBe(false)
  })

  it('reopening the grill after the server killed it resumes the same conversation', async () => {
    const f = await feature('reopen')
    const first = await launch(f.id, 'ideation')
    markSessionLive(ctx, first, { ccSessionId: 'cc-grill' })

    // runcastle quits: the PTY dies with it and boot reconciliation ends the row
    reconcileStaleSessions(ctx)
    expect(getSessionRow(ctx, first)?.status).toBe('ended')

    const second = await launch(f.id, 'ideation')
    expect(commandFor(f.id, second)).toContain('--resume cc-grill')
    const resumed = listAfter(ctx, f.id, 0).find((e) => e.type === 'session.resumed')
    expect((resumed?.data as { resumeSessionId?: string }).resumeSessionId).toBe('cc-grill')
  })

  it('resumes the newest conversation of ITS OWN kind, not whatever ran last', async () => {
    const f = await feature('bykind')
    const grill = await launch(f.id, 'ideation')
    markSessionLive(ctx, grill, { ccSessionId: 'cc-grill' })
    reconcileStaleSessions(ctx)

    // a qa terminal runs afterwards, so it is the newest conversation overall
    const qa = await launch(f.id, 'qa')
    markSessionLive(ctx, qa, { ccSessionId: 'cc-qa' })
    reconcileStaleSessions(ctx)

    // reopening the grill still lands in the GRILL conversation
    const backToGrill = await launch(f.id, 'ideation')
    expect(commandFor(f.id, backToGrill)).toContain('--resume cc-grill')
    reconcileStaleSessions(ctx)

    // and reopening qa lands in the qa one
    const backToQa = await launch(f.id, 'qa')
    expect(commandFor(f.id, backToQa)).toContain('--resume cc-qa')
  })

  it('a session that died before going live is never a resume target', async () => {
    const f = await feature('stillborn')
    const dead = await launch(f.id, 'ideation') // never reaches `live` → no cc id
    reconcileStaleSessions(ctx)
    expect(getSessionRow(ctx, dead)?.ccSessionId).toBeFalsy()

    const next = await launch(f.id, 'ideation')
    expect(commandFor(f.id, next)).not.toContain('--resume')
  })

  it('types the RESUME kickoff into a resumed terminal, not the per-kind opener', async () => {
    const f = await feature('kickoff')
    const first = await launch(f.id, 'ideation')
    markSessionLive(ctx, first, { ccSessionId: 'cc-grill' })
    reconcileStaleSessions(ctx)
    const second = await launch(f.id, 'ideation')

    // fake PTY + timers only for the kickoff window (the launches above do real IO)
    const written: string[] = []
    const entry = {
      exited: false,
      pty: { write: (d: string) => written.push(d) },
    } as unknown as PtyEntry
    vi.spyOn(ptyRegistry(), 'get').mockReturnValue(entry)
    vi.useFakeTimers()

    markSessionLive(ctx, second, { ccSessionId: 'cc-grill-2' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)

    expect(written).toEqual([resumeKickoffLine('ideation'), '\r'])
    // the resume framing wraps the per-kind line, it does not replace it
    expect(written[0]).toContain(KICKOFF_LINES.ideation)
    expect(written[0]).toContain('Do NOT start over')
  })
})

describe('markSessionEnded — when the conversation stopped', () => {
  afterEach(() => vi.useRealTimers())

  it('stamps the ending, not the row age — a long session closed now ended now', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T10:00:00Z'))
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    markSessionLive(ctx, session.id, { ccSessionId: 'cc-1' })

    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    expect(markSessionEnded(ctx, session.id)?.endedAt).toBe(Date.parse('2026-09-04T12:00:00Z'))
    expect(getSessionRow(ctx, session.id)?.createdAt).toBe(Date.parse('2026-09-04T10:00:00Z'))
  })

  it('leaves a running session with no end time at all', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    expect(getSessionRow(ctx, session.id)?.endedAt).toBeUndefined()
    markSessionLive(ctx, session.id, { ccSessionId: 'cc-1' })
    expect(getSessionRow(ctx, session.id)?.endedAt).toBeUndefined()
  })

  it('keeps the FIRST ending when a second end path fires on the same row', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    markSessionEnded(ctx, session.id)

    // the Stop hook arriving after the PTY exit, or a boot reconciliation later
    vi.setSystemTime(new Date('2026-09-04T13:00:00Z'))
    expect(markSessionEnded(ctx, session.id)?.endedAt).toBe(Date.parse('2026-09-04T12:00:00Z'))
  })
})

describe('mostRecentResumableSession — the revisit resume target', () => {
  it('narrows to one kind when asked, ignoring newer conversations of other kinds', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id

    const grill = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    markSessionLive(ctx, grill.id, { ccSessionId: 'cc-grill' })
    markSessionEnded(ctx, grill.id)
    const qa = createSessionRow(ctx, { featureId, kind: 'qa', worktreePath: 'w' })
    markSessionLive(ctx, qa.id, { ccSessionId: 'cc-qa' })
    markSessionEnded(ctx, qa.id)

    // unfiltered (the revisit target) = newest of any kind
    expect(mostRecentResumableSession(ctx, featureId)?.ccSessionId).toBe('cc-qa')
    // filtered = newest of that kind, however long ago it ran
    expect(mostRecentResumableSession(ctx, featureId, 'ideation')?.ccSessionId).toBe('cc-grill')
    expect(mostRecentResumableSession(ctx, featureId, 'converge')).toBeNull()
  })

  it('picks the newest ENDED session with a cc id; ignores live rows and id-less rows', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id

    // oldest: ended with a cc id — the fallback candidate
    const s1 = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    markSessionLive(ctx, s1.id, { ccSessionId: 'cc-oldest' })
    markSessionEnded(ctx, s1.id)

    // newer: ended but never went live (no cc id) — not resumable
    const s2 = createSessionRow(ctx, { featureId, kind: 'qa', worktreePath: 'w' })
    markSessionEnded(ctx, s2.id)

    expect(mostRecentResumableSession(ctx, featureId)?.ccSessionId).toBe('cc-oldest')

    // newest: ended with a cc id — wins
    const s3 = createSessionRow(ctx, { featureId, kind: 'qa', worktreePath: 'w' })
    markSessionLive(ctx, s3.id, { ccSessionId: 'cc-newest' })
    markSessionEnded(ctx, s3.id)
    expect(mostRecentResumableSession(ctx, featureId)?.ccSessionId).toBe('cc-newest')

    // a LIVE session is never the resume target
    const s4 = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    markSessionLive(ctx, s4.id, { ccSessionId: 'cc-live' })
    expect(mostRecentResumableSession(ctx, featureId)?.ccSessionId).toBe('cc-newest')
  })

  it('returns null when the feature has no resumable conversation', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    expect(mostRecentResumableSession(ctx, featureId)).toBeNull()

    const other = seedFeature(ctx, seedProject(ctx).id, { slug: 'other' }).id
    const s = createSessionRow(ctx, { featureId: other, kind: 'ideation', worktreePath: 'w' })
    markSessionLive(ctx, s.id, { ccSessionId: 'cc-other' })
    markSessionEnded(ctx, s.id)
    // another feature's conversation is never offered
    expect(mostRecentResumableSession(ctx, featureId)).toBeNull()
  })
})
