import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_NEEDS_YOU, type Feature, foldThread } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolDeclareReady, toolDropWorker, toolLandWorker, toolStartWorker } from '../src/mcp/server'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { designPassFetch } from '../src/routes/design-pass'
import { agentSlots, resetAgentSlotsForTests } from '../src/services/agent-slots'
import { listAfter } from '../src/services/events'
import { needOf } from '../src/services/feature-need'
import { archiveFeature, deleteFeature } from '../src/services/features'
import { mergeFeatureFlow } from '../src/services/merge'
import { startNeedWatch } from '../src/services/need-watch'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { appendThreadEvent, readThreadEvents, type AgentHost } from '../src/threads/types'
import { setSandboxEngineForTests } from '../src/workers/engine'
import {
  getWorker,
  startUnassignedWorker,
  stopLeftoverWorkerSandboxes,
  withWorkers,
  workerPreviews,
  workerStopped,
  workerTurnEnded,
  workerTurnSlot,
} from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { commitOn, fakeEngine, fakeHost, git, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * Interactive workers over their whole life (interactive-workers decisions 6,
 * 14, 15, 16, 18, 19): the shared limit of agents working at once, the need a
 * worker raises, a failure's one wake, idle stop and wake, the ready guard,
 * cleanup and the preview. No container: a fake sandbox engine, and where a
 * real agent host matters, an in-process fake ACP agent behind it.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let engine: FakeEngine

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  resetAgentSlotsForTests()
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
})

afterEach(() => {
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  vi.unstubAllEnvs()
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
})

const leadSession = () => getSessionRow(ctx, lead)!

async function startWorker(label = 'Header'): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, leadSession(), {
    label,
    purpose: `The ${label.toLowerCase()}`,
    kind: 'with-you',
    goal: `Build the ${label.toLowerCase()}`,
    doneWhen: 'The human likes it',
  })
  return workerId
}

