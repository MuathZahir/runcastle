import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EventRow, Feature, Project } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { renderProjectPrompt } from '../src/launcher/artifacts'
import { emit, emitProject, runAsActor } from '../src/services/events'
import {
  ORCHESTRATOR_GATHER_MS,
  orchestratorCatchUp,
  orchestratorLineFor,
  startOrchestratorNotifier,
  type NotifyState,
} from '../src/services/orchestrator-notify'
import { openProject } from '../src/services/projects'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * What the orchestrator hears (`whole-cuts-plan-themselves` decisions 11, 13;
 * `one-orchestrator-no-mode` decision 3): a `[runcastle]` line per thing that
 * ended on a feature it follows or per human act on one, and a catch-up briefing.
 */

function event(type: string, data?: Record<string, unknown>, extra: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    projectId: 'proj',
    featureId: 'feat',
    ts: 0,
    type,
    message: extra.message ?? type,
    ...(data ? { data } : {}),
    ...extra,
  }
}

const followed: NotifyState = { feature: { slug: 'export-csv', followed: true } }
const notFollowed: NotifyState = { feature: { slug: 'export-csv', followed: false } }
const chat = { kind: 'chat', purpose: undefined, headless: false } as const

describe('orchestratorLineFor — end events', () => {
  const cases: [string, EventRow, NotifyState, string][] = [
    [
      'a self-planning run that finished',
      event('session.self_plan_ended', { complete: true }),
      followed,
      '[runcastle] export-csv finished planning. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'an agent waiting for the human',
      event('feature.waiting', { why: 'start round 1?' }),
      followed,
      '[runcastle] export-csv waits for you: start round 1?. Read what it asked with read_feature_chat({ slug: "export-csv" }).',
    ],
    [
      'an agent declaring ready',
      event('feature.ready_declared', { scenario: 'empty-cart' }),
      followed,
      '[runcastle] export-csv declared ready to test (drive: empty-cart). Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'an agent runcastle could not wake',
      event('lead.wake_failed', { exitCode: 1, tail: '', messages: 1 }, { message: 'could not resume the agent headless' }),
      followed,
      '[runcastle] export-csv could not wake its agent, so messages sent to it have not reached it yet (could not resume the agent headless). Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a self-planning run that stopped short',
      event('session.self_plan_ended', { complete: false }),
      followed,
      '[runcastle] export-csv stopped before the plan was complete. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a relay run that finished',
      event('session.run_ended', { complete: true }),
      followed,
      '[runcastle] export-csv headless run finished. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a round that succeeded',
      event('run.finished', { status: 'succeeded', summary: '3/3 tickets done' }),
      followed,
      '[runcastle] export-csv round finished (3/3 tickets done). Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a round that failed',
      event('run.finished', { status: 'failed', summary: '2/3 tickets done' }),
      followed,
      '[runcastle] export-csv round failed (2/3 tickets done). Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a review pass that finished',
      event('ticket.done'),
      { ...followed, ticket: { seq: 4, kind: 'review', passKind: 'review' } },
      '[runcastle] export-csv review pass (ticket 4) finished. Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a verification pass that failed',
      event('ticket.failed'),
      { ...followed, ticket: { seq: 5, kind: 'review', passKind: 'verification' } },
      '[runcastle] export-csv verification pass (ticket 5) failed. Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a merge that landed',
      event('feature.shipped', undefined, { message: 'merged to main' }),
      followed,
      '[runcastle] export-csv merged to main: shipped. Backlog features waiting on it may start now. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a merge that conflicted',
      event('merge.conflict', { files: ['a.ts', 'b.ts'] }),
      followed,
      `[runcastle] export-csv merge conflicted in 2 file(s). Resolve it in the feature's worktree, then merge_feature again. Read it with get_feature_context({ slug: "export-csv" }).`,
    ],
    [
      'a drive that failed',
      event('testdrive.dev_failed', undefined, { message: 'dev server failed to start: ENOENT' }),
      followed,
      '[runcastle] export-csv drive failed: dev server failed to start: ENOENT. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
  ]

  it.each(cases)('%s', (_name, e, state, line) => {
    expect(orchestratorLineFor(e, state)).toBe(line)
  })

  const answeredByMerge = (e: EventRow) => e.type === 'feature.shipped' || e.type === 'merge.conflict'

  it.each(cases.filter(([, e]) => !answeredByMerge(e)))(
    '%s is forwarded even when the orchestrator caused it',
    (_name, e, state, line) => {
      const stamped = { ...e, data: { ...(e.data as object), actor: 'orchestrator' } }
      expect(orchestratorLineFor(stamped, state)).toBe(line)
    },
  )

  it.each(cases.filter(([, e]) => answeredByMerge(e)))(
    '%s says nothing when its own merge_feature call caused it',
    (_name, e, state) => {
      const stamped = { ...e, data: { ...(e.data as object), actor: 'orchestrator' } }
      expect(orchestratorLineFor(stamped, state)).toBeNull()
    },
  )

  it.each(cases)('%s says nothing on a feature it does not follow', (_name, e, state) => {
    expect(orchestratorLineFor(e, { ...state, ...notFollowed })).toBeNull()
  })

  it('keeps every line one short line', () => {
    const long = event('run.finished', { status: 'failed', summary: `x\n${'y'.repeat(500)}` })
    const line = orchestratorLineFor(long, followed) as string
    expect(line).not.toContain('\n')
    expect(line.length).toBeLessThan(200)
  })

  it('ignores implementation tickets finishing', () => {
    const e = event('ticket.done')
    expect(orchestratorLineFor(e, { ...followed, ticket: { seq: 1, kind: 'implementation', passKind: 'review' } })).toBeNull()
  })
})

describe('orchestratorLineFor — act events', () => {
  const cases: [string, EventRow, NotifyState, string][] = [
    [
      'the human’s message starting a chat',
      event('session.process_started', { sessionId: 's', source: 'human' }),
      { ...followed, session: chat },
      '[runcastle] export-csv the human is talking to its chat thread; it is busy until that conversation goes quiet.',
    ],
    [
      'the human clicking Plan it yourself',
      event('session.launching', { sessionId: 's', purpose: 'self-plan' }),
      { ...followed, session: { ...chat, purpose: 'self-plan' } },
      '[runcastle] export-csv the human had it plan itself. Wait for the run to end.',
    ],
    [
      'the human’s conversation going quiet',
      event('session.process_stopped', { sessionId: 's', reason: 'idle', startedBy: 'human' }),
      { ...followed, session: chat },
      `[runcastle] export-csv the human's chat conversation on it went quiet; it is free again. Read it with get_feature_context({ slug: "export-csv" }).`,
    ],
    [
      'a test drive starting',
      event('testdrive.started', { purpose: 'test' }),
      followed,
      '[runcastle] export-csv the human started a test drive of it.',
    ],
    [
      'a test drive stopping',
      event('testdrive.stopped', { purpose: 'test' }),
      followed,
      '[runcastle] export-csv the human stopped the test drive of it. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
  ]

  it.each(cases)('%s', (_name, e, state, line) => {
    expect(orchestratorLineFor(e, state)).toBe(line)
  })

  it.each(cases)('%s is not repeated when the orchestrator did it', (_name, e, state) => {
    const stamped = { ...e, data: { ...(e.data as object), actor: 'orchestrator' } }
    expect(orchestratorLineFor(stamped, state)).toBeNull()
  })

  it.each(cases)('%s says nothing on a feature it does not follow', (_name, e, state) => {
    expect(orchestratorLineFor(e, { ...state, ...notFollowed })).toBeNull()
  })

  it('says nothing of a thread runcastle started, a side thread, or a self-planning run’s stop', () => {
    const started = (source: string) => event('session.process_started', { sessionId: 's', source })
    const stopped = (startedBy: string) => event('session.process_stopped', { sessionId: 's', startedBy })
    expect(orchestratorLineFor(started('runcastle'), { ...followed, session: chat })).toBeNull()
    expect(orchestratorLineFor(stopped('runcastle'), { ...followed, session: chat })).toBeNull()
    expect(orchestratorLineFor(started('human'), { ...followed, session: { ...chat, kind: 'side' } })).toBeNull()
    // A self-planning run's end is its own END event.
    expect(orchestratorLineFor(stopped('human'), { ...followed, session: { ...chat, purpose: 'self-plan' } })).toBeNull()
    expect(orchestratorLineFor(event('session.launching', { sessionId: 's' }), { ...followed, session: chat })).toBeNull()
  })

  it('says nothing for a cleared waiting reason or the ready reason the ready line covers', () => {
    expect(orchestratorLineFor(event('feature.waiting', { why: null }), followed)).toBeNull()
    expect(orchestratorLineFor(event('feature.waiting', { why: 'ready to test' }), followed)).toBeNull()
  })

  it('no line speaks of laps, burns or Go', () => {
    const all = [
      event('session.self_plan_ended', { complete: true }),
      event('run.finished', { status: 'failed' }),
      event('feature.waiting', { why: 'stuck' }),
      event('feature.ready_declared', { scenario: 's' }),
      event('burn.started'),
      event('burn.restarted'),
    ]
    for (const e of all) expect(orchestratorLineFor(e, followed) ?? '').not.toMatch(/\b(lap|burn|go)\b/i)
    expect(orchestratorLineFor(event('burn.started'), followed)).toBeNull()
  })

  it('leaves the review agent’s drive alone', () => {
    expect(orchestratorLineFor(event('testdrive.started', { purpose: 'review' }), followed)).toBeNull()
  })
})

describe('orchestratorLineFor — project-level events', () => {
  it('says nothing for any project event: there is no mode to turn off, so no stop line', () => {
    const setting = event('settings.updated', { key: 'orchestrator', scope: 'project', value: false }, { featureId: undefined })
    expect(orchestratorLineFor(setting, {})).toBeNull()
    expect(orchestratorLineFor(event('project.renamed', undefined, { featureId: undefined }), {})).toBeNull()
  })
})

async function gitRepo(): Promise<string> {
  const dir = tmpRepo()
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  return dir
}

describe('the notifier and the catch-up', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let opened: Project
  let restoreDataDir: () => void
  let stopNotifier: () => void
  let fake: FakeAcp
  let host: AgentHost

  beforeEach(async () => {
    restoreDataDir = withTempDataDir()
    ctx = await makeTestCtx()
    repoPath = await gitRepo()
    opened = await openProject(ctx, repoPath)
    projectId = opened.id
    stopNotifier = startOrchestratorNotifier(ctx)
    fake = createFakeAcp()
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH })
    setAgentHostForTests(host)
  })

  afterEach(async () => {
    await host.stopAll('shutdown')
    setAgentHostForTests(undefined)
    stopNotifier()
    vi.restoreAllMocks()
    restoreDataDir()
    rmTemp(repoPath)
  })

  /** A live project session — the orchestrator. */
  function projectSession(): string {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    return row.id
  }

  /** A feature the orchestrator follows: one of its events carries its stamp. */
  function followedFeature(slug = 'demo', overrides: Partial<Feature> = {}): Feature {
    const feature = seedFeature(ctx, projectId, { slug, ...overrides })
    runAsActor('orchestrator', () => emit(ctx, feature.id, { type: 'feature.created', message: 'created' }))
    return feature
  }

  function project(): Project {
    return opened
  }

  /** The lines each runcastle prompt said into the thread, one prompt per entry. */
  async function promptLines(id: string, prompts: number): Promise<string[][]> {
    await vi.waitFor(() => expect(promptsOf(id)).toHaveLength(prompts))
    return promptsOf(id).map((p) => {
      expect(p.source).toBe('runcastle')
      return p.text.split('\n')
    })
  }

  it('says a followed feature’s end event into the orchestrator’s thread, starting it', async () => {
    const id = projectSession()
    const feature = followedFeature('export-csv')

    emit(ctx, feature.id, { type: 'session.self_plan_ended', message: 'planning finished', data: { complete: true } })

    expect(await promptLines(id, 1)).toEqual([
      ['[runcastle] export-csv finished planning. Read it with get_feature_context({ slug: "export-csv" }).'],
    ])
    expect(host.isRunning(id)).toBe(true)
  })

  it('says two events ending together as one prompt with two separate lines', async () => {
    const id = projectSession()
    const feature = followedFeature('snake-core')

    emit(ctx, feature.id, { type: 'session.self_plan_ended', message: 'x', data: { complete: true } })
    emit(ctx, feature.id, { type: 'run.finished', message: 'x', data: { status: 'succeeded', summary: '5/5 tickets done' } })

    expect(await promptLines(id, 1)).toEqual([
      [
        '[runcastle] snake-core finished planning. Read it with get_feature_context({ slug: "snake-core" }).',
        '[runcastle] snake-core round finished (5/5 tickets done). Read it with list_tickets({ slug: "snake-core" }).',
      ],
    ])
  })

  it('stays quiet about a feature it does not follow, and about acts and merges it took itself', async () => {
    const id = projectSession()
    const human = seedFeature(ctx, projectId, { slug: 'human-one' })
    const mine = followedFeature('mine')

    emit(ctx, human.id, { type: 'feature.shipped', message: 'merged to main' })
    runAsActor('orchestrator', () => emit(ctx, mine.id, { type: 'burn.started', message: 'burning' }))
    runAsActor('orchestrator', () => emit(ctx, mine.id, { type: 'feature.shipped', message: 'merged to main' }))
    runAsActor('orchestrator', () => emit(ctx, mine.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } }))

    await new Promise((r) => setTimeout(r, ORCHESTRATOR_GATHER_MS + 50))
    expect(promptsOf(id)).toEqual([])
  })

  it('follows a feature the orchestrator only messaged, and stops once it has shipped', async () => {
    const id = projectSession()
    const touched = seedFeature(ctx, projectId, { slug: 'touched' })
    runAsActor('orchestrator', () => emit(ctx, touched.id, { type: 'lead.message_queued', message: 'x' }))
    const done = followedFeature('done', { status: 'shipped' })

    emit(ctx, touched.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })
    emit(ctx, done.id, { type: 'testdrive.dev_failed', message: 'boom' })

    expect(await promptLines(id, 1)).toEqual([
      [
        `[runcastle] touched merge conflicted in 1 file(s). Resolve it in the feature's worktree, then merge_feature again. Read it with get_feature_context({ slug: "touched" }).`,
      ],
    ])
  })

  it('tells the newest project chat, whether or not its process runs', async () => {
    const older = projectSession()
    const newest = projectSession()
    markSessionEnded(ctx, newest)
    const feature = followedFeature()

    emit(ctx, feature.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })

    expect(await promptLines(newest, 1)).toHaveLength(1)
    expect(promptsOf(older)).toEqual([])
  })

  it('says nothing when the project has no chat to tell', async () => {
    const feature = followedFeature()
    emit(ctx, feature.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })
    await new Promise((r) => setTimeout(r, ORCHESTRATOR_GATHER_MS + 50))
    expect(fake.processes).toEqual([])
  })

  it('never lets a failure reach the service that emitted', () => {
    projectSession()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const feature = followedFeature()
    ctx.db.delete(sessions).run()

    expect(() => emit(ctx, feature.id, { type: 'feature.shipped', message: 'merged to main' })).not.toThrow()
  })

  it('catches up on nothing when there never was an orchestrator', () => {
    const feature = followedFeature()
    emit(ctx, feature.id, { type: 'feature.shipped', message: 'merged to main' })

    expect(orchestratorCatchUp(ctx, project())).toEqual([])
  })

  it('lists end events on followed features since the last project session ended, oldest first', () => {
    const last = projectSession()
    markSessionEnded(ctx, last)
    const endedAt = Date.now() - 10_000
    ctx.db.update(sessions).set({ endedAt }).where(eq(sessions.id, last)).run()
    const mine = followedFeature('mine')
    const human = seedFeature(ctx, projectId, { slug: 'human-one' })

    emit(ctx, mine.id, { type: 'session.self_plan_ended', message: 'x', data: { complete: false } })
    emit(ctx, human.id, { type: 'feature.shipped', message: 'merged to main' })
    emit(ctx, mine.id, { type: 'burn.started', message: 'burning' })
    emit(ctx, mine.id, { type: 'feature.waiting', message: 'x', data: { why: 'which theme?' } })
    emit(ctx, mine.id, { type: 'feature.ready_declared', message: 'x', data: { scenario: 'home' } })
    emit(ctx, mine.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })
    emitProject(ctx, projectId, { type: 'project.renamed', message: 'renamed' })

    expect(orchestratorCatchUp(ctx, project())).toEqual([
      'mine stopped before the plan was complete. Read it with get_feature_context({ slug: "mine" }).',
      'mine waits for you: which theme?. Read what it asked with read_feature_chat({ slug: "mine" }).',
      'mine declared ready to test (drive: home). Read it with get_feature_context({ slug: "mine" }).',
      `mine merge conflicted in 1 file(s). Resolve it in the feature's worktree, then merge_feature again. Read it with get_feature_context({ slug: "mine" }).`,
    ])
  })

  it('leaves out what happened before the last orchestrator ended', () => {
    const mine = followedFeature('mine')
    emit(ctx, mine.id, { type: 'feature.shipped', message: 'merged to main' })
    const last = projectSession()
    markSessionEnded(ctx, last)
    ctx.db.update(sessions).set({ endedAt: Date.now() + 10_000 }).where(eq(sessions.id, last)).run()

    expect(orchestratorCatchUp(ctx, project())).toEqual([])
  })

  it('caps the catch-up and says how many more there were', () => {
    const last = projectSession()
    markSessionEnded(ctx, last)
    ctx.db.update(sessions).set({ endedAt: Date.now() - 10_000 }).where(eq(sessions.id, last)).run()
    const mine = followedFeature('mine')
    for (let i = 0; i < 53; i++) {
      emit(ctx, mine.id, { type: 'run.finished', message: 'x', data: { status: 'failed', summary: `run ${i}` } })
    }

    const lines = orchestratorCatchUp(ctx, project())
    expect(lines).toHaveLength(51)
    expect(lines[0]).toContain('(run 0)')
    expect(lines[49]).toContain('(run 49)')
    expect(lines[50]).toBe('…and 3 more — read get_project_context')
  })

  it('renders the catch-up under "Since you were last live" in the orchestrating prompt', () => {
    const last = projectSession()
    markSessionEnded(ctx, last)
    ctx.db.update(sessions).set({ endedAt: Date.now() - 10_000 }).where(eq(sessions.id, last)).run()
    const mine = followedFeature('mine')
    emit(ctx, mine.id, { type: 'feature.shipped', message: 'merged to main' })

    const prompt = renderProjectPrompt(
      {
        project: project(),
        branch: 'runcastle/project',
        worktreePath: repoPath,
        base: 'main',
        openNotes: 0,
        catchUp: orchestratorCatchUp(ctx, project()),
      },
      'claude-code',
    )
    expect(prompt).toContain(
      '### Since you were last live\n- mine merged to main: shipped. Backlog features waiting on it may start now.',
    )
  })
})
