import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EventRow, Feature, Project, SessionRow } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive, setSessionTitle } from '../src/launcher/sessions'
import { emit, emitProject, runAsActor } from '../src/services/events'
import {
  ORCHESTRATOR_GATHER_MS,
  orchestratorLineFor,
  startOrchestratorNotifier,
  type NotifyState,
} from '../src/services/orchestrator-notify'
import { takeHold } from '../src/services/holding'
import { openProject } from '../src/services/projects'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'

/**
 * What a thread hears (`whole-cuts-plan-themselves` decisions 11, 13;
 * `threads-hold-features`): a `[runcastle]` line per thing that ended on a feature
 * it holds, or per human act on one.
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

const held: NotifyState = { feature: { slug: 'export-csv', holderId: 'thread', holderRunning: true } }
const unheld: NotifyState = { feature: { slug: 'export-csv', holderId: null, holderRunning: false } }
const chat = { kind: 'chat', purpose: undefined, headless: false } as const

describe('orchestratorLineFor — end events', () => {
  const cases: [string, EventRow, NotifyState, string][] = [
    [
      'a self-planning run that finished',
      event('session.self_plan_ended', { complete: true }),
      held,
      '[runcastle] export-csv finished planning. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'an agent waiting for the human',
      event('feature.waiting', { why: 'start round 1?' }),
      held,
      '[runcastle] export-csv waits for you: start round 1?. Read what it asked with read_feature_chat({ slug: "export-csv" }).',
    ],
    [
      'an agent declaring ready',
      event('feature.ready_declared', { scenario: 'empty-cart' }),
      held,
      '[runcastle] export-csv declared ready to test (drive: empty-cart). Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'an agent runcastle could not wake',
      event('lead.wake_failed', { exitCode: 1, tail: '', messages: 1 }, { message: 'could not resume the agent headless' }),
      held,
      '[runcastle] export-csv could not wake its agent, so messages sent to it have not reached it yet (could not resume the agent headless). Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a self-planning run that stopped short',
      event('session.self_plan_ended', { complete: false }),
      held,
      '[runcastle] export-csv stopped before the plan was complete. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a relay run that finished',
      event('session.run_ended', { complete: true }),
      held,
      '[runcastle] export-csv headless run finished. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a round that succeeded',
      event('run.finished', { status: 'succeeded', summary: '3/3 tickets done' }),
      held,
      '[runcastle] export-csv round finished (3/3 tickets done). Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a round that failed',
      event('run.finished', { status: 'failed', summary: '2/3 tickets done' }),
      held,
      '[runcastle] export-csv round failed (2/3 tickets done). Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a review pass that finished',
      event('ticket.done'),
      { ...held, ticket: { seq: 4, kind: 'review', passKind: 'review' } },
      '[runcastle] export-csv review pass (ticket 4) finished. Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a verification pass that failed',
      event('ticket.failed'),
      { ...held, ticket: { seq: 5, kind: 'review', passKind: 'verification' } },
      '[runcastle] export-csv verification pass (ticket 5) failed. Read it with list_tickets({ slug: "export-csv" }).',
    ],
    [
      'a merge that landed',
      event('feature.shipped', undefined, { message: 'merged to main' }),
      held,
      '[runcastle] export-csv merged to main: shipped. Backlog features waiting on it may start now. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a merge that conflicted',
      event('merge.conflict', { files: ['a.ts', 'b.ts'] }),
      held,
      `[runcastle] export-csv merge conflicted in 2 file(s). Resolve it in the feature's worktree, then merge_feature again. Read it with get_feature_context({ slug: "export-csv" }).`,
    ],
    [
      'a drive that failed',
      event('testdrive.dev_failed', undefined, { message: 'dev server failed to start: ENOENT' }),
      held,
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
    expect(orchestratorLineFor(e, { ...state, ...unheld })).toBeNull()
  })

  it('keeps every line one short line', () => {
    const long = event('run.finished', { status: 'failed', summary: `x\n${'y'.repeat(500)}` })
    const line = orchestratorLineFor(long, held) as string
    expect(line).not.toContain('\n')
    expect(line.length).toBeLessThan(200)
  })

  it('wakes a stopped holder for an ending', () => {
    const stopped: NotifyState = { feature: { slug: 'export-csv', holderId: 'thread', holderRunning: false } }
    expect(orchestratorLineFor(event('merge.conflict', { files: [] }), stopped)).toContain('merge conflicted')
  })

  it('tells the holder when its draft started by itself, or could not', () => {
    expect(orchestratorLineFor(event('feature.started', { autoStartedBy: 'core' }), held)).toBe(
      '[runcastle] export-csv started by itself because core shipped. Nothing is working on it yet: plan_feature or send_to_feature sets it going.',
    )
    expect(orchestratorLineFor(event('feature.started', {}), held)).toBeNull()
    for (const type of ['feature.autostart.skipped', 'feature.autostart.failed']) {
      expect(orchestratorLineFor(event(type, undefined, { message: "couldn't start by itself: boom" }), held)).toBe(
        `[runcastle] export-csv couldn't start by itself: boom. Read it with get_feature_context({ slug: "export-csv" }).`,
      )
    }
  })

  it('ignores implementation tickets finishing', () => {
    const e = event('ticket.done')
    expect(orchestratorLineFor(e, { ...held, ticket: { seq: 1, kind: 'implementation', passKind: 'review' } })).toBeNull()
  })
})

describe('orchestratorLineFor — act events', () => {
  const cases: [string, EventRow, NotifyState, string][] = [
    [
      'the human’s message starting a chat',
      event('session.process_started', { sessionId: 's', source: 'human' }),
      { ...held, session: chat },
      '[runcastle] export-csv the human is talking to its chat thread; it is busy until that conversation goes quiet.',
    ],
    [
      'the human clicking Plan it yourself',
      event('session.launching', { sessionId: 's', purpose: 'self-plan' }),
      { ...held, session: { ...chat, purpose: 'self-plan' } },
      '[runcastle] export-csv the human had it plan itself. Wait for the run to end.',
    ],
    [
      'the human’s conversation going quiet',
      event('session.process_stopped', { sessionId: 's', reason: 'idle', startedBy: 'human' }),
      { ...held, session: chat },
      `[runcastle] export-csv the human's chat conversation on it went quiet; it is free again. Read it with get_feature_context({ slug: "export-csv" }).`,
    ],
    [
      'a test drive starting',
      event('testdrive.started', { purpose: 'test' }),
      held,
      '[runcastle] export-csv the human started a test drive of it.',
    ],
    [
      'a test drive stopping',
      event('testdrive.stopped', { purpose: 'test' }),
      held,
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
    expect(orchestratorLineFor(e, { ...state, ...unheld })).toBeNull()
  })

  it('does not reach a holder whose process is stopped', () => {
    const stopped: NotifyState = { feature: { slug: 'export-csv', holderId: 'thread', holderRunning: false } }
    expect(orchestratorLineFor(event('testdrive.started'), stopped)).toBeNull()
  })

  it('says nothing of a thread runcastle started, a side thread, or a self-planning run’s stop', () => {
    const started = (source: string) => event('session.process_started', { sessionId: 's', source })
    const stopped = (startedBy: string) => event('session.process_stopped', { sessionId: 's', startedBy })
    expect(orchestratorLineFor(started('runcastle'), { ...held, session: chat })).toBeNull()
    expect(orchestratorLineFor(stopped('runcastle'), { ...held, session: chat })).toBeNull()
    expect(orchestratorLineFor(started('human'), { ...held, session: { ...chat, kind: 'side' } })).toBeNull()
    // A self-planning run's end is its own END event.
    expect(orchestratorLineFor(stopped('human'), { ...held, session: { ...chat, purpose: 'self-plan' } })).toBeNull()
    expect(orchestratorLineFor(event('session.launching', { sessionId: 's' }), { ...held, session: chat })).toBeNull()
  })

  it('says nothing for a cleared waiting reason or the ready reason the ready line covers', () => {
    expect(orchestratorLineFor(event('feature.waiting', { why: null }), held)).toBeNull()
    expect(orchestratorLineFor(event('feature.waiting', { why: 'ready to test' }), held)).toBeNull()
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
    for (const e of all) expect(orchestratorLineFor(e, held) ?? '').not.toMatch(/\b(lap|burn|go)\b/i)
    expect(orchestratorLineFor(event('burn.started'), held)).toBeNull()
  })

  it('leaves the review agent’s drive alone', () => {
    expect(orchestratorLineFor(event('testdrive.started', { purpose: 'review' }), held)).toBeNull()
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

describe('the notifier', () => {
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

  /** A feature `holder` holds. */
  function heldFeature(holder: string, slug = 'demo', overrides: Partial<Feature> = {}): Feature {
    return seedFeature(ctx, projectId, { slug, heldBy: holder, ...overrides })
  }

  /** The lines each runcastle prompt said into the thread, one prompt per entry. */
  async function promptLines(id: string, prompts: number): Promise<string[][]> {
    await vi.waitFor(() => expect(promptsOf(id)).toHaveLength(prompts))
    return promptsOf(id).map((p) => {
      expect(p.source).toBe('runcastle')
      return p.text.split('\n')
    })
  }

  const settle = () => new Promise((r) => setTimeout(r, ORCHESTRATOR_GATHER_MS + 50))

  it('says a held feature’s end event into its holder, starting it', async () => {
    const id = projectSession()
    const feature = heldFeature(id, 'export-csv')

    emit(ctx, feature.id, { type: 'session.self_plan_ended', message: 'planning finished', data: { complete: true } })

    expect(await promptLines(id, 1)).toEqual([
      ['[runcastle] export-csv finished planning. Read it with get_feature_context({ slug: "export-csv" }).'],
    ])
    expect(host.isRunning(id)).toBe(true)
  })

  it('says two events ending together as one prompt with two separate lines', async () => {
    const id = projectSession()
    const feature = heldFeature(id, 'snake-core')

    emit(ctx, feature.id, { type: 'session.self_plan_ended', message: 'x', data: { complete: true } })
    emit(ctx, feature.id, { type: 'run.finished', message: 'x', data: { status: 'succeeded', summary: '5/5 tickets done' } })

    expect(await promptLines(id, 1)).toEqual([
      [
        '[runcastle] snake-core finished planning. Read it with get_feature_context({ slug: "snake-core" }).',
        '[runcastle] snake-core round finished (5/5 tickets done). Read it with list_tickets({ slug: "snake-core" }).',
      ],
    ])
  })

  it('stays quiet about a feature nobody holds, and about acts and merges the holder took itself', async () => {
    const id = projectSession()
    const human = seedFeature(ctx, projectId, { slug: 'human-one' })
    const mine = heldFeature(id, 'mine')

    emit(ctx, human.id, { type: 'feature.shipped', message: 'merged to main' })
    runAsActor('orchestrator', () => emit(ctx, mine.id, { type: 'burn.started', message: 'burning' }))
    runAsActor('orchestrator', () => emit(ctx, mine.id, { type: 'feature.shipped', message: 'merged to main' }))
    runAsActor('orchestrator', () => emit(ctx, mine.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } }))

    await settle()
    expect(promptsOf(id)).toEqual([])
  })

  it('tells the holder and not a newer chat, even when the holder’s process has stopped', async () => {
    const holder = projectSession()
    markSessionEnded(ctx, holder)
    const newest = projectSession()
    const feature = heldFeature(holder)

    emit(ctx, feature.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })

    expect(await promptLines(holder, 1)).toHaveLength(1)
    expect(promptsOf(newest)).toEqual([])
  })

  it('says nothing more once a feature has shipped', async () => {
    const id = projectSession()
    const done = heldFeature(id, 'done', { status: 'shipped' })

    emit(ctx, done.id, { type: 'testdrive.dev_failed', message: 'boom' })

    await settle()
    expect(promptsOf(id)).toEqual([])
  })

  it('tells a running holder about the human’s acts, and does not wake a stopped one for them', async () => {
    const stopped = projectSession()
    const running = projectSession()
    const quiet = heldFeature(stopped, 'quiet')
    const busy = heldFeature(running, 'busy')
    emit(ctx, busy.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })
    await promptLines(running, 1)

    emit(ctx, busy.id, { type: 'testdrive.started', message: 'x' })
    emit(ctx, quiet.id, { type: 'testdrive.started', message: 'x' })

    expect((await promptLines(running, 2))[1]).toEqual(['[runcastle] busy the human started a test drive of it.'])
    await settle()
    expect(promptsOf(stopped)).toEqual([])
    expect(host.isRunning(stopped)).toBe(false)
  })

  it('tells the thread that lost a feature, starting it, and sends the news on to the new holder', async () => {
    const old = projectSession()
    const taker = projectSession()
    setSessionTitle(ctx, taker, 'Phone cut')
    const feature = heldFeature(old, 'export-csv')

    takeHold(ctx, getSessionRow(ctx, taker) as SessionRow, feature)
    expect((await promptLines(old, 1))[0]).toEqual([
      '[runcastle] export-csv was taken by the thread "Phone cut", so you will hear nothing more about it and it is no longer yours to act on.',
    ])
    expect(promptsOf(taker)).toEqual([])

    emit(ctx, feature.id, { type: 'merge.conflict', message: 'x', data: { files: ['a.ts'] } })
    expect(await promptLines(taker, 1)).toHaveLength(1)
    expect(promptsOf(old)).toHaveLength(1)
  })

  it('never lets a failure reach the service that emitted', () => {
    const id = projectSession()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const feature = heldFeature(id)
    ctx.db.delete(sessions).run()

    expect(() => emit(ctx, feature.id, { type: 'feature.shipped', message: 'merged to main' })).not.toThrow()
  })
})