async function until(done: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done()) {
    if (Date.now() > deadline) throw new Error('never got there')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const status = (id: string) => getWorker(ctx, id)?.status

/** A real agent host over the fake ACP agent, the worker transport and the server's own lifecycle. */
function realHost(fake: FakeAcp): AgentHost {
  engine.transport = fake.transport
  const host = createAgentHost({
    ctx,
    transport: withWorkers(ctx, () => {
      throw new Error('only workers run here')
    }),
    launch: FAKE_LAUNCH,
    lifecycle: threadLifecycle(ctx),
    turnSlot: workerTurnSlot(ctx),
    idleMs: 60_000,
  })
  setAgentHostForTests(host)
  return host
}

/** A fake agent whose turns each wait until the test lets them end, oldest first. */
function heldTurns(): { fake: FakeAcp; release: () => void; waiting: () => number } {
  const gates: (() => void)[] = []
  const fake = createFakeAcp({
    turn: async (t) => {
      await new Promise<void>((resolve) => gates.push(resolve))
      await t.say('Done.')
    },
  })
  return { fake, release: () => gates.shift()?.(), waiting: () => gates.length }
}

describe('one limit for agents working at once', () => {
  beforeEach(() => {
    ctx.config = { ...ctx.config, burnConcurrency: 1 }
  })

  it('queues a second worker behind one mid-turn, and starts it by itself when the slot frees', async () => {
    const turns = heldTurns()
    const host = realHost(turns.fake)
    const a = await startWorker('Header')
    await until(() => turns.waiting() === 1)
    const b = await startWorker('Thread list')
    await until(() => status(b) === 'queued')
    expect(status(a)).toBe('working')
    expect(turns.waiting()).toBe(1)

    turns.release()
    await until(() => status(a) === 'needs-you')
    await until(() => turns.waiting() === 1)
    expect(status(b)).toBe('working')
    expect(listAfter(ctx, feature.id, 0).filter((e) => e.type === 'worker.status' && (e.data as { workerId: string }).workerId === b).map((e) => (e.data as { status: string }).status)).toEqual(['queued', 'working'])

    // A worker waiting on the human holds no slot: a third starts at once.
    turns.release()
    await until(() => status(b) === 'needs-you')
    const c = await startWorker('Footer')
    await until(() => turns.waiting() === 1)
    expect(status(c)).toBe('working')
    turns.release()
    await host.stopAll('shutdown')
  })

  it('counts a ticket agent mid-run, and a stopped worker holds no slot', async () => {
    const turns = heldTurns()
    const host = realHost(turns.fake)
    const ticketAgent = agentSlots(ctx.config.burnConcurrency).occupy()
    const a = await startWorker()
    await until(() => status(a) === 'queued')
    expect(turns.waiting()).toBe(0)

    ticketAgent()
    await until(() => turns.waiting() === 1)
    expect(status(a)).toBe('working')

    // Stopping the worker mid-turn gives its slot back.
    await host.stop(a, 'archived')
    expect(agentSlots(ctx.config.burnConcurrency).held()).toBe(0)
    await host.stopAll('shutdown')
  })
})

describe('a worker that needs the human', () => {
  it('raises the feature need once per entry, naming the worker and opening its thread', async () => {
    setAgentHostForTests(fakeHost().host)
    const watch = startNeedWatch(ctx)
    try {
      const a = await startWorker('Header')
      await workerTurnEnded(ctx, { id: a })
      expect(needOf(ctx, feature)).toMatchObject({ kind: 'worker', words: 'Header needs you', threadId: a, held: false })

      const pings = () => listAfter(ctx, feature.id, 0).filter((e) => e.type === FEATURE_NEEDS_YOU).map((e) => e.data)
      await until(() => pings().length === 1)
      expect(pings()).toEqual([{ kind: 'worker', words: 'Header needs you', held: false, why: 'Header', threadId: a }])

      // A second worker coming to need the human is news of its own.
      await new Promise((r) => setTimeout(r, 5))
      const b = await startWorker('Footer')
      await workerTurnEnded(ctx, { id: b })
      await until(() => pings().length === 2)
      expect(pings()[1]).toMatchObject({ words: 'Footer needs you', threadId: b })

      // The same worker ending another turn still waiting on the human pings nothing more.
      await workerTurnEnded(ctx, { id: b })
      await new Promise((r) => setTimeout(r, 120))
      expect(pings()).toHaveLength(2)
    } finally {
      watch.stop()
    }
  })

  it('raises no need for a "+" worker that has only said hello, until the human writes to it (decision 25)', async () => {
    setAgentHostForTests(fakeHost().host)
    const { workerId } = await startUnassignedWorker(ctx, feature.id)
    await workerTurnEnded(ctx, { id: workerId })
    expect(getWorker(ctx, workerId)?.status).toBe('needs-you')
    expect(needOf(ctx, feature)).toBeNull()

    appendThreadEvent(workerId, { type: 'prompt', id: 'p_human', text: 'Make the footer grey', source: 'human' })
    expect(needOf(ctx, feature)).toMatchObject({ kind: 'worker', threadId: workerId })
  })

  it('raises a permission need when its agent waits on an approval, opening the worker', async () => {
    // In auto mode, what the checker or the human's own ask rules still ask is the human's to answer.
    const asked = createFakeAcp({
      mode: 'auto',
      turn: async (t) => void (await t.permission({ toolCallId: 'p1', title: 'git push --force origin HEAD:main', kind: 'execute' })),
    })
    const host = realHost(asked)
    const id = await startWorker()
    await until(() => foldThread(readThreadEvents(id)).ask?.kind === 'approval')
    expect(needOf(ctx, feature)).toMatchObject({ kind: 'permission', threadId: id })
    await host.stop(id, 'archived')
  })
})

describe('a worker waiting on an ask', () => {
  it('reads needs-you while the ask is open and working once it is answered, with the one permission ping', async () => {
    let finish!: () => void
    const asked = createFakeAcp({
      mode: 'auto',
      turn: async (t) => {
        await t.permission({ toolCallId: 'p1', title: 'git push origin HEAD', kind: 'execute' })
        await new Promise<void>((resolve) => (finish = resolve))
        await t.say('Pushed.')
      },
    })
    const host = realHost(asked)
    const watch = startNeedWatch(ctx)
    const pings = () => listAfter(ctx, feature.id, 0).filter((e) => e.type === FEATURE_NEEDS_YOU).map((e) => e.data)
    const id = await startWorker()
    try {
      await until(() => foldThread(readThreadEvents(id)).ask?.kind === 'approval')
      expect(status(id)).toBe('needs-you')
      await until(() => pings().length === 1)
      expect(pings()[0]).toMatchObject({ kind: 'permission' })

      await host.answer(id, foldThread(readThreadEvents(id)).ask!.id, { kind: 'approval', choice: 'allow' })
      expect(status(id)).toBe('working')
      await new Promise((r) => setTimeout(r, 120))
      // The worker leaving and the ask closing together are no news.
      expect(pings()).toHaveLength(1)

      finish()
      await until(() => readThreadEvents(id).some((e) => e.type === 'turn_ended'))
      await until(() => status(id) === 'needs-you')
    } finally {
      watch.stop()
      await host.stop(id, 'archived')
    }
  })
})

describe('a failed worker', () => {
  it('is marked failed with what failed, and wakes its lead exactly once', async () => {
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const id = await startWorker()
    appendThreadEvent(id, { type: 'process', state: 'stopped', error: 'its sandbox runcastle-worker-x is gone' })
    await workerStopped(ctx, { id }, 'crashed')
    await workerStopped(ctx, { id }, 'crashed')

    expect(getWorker(ctx, id)).toMatchObject({ status: 'failed', failure: 'its sandbox runcastle-worker-x is gone' })
    const toLead = host.sent.filter((s) => s.threadId === lead)
    expect(toLead).toHaveLength(1)
    expect(toLead[0]?.display).toEqual({ workerFailed: { workerId: id, label: 'Header', failure: 'its sandbox runcastle-worker-x is gone' } })
    expect(needOf(ctx, feature)).toMatchObject({ kind: 'worker', threadId: id })
  })
})

describe('idle stop and wake', () => {
  it('stops the sandbox on idle; a message restarts it and reloads the same conversation', async () => {
    const fake = createFakeAcp()
    const host = realHost(fake)
    const id = await startWorker()
    await until(() => status(id) === 'needs-you')
    const conversation = getSessionRow(ctx, id)!.ccSessionId
    const container = getWorker(ctx, id)!.container!

    await host.stop(id, 'idle')
    await until(() => engine.stopped.includes(container))

    await host.prompt(id, { text: 'Make it taller' }, { source: 'human' })
    await until(() => readThreadEvents(id).filter((e) => e.type === 'turn_ended').length === 2)
    expect(engine.woken.filter((c) => c === container)).toHaveLength(2)
    expect(fake.last().received[1]).toMatchObject({ method: 'session/load', params: { sessionId: conversation } })
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe(conversation)
    await host.stopAll('shutdown')
  })

  it('asks inside the sandbox when a reload fails, and starts no new conversation over one still there', async () => {
    const fake = createFakeAcp()
    const host = realHost(fake)
    const id = await startWorker()
    await until(() => status(id) === 'needs-you')
    const conversation = getSessionRow(ctx, id)!.ccSessionId!
    await host.stop(id, 'idle')

    // The host disk never holds a worker's transcript; the sandbox does.
    engine.conversations.add(conversation)
    fake.script.gone = true
    await host.prompt(id, { text: 'Still there?' }, { source: 'human' })
    await until(() => readThreadEvents(id).filter((e) => e.type === 'process' && e.state === 'stopped').length >= 2)
    expect(fake.last().received.map((r) => r.method)).toEqual(['initialize', 'session/load'])
    expect(foldThread(readThreadEvents(id)).items.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('would not reopen') })
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe(conversation)
    await host.stopAll('shutdown')
  })
})

