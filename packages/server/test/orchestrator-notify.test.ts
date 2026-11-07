import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EventRow, Feature, Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { emit, emitProject, runAsActor } from '../src/services/events'
import {
  ORCHESTRATOR_GATHER_MS,
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
 * What a thread hears from runcastle (`agents-are-woken-only-when-it-matters`
 * decisions 19, 23): only machine events about its own work, each waking it.
 * Everything else comes from a lead's `hand_back`.
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

const held: NotifyState = { feature: { slug: 'export-csv', title: 'Export CSV', holderId: 'thread' } }
const unheld: NotifyState = { feature: { slug: 'export-csv', title: 'Export CSV', holderId: null } }
const byOrchestrator = { actor: 'orchestrator' }

describe('orchestratorLineFor — the orchestrator’s own work', () => {
  const cases: [string, EventRow, string][] = [
    [
      'a drive it started failing to start',
      event('testdrive.dev_failed', byOrchestrator, { message: 'dev server failed to start: boom' }),
      '[runcastle] export-csv the drive you started failed: dev server failed to start: boom. Read it with get_feature_context({ slug: "export-csv" }).',
    ],
    [
      'a draft it holds starting by itself',
      event('feature.started', { autoStartedBy: 'core' }),
      '[runcastle] export-csv started by itself because core shipped. Nothing is working on it yet: plan_feature or send_to_feature sets it going, unless its brief says grill with you: then hand the human its chat.',
    ],
    [
      'a draft it holds not starting',
      event('feature.autostart.failed', undefined, { message: "couldn't start by itself: boom" }),
      `[runcastle] export-csv couldn't start by itself: boom. Read it with get_feature_context({ slug: "export-csv" }).`,
    ],
    [
      'its message not reaching a lead',
      event('lead.wake_failed', byOrchestrator, { message: 'could not reach the agent’s chat: no runtime' }),
      '[runcastle] export-csv could not wake its agent, so your message has not reached it yet (could not reach the agent’s chat: no runtime). Read it with get_feature_context({ slug: "export-csv" }).',
    ],
  ]

  it.each(cases)('%s', (_name, e, line) => {
    expect(orchestratorLineFor(e, held)).toBe(line)
  })

  it.each(cases)('%s says nothing on a feature it does not hold', (_name, e) => {
    expect(orchestratorLineFor(e, unheld)).toBeNull()
  })

  it('says nothing of a drive or a failed wake the orchestrator did not cause', () => {
    expect(orchestratorLineFor(event('testdrive.dev_failed', undefined, { message: 'boom' }), held)).toBeNull()
    expect(orchestratorLineFor(event('lead.wake_failed', undefined, { message: 'boom' }), held)).toBeNull()
  })

  it('says nothing of a draft that was started by hand', () => {
    expect(orchestratorLineFor(event('feature.started', {}), held)).toBeNull()
  })
})

describe('orchestratorLineFor — what no longer reaches it (decisions 19, 20, 23)', () => {
  const gone: [string, EventRow][] = [
    ['a lead waiting for the human', event('feature.waiting', { why: 'start round 1?' })],
    ['a lead declaring ready', event('feature.ready_declared', { scenario: 'x' })],
    ['a planning run ending', event('session.self_plan_ended', { complete: true })],
    ['a round finishing', event('run.finished', { status: 'succeeded' })],
    ['a round failing', event('run.finished', { status: 'failed' })],
    ['a round cut off by a restart', event('run.reconciled', { workflow: 'ticket-burner' })],
    ['a review pass finishing', event('ticket.done')],
    ['the human merging', event('feature.shipped')],
    ['a merge conflicting', event('merge.conflict', { files: [] })],
    ['a conflict resolved', event('merge.resolved', { mergeFrom: 'main', mergeInto: 'feature/x' })],
    ['a drive the human started failing', event('testdrive.dev_failed')],
    ['another chat taking the feature', event('feature.taken', { from: 'thread', name: 'Phone cut' })],
    ['the human talking to a chat', event('session.process_started', { sessionId: 's', source: 'human' })],
    ['the human’s chat going quiet', event('session.process_stopped', { sessionId: 's', startedBy: 'human' })],
    ['the human starting a drive', event('testdrive.started')],
    ['the human having it plan itself', event('session.launching', { sessionId: 's', purpose: 'self-plan' })],
  ]

  it.each(gone)('%s says nothing', (_name, e) => {
    expect(orchestratorLineFor(e, held)).toBeNull()
  })

  it('says nothing for any project event', () => {
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

  /** A live orchestrator — the orchestrator. */
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

  it('says its own work’s event into the holder, starting it', async () => {
    const id = projectSession()
    markSessionEnded(ctx, id)
    const feature = heldFeature(id, 'export-csv')

    emit(ctx, feature.id, { type: 'feature.started', message: 'started', data: { autoStartedBy: 'core' } })

    const [lines] = await promptLines(id, 1)
    expect(lines[0]).toMatch(/^\[runcastle\] export-csv started by itself because core shipped/)
    expect(promptsOf(id)[0]).toMatchObject({ display: { news: [{ featureId: feature.id, events: [{ words: 'Started by itself after core shipped' }] }] } })
    await vi.waitFor(() => expect(host.isRunning(id)).toBe(true))
  })

  it('says two of its events ending together as one prompt with two lines', async () => {
    const id = projectSession()
    const feature = heldFeature(id, 'snake-core')

    runAsActor('orchestrator', () => {
      emit(ctx, feature.id, { type: 'lead.wake_failed', message: 'no runtime' })
      emit(ctx, feature.id, { type: 'testdrive.dev_failed', message: 'boom' })
    })

    expect((await promptLines(id, 1))[0]).toHaveLength(2)
  })

  it('stays quiet about everything else, and about a feature nobody holds', async () => {
    const id = projectSession()
    const mine = heldFeature(id, 'mine')
    const nobodys = seedFeature(ctx, projectId, { slug: 'nobodys' })

    emit(ctx, mine.id, { type: 'feature.ready_declared', message: 'ready' })
    emit(ctx, mine.id, { type: 'run.finished', message: 'x', data: { status: 'failed' } })
    emit(ctx, mine.id, { type: 'feature.waiting', message: 'x', data: { why: 'start round 1?' } })
    emit(ctx, nobodys.id, { type: 'feature.started', message: 'x', data: { autoStartedBy: 'core' } })
    emitProject(ctx, projectId, { type: 'project.renamed', message: 'x' })

    await settle()
    expect(promptsOf(id)).toEqual([])
  })

  it('says nothing more once a feature has shipped, except that its drafts could not start', async () => {
    const id = projectSession()
    const done = heldFeature(id, 'done', { status: 'shipped' })

    runAsActor('orchestrator', () => emit(ctx, done.id, { type: 'testdrive.dev_failed', message: 'boom' }))
    await settle()
    expect(promptsOf(id)).toEqual([])

    emit(ctx, done.id, { type: 'feature.autostart.failed', message: "couldn't start up-next dependents: boom" })
    expect(await promptLines(id, 1)).toEqual([
      [`[runcastle] done couldn't start up-next dependents: boom. Read it with get_feature_context({ slug: "done" }).`],
    ])
  })

  it('never lets a failure reach the service that emitted', () => {
    const id = projectSession()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const feature = heldFeature(id)
    ctx.db.delete(sessions).run()

    expect(() => emit(ctx, feature.id, { type: 'feature.started', message: 'x', data: { autoStartedBy: 'core' } })).not.toThrow()
  })
})
