import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import type { SessionKind } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { launchSession } from '../src/launcher/launcher'
import { reconcileStaleSessions } from '../src/launcher/reconcile'
import {
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
  newestThread,
} from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { createAgentHost } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { readThreadEvents } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { kickoffOf, promptsOf } from './support/thread-launch'

/**
 * E2E-findings coverage (session lifecycle):
 *  - boot reconciliation: stale launching/live sessions → ended, one
 *    `session.reconciled` event each;
 *  - one main-chat thread per feature: a second Chat click lands in the same
 *    thread, and an active run parks the talk worktree rather than refusing it;
 *  - a conversation that fails to load says so on its thread and stays the one
 *    its next prompt resumes.
 */

async function initRepo(dir: string): Promise<void> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  await g.raw(['commit', '--allow-empty', '-m', 'initial commit'])
}

function seedRunningRun(ctx: AppCtx, featureId: string, workflow: string): string {
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
    featureId = seedFeature(ctx, project.id).id
  })

  it('marks launching AND live sessions ended, one event each', () => {
    const launching = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'C:\\wt' })
    const live = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'C:\\wt' })
    markSessionLive(ctx, live.id, { ccSessionId: 'cc-live' })

    const reconciled = reconcileStaleSessions(ctx)
    expect(reconciled.map((s) => s.id).sort()).toEqual([launching.id, live.id].sort())

    // both rows are ended, no active session remains; the live one stays resumable
    expect(getSessionRow(ctx, launching.id)?.status).toBe('ended')
    expect(getSessionRow(ctx, live.id)?.status).toBe('ended')
    expect(activeSessionsForFeature(ctx, featureId)).toEqual([])
    expect(newestThread(ctx, { featureId }, 'chat')?.id).toBe(live.id)

    // exactly one session.reconciled event per reconciled session
    const events = listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.reconciled')
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.data)).toEqual(
      expect.arrayContaining([
        { sessionId: launching.id, previousStatus: 'launching' },
        { sessionId: live.id, previousStatus: 'live' },
      ]),
    )
  })

  it('leaves already-ended sessions alone (no event, no double work)', () => {
    const ended = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'C:\\wt' })
    markSessionEnded(ctx, ended.id)

    expect(reconcileStaleSessions(ctx)).toEqual([])
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.reconciled')).toHaveLength(0)
  })

  it('is idempotent — a second boot reconciles nothing', () => {
    createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'C:\\wt' })
    expect(reconcileStaleSessions(ctx)).toHaveLength(1)
    expect(reconcileStaleSessions(ctx)).toEqual([])
  })
})

describe('one main chat thread — threads and runs', () => {
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

  async function feature(slug: string) {
    const f = seedFeature(ctx, projectId, { slug })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return f
  }

  it('an ACTIVE branch-claiming run no longer refuses a terminal — it parks the worktree instead', async () => {
    // The post-mortem's worst hour was a live burn with nothing to talk to
    // (one-chat-per-feature decision 2). The run holds `feature/<slug>`, so the
    // session works on a chat temp branch beside it.
    const f = await feature('busy')
    seedRunningRun(ctx, f.id, 'ticket-burner')

    const { sessionId } = await launchSession(ctx, { featureId: f.id, kind: 'chat' }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    const head = (
      await simpleGit(worktreeDir(projectId, f.slug)).revparse(['--abbrev-ref', 'HEAD'])
    ).trim()
    expect(head.startsWith('runcastle/chat/')).toBe(true)
  })

  it('keeps exactly one main chat thread: a second Chat click lands in it', async () => {
    const f = await feature('sneaky')
    const first = await launchSession(ctx, { featureId: f.id, kind: 'chat' }, { spawn: false })
    cleanup.push(sessionDir(first.sessionId))
    markSessionLive(ctx, first.sessionId, { ccSessionId: 'cc-a' })

    const second = await launchSession(ctx, { featureId: f.id, kind: 'chat' }, { spawn: false })
    expect(second.sessionId).toBe(first.sessionId)
    expect(activeSessionsForFeature(ctx, f.id).map((s) => s.id)).toEqual([first.sessionId])
  })
})

describe('a conversation that will not load keeps its thread', () => {
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

  it('says why on the thread, ends the row, and keeps the conversation the one to resume', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'preserve' })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, f.slug, 'main')
    cleanup.push(worktreeDir(projectId, f.slug))
    const { sessionId } = await launchSession(ctx, { featureId: f.id, kind: 'chat' }, { spawn: false })
    cleanup.push(sessionDir(sessionId))
    markSessionLive(ctx, sessionId, { ccSessionId: 'cc-good' })
    markSessionEnded(ctx, sessionId)
    const host = createAgentHost({
      ctx,
      transport: createFakeAcp({ failSession: 'No conversation found' }).transport,
      launch: FAKE_LAUNCH,
    })

    await host.prompt(sessionId, { text: 'are you there?' }, { source: 'human' })

    await vi.waitFor(() =>
      expect(readThreadEvents(sessionId).at(-1)).toMatchObject({ type: 'process', state: 'stopped' }),
    )
    expect(JSON.stringify(readThreadEvents(sessionId).at(-1))).toContain('No conversation found')
    expect(getSessionRow(ctx, sessionId)).toMatchObject({ status: 'ended', ccSessionId: 'cc-good' })
    // the next launch reopens the same thread, its conversation still the one to load
    expect((await launchSession(ctx, { featureId: f.id, kind: 'chat' }, { spawn: false })).sessionId).toBe(sessionId)
  })
})