describe('a server restart', () => {
  it('stops every worker sandbox the last server left running and removes a gone worker’s leftover, touching nothing else', async () => {
    setAgentHostForTests(fakeHost().host)
    const running = await startWorker('Header')
    const asleep = await startWorker('Footer')
    const gone = await startWorker('Sidebar')
    const containerOf = (id: string) => getWorker(ctx, id)!.container!
    engine.held.set(containerOf(asleep), false)
    await toolDropWorker(ctx, leadSession(), { workerId: gone })
    // A container the drop did not get, and another install's worker on the same engine.
    engine.held.set(containerOf(gone), true)
    engine.held.set('runcastle-worker-elsewhere', true)
    engine.stopped.length = 0
    engine.removed.length = 0

    expect(await stopLeftoverWorkerSandboxes(ctx)).toEqual({ stopped: 1, removed: 1 })
    expect(engine.stopped).toEqual([containerOf(running)])
    expect(engine.removed).toEqual([containerOf(gone)])
    expect(engine.held.get('runcastle-worker-elsewhere')).toBe(true)
    expect(getWorker(ctx, running)?.status).toBe('working')
    const swept = listAfter(ctx, feature.id, 0).filter((e) => e.type === 'worker.stopped' || e.type === 'worker.sandbox_removed')
    expect(swept.map((e) => [e.type, (e.data as { workerId: string }).workerId])).toEqual([
      ['worker.stopped', running],
      ['worker.sandbox_removed', gone],
    ])

    // A second boot finds nothing left to do.
    expect(await stopLeftoverWorkerSandboxes(ctx)).toEqual({ stopped: 0, removed: 0 })
  })

  it('leaves a sandbox whose agent still runs (a hot reload kept it)', async () => {
    const host = fakeHost()
    setAgentHostForTests({ ...host.host, isRunning: () => true } as AgentHost)
    const id = await startWorker()
    expect(await stopLeftoverWorkerSandboxes(ctx)).toEqual({ stopped: 0, removed: 0 })
    expect(engine.held.get(getWorker(ctx, id)!.container!)).toBe(true)
  })
})