/**
 * Reopening a conversation picks ITS OWN thread back up, at every phase. A
 * thread is a row for life: quitting runcastle stops its process and boot
 * reconciliation ends the row — but the row kept its `ccSessionId` and its
 * log, so the next launch reopens it, and its next prompt loads the
 * conversation instead of starting cold from the docs.
 */
describe('relaunching a chat reopens its own thread', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  let originalCodexHome: string | undefined
  const cleanup: string[] = []

  beforeEach(async () => {
    originalCodexHome = process.env.CODEX_HOME
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-relaunch-'))
    cleanup.push(repoPath)
    await initRepo(repoPath)
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = originalCodexHome
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

  function useCodexRuntime(): void {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-relaunch-codex-'))
    cleanup.push(home)
    process.env.CODEX_HOME = home
    writeFileSync(join(home, 'auth.json'), '{"tokens":{"id_token":"test"}}')
    ctx.config = {
      ...ctx.config,
      model: 'gpt-5',
      models: [{ id: 'gpt-5', runtime: 'codex' }],
    }
  }

  it('the FIRST chat launch starts fresh — briefed, no session.resumed', async () => {
    const f = await feature('first')
    const id = await launch(f.id, 'chat')

    expect(kickoffOf(id)).toContain('Call get_feature_context for the full picture.')
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.resumed')).toBe(false)
    // and no "unavailable" noise either — a first launch has nothing to resume
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.resume_unavailable')).toBe(false)
  })

  for (const runtime of ['claude-code', 'codex'] as const) {
    it(`reopening the chat after the server stopped it reopens the same thread on ${runtime}`, async () => {
      if (runtime === 'codex') useCodexRuntime()
      const f = await feature(`reopen-${runtime}`)
      const first = await launch(f.id, 'chat')
      markSessionLive(ctx, first, { ccSessionId: 'cc-chat' })

      // runcastle quits: the process dies with it and boot reconciliation ends the row
      reconcileStaleSessions(ctx)
      expect(getSessionRow(ctx, first)?.status).toBe('ended')

      expect(await launch(f.id, 'chat')).toBe(first)
      const resumed = listAfter(ctx, f.id, 0).find((e) => e.type === 'session.resumed')
      expect((resumed?.data as { resumeSessionId?: string }).resumeSessionId).toBe('cc-chat')
      expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.resume_unavailable')).toBe(false)
      // A plain reopen says nothing more than the first launch did.
      expect(promptsOf(first)).toHaveLength(1)
    })
  }

  it('reopens a thread whose conversation the agent never took, with nothing said again', async () => {
    const f = await feature('stillborn')
    const dead = await launch(f.id, 'chat') // never reaches `live` → no cc id
    reconcileStaleSessions(ctx)
    expect(getSessionRow(ctx, dead)?.ccSessionId).toBeFalsy()

    expect(await launch(f.id, 'chat')).toBe(dead)
    expect(promptsOf(dead)).toHaveLength(1)
  })

  it('a chat override rides the reopened Codex thread with fresh state', async () => {
    useCodexRuntime()
    const f = await feature('codex-explicit')
    const first = await launch(f.id, 'chat')
    markSessionLive(ctx, first, { ccSessionId: 'codex-prior' })
    reconcileStaleSessions(ctx)

    const { sessionId } = await launchSession(
      ctx,
      { featureId: f.id, kind: 'chat', kickoffLine: 'Start this explicit task.' },
      { spawn: false },
    )

    expect(sessionId).toBe(first)
    const said = promptsOf(first).at(-1)?.text ?? ''
    expect(said).toContain('Start this explicit task.')
    expect(said).toContain('Feature status:')
    const eventTypes = listAfter(ctx, f.id, 0).map((e) => e.type)
    expect(eventTypes).not.toContain('session.resume_skipped')
    expect(eventTypes).not.toContain('session.resume_unavailable')
  })

  it('reopens the newest chat thread', async () => {
    const f = await feature('newest')
    const older = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: worktreeDir(projectId, f.slug) })
    markSessionLive(ctx, older.id, { ccSessionId: 'cc-older' })
    const newer = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: worktreeDir(projectId, f.slug) })
    markSessionLive(ctx, newer.id, { ccSessionId: 'cc-newer' })
    reconcileStaleSessions(ctx)

    expect(await launch(f.id, 'chat')).toBe(newer.id)
  })

  it('loads the reopened conversation on its next prompt, handing it the fresh state', async () => {
    const f = await feature('loads')
    const first = await launch(f.id, 'chat')
    markSessionLive(ctx, first, { ccSessionId: 'cc-loaded' })
    reconcileStaleSessions(ctx)
    const fake = createFakeAcp()
    const host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })

    await host.prompt(first, { text: 'where were we?' }, { source: 'human' })
    await vi.waitFor(() => expect(fake.last()?.received.some((r) => r.method === 'session/prompt')).toBe(true))

    const load = fake.last().received.find((r) => r.method === 'session/load')?.params as { sessionId: string }
    expect(load.sessionId).toBe('cc-loaded')
    const sent = fake.last().received.find((r) => r.method === 'session/prompt')?.params as { prompt: { text: string }[] }
    expect(sent.prompt[0].text).toMatch(/^where were we\?\n\n.*Feature status:/s)
    await host.stopAll('shutdown')
  })
})