describe('declare_ready', () => {
  it('is refused while a worker works or holds work not landed, naming the workers', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker('Header')
    expect(() => toolDeclareReady(ctx, leadSession(), { scenario: 'smoke' })).toThrow(/Header.*working/)

    commitOn(repo, getWorker(ctx, id)!.branch!, 'header.txt', 'header\n', 'feat: header')
    engine.handbacks.set(id, { summary: 'Done', at: Date.now() })
    await workerTurnEnded(ctx, { id })
    expect(() => toolDeclareReady(ctx, leadSession(), { scenario: 'smoke' })).toThrow(/Header.*handed-back/)

    await toolLandWorker(ctx, leadSession(), { workerId: id })
    expect(toolDeclareReady(ctx, leadSession(), { scenario: 'smoke' })).toMatchObject({ ok: true })
  })
})

describe('cleanup', () => {
  it('archiving the feature removes every worker’s container and branch and drops the open ones', async () => {
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const id = await startWorker()
    const { container, branch } = getWorker(ctx, id)!
    await archiveFeature(ctx, feature.id)
    expect(engine.removed).toEqual([container])
    expect(git(repo, 'branch', '--list', branch!)).toBe('')
    expect(getWorker(ctx, id)).toMatchObject({ status: 'dropped' })
    expect(host.stopped).toContain(id)
  })

  it('deleting the feature removes the workers’ sandboxes and their rows', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    const { container } = getWorker(ctx, id)!
    await deleteFeature(ctx, feature.id)
    expect(engine.removed).toEqual([container])
    expect(getWorker(ctx, id)).toBeUndefined()
  })

  it('merging the feature removes its workers, a landed one keeping its record', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    const { container } = getWorker(ctx, id)!
    commitOn(repo, getWorker(ctx, id)!.branch!, 'header.txt', 'header\n', 'feat: header')
    engine.handbacks.set(id, { summary: 'Done', at: Date.now() })
    await workerTurnEnded(ctx, { id })
    await toolLandWorker(ctx, leadSession(), { workerId: id })

    expect(await mergeFeatureFlow(ctx, feature.id)).toMatchObject({ ok: true })
    expect(engine.removed).toEqual([container])
    expect(getWorker(ctx, id)?.status).toBe('landed')
  })

  it('dropping a worker twice is fine', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(getWorker(ctx, id)?.status).toBe('dropped')
    expect(listAfter(ctx, feature.id, 0).filter((e) => e.type === 'worker.dropped')).toHaveLength(1)
  })
})

describe('the preview through the design pass-through', () => {
  const PASS = 'http://127.0.0.1:4514'

  it('is addressed by worker id, forwards to the worker’s published port, and wakes its sandbox but not its agent', async () => {
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const id = await startWorker()
    const before = host.sent.length
    const { container } = getWorker(ctx, id)!

    const open = await designPassFetch(new Request(`${PASS}/__runcastle/open/worker/${id}?path=/`), () => undefined, workerPreviews(ctx))
    expect(open.status).toBe(302)
    const cookie = open.headers.get('set-cookie')!.split(';')[0]!

    const forwarded: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      forwarded.push(String(input))
      return new Response('<h1>header</h1>', { status: 200, headers: { 'content-type': 'text/html' } })
    })
    try {
      const page = await designPassFetch(new Request(`${PASS}/index.html`, { headers: { cookie } }), () => undefined, workerPreviews(ctx))
      expect(await page.text()).toBe('<h1>header</h1>')
    } finally {
      fetchSpy.mockRestore()
    }
    expect(forwarded).toEqual(['http://127.0.0.1:41001/index.html'])
    expect(engine.woken).toEqual([container])
    expect(host.sent).toHaveLength(before)
  })

  it('stops the sandbox it woke once the preview goes unopened, and serves nothing for a dropped worker', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    const { container } = getWorker(ctx, id)!
    await workerPreviews(ctx, 10).wake(id)
    await until(() => engine.stopped.includes(container))

    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(workerPreviews(ctx).url(id)).toBeUndefined()
  })

  it('is on worker.list as the pass-through path once the worker has started its dev server', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    const list = () => createCallerFactory(appRouter)(ctx).worker.list({ featureId: feature.id })
    expect((await list())[0]).toMatchObject({ id, previewPath: null })
    engine.devServers.add(id)
    await workerTurnEnded(ctx, { id })
    expect((await list())[0]).toMatchObject({ id, previewPath: `/__runcastle/open/worker/${encodeURIComponent(id)}`, passPort: ctx.config.serverPort + 2 })
  })
})