describe('markSessionEnded — when the conversation stopped', () => {
  afterEach(() => vi.useRealTimers())

  it('stamps the ending, not the row age — a long session closed now ended now', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T10:00:00Z'))
    const session = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    markSessionLive(ctx, session.id, { ccSessionId: 'cc-1' })

    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    expect(markSessionEnded(ctx, session.id)?.endedAt).toBe(Date.parse('2026-09-04T12:00:00Z'))
    expect(getSessionRow(ctx, session.id)?.createdAt).toBe(Date.parse('2026-09-04T10:00:00Z'))
  })

  it('leaves a running session with no end time at all', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    expect(getSessionRow(ctx, session.id)?.endedAt).toBeUndefined()
    markSessionLive(ctx, session.id, { ccSessionId: 'cc-1' })
    expect(getSessionRow(ctx, session.id)?.endedAt).toBeUndefined()
  })

  it('keeps the FIRST ending when a second end path fires on the same row', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    const session = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    markSessionEnded(ctx, session.id)

    // the Stop hook arriving after the PTY exit, or a boot reconciliation later
    vi.setSystemTime(new Date('2026-09-04T13:00:00Z'))
    expect(markSessionEnded(ctx, session.id)?.endedAt).toBe(Date.parse('2026-09-04T12:00:00Z'))
  })
})

describe('newestThread — the thread a launch reopens', () => {
  it('stays within its kind, however long ago that thread ran', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id

    const chat = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    markSessionLive(ctx, chat.id, { ccSessionId: 'cc-chat' })
    markSessionEnded(ctx, chat.id)
    const fix = createSessionRow(ctx, { featureId, kind: 'drive-fix', worktreePath: 'w' })
    markSessionLive(ctx, fix.id, { ccSessionId: 'cc-fix' })

    expect(newestThread(ctx, { featureId }, 'chat')?.ccSessionId).toBe('cc-chat')
    expect(newestThread(ctx, { featureId }, 'drive-fix')?.ccSessionId).toBe('cc-fix')
    expect(newestThread(ctx, { featureId }, 'prepare')).toBeNull()
  })

  it('picks the newest row holding a conversation, running or not, over newer stillborn rows', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id

    const s1 = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    markSessionLive(ctx, s1.id, { ccSessionId: 'cc-oldest' })
    markSessionEnded(ctx, s1.id)
    // newer: never went live and said nothing — no conversation
    const s2 = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    markSessionEnded(ctx, s2.id)
    expect(newestThread(ctx, { featureId }, 'chat')?.id).toBe(s1.id)

    // newest: running — a thread is reopened whatever its process does
    const s3 = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    markSessionLive(ctx, s3.id, { ccSessionId: 'cc-live' })
    expect(newestThread(ctx, { featureId }, 'chat')?.id).toBe(s3.id)
  })

  it('falls back to the newest row when none holds a conversation, and never crosses features', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    expect(newestThread(ctx, { featureId }, 'chat')).toBeNull()

    const other = seedFeature(ctx, seedProject(ctx).id, { slug: 'other' }).id
    const s = createSessionRow(ctx, { featureId: other, kind: 'chat', worktreePath: 'w' })
    markSessionLive(ctx, s.id, { ccSessionId: 'cc-other' })
    expect(newestThread(ctx, { featureId }, 'chat')).toBeNull()

    const fresh = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: 'w' })
    expect(newestThread(ctx, { featureId }, 'chat')?.id).toBe(fresh.id)
  })
})
