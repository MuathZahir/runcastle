import { createServer, type Server } from 'node:net'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_WINDOW_MS, FEATURE_NEEDS_YOU, type Feature, foldThread } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markAgentWorking, markAwaitingInput, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolDeclareReady, toolDropWorker, toolLandWorker, toolMessageWorker, toolStartWorker, toolWaitForYou } from '../src/mcp/server'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { designPassFetch } from '../src/routes/design-pass'
import { agentSlots, resetAgentSlotsForTests } from '../src/services/agent-slots'
import { listAfter } from '../src/services/events'
import { needOf } from '../src/services/feature-need'
import { archiveFeature, deleteFeature, markHumanMessage, stopFeature } from '../src/services/features'
import { mergeFeatureFlow } from '../src/services/merge'
import { startNeedWatch } from '../src/services/need-watch'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { appendThreadEvent, readThreadEvents, type AgentHost } from '../src/threads/types'
import { writeHostHandback } from '../src/workers/review'
import { sweepLeftovers } from '../src/workers/sweep'
import {
  getWorker,
  shownStatusOf,
  workerPrompted,
  startUnassignedWorker,
  workerPreviews,
  workerFolder,
  workerStopped,
  workerTurnEnded,
  workerTurnSlot,
} from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { fakeHost, git, initRepo } from './support/fake-workers'

/**
 * Interactive workers over their whole life (interactive-workers decisions 6,
 * 14, 15, 16, 18, 19): the shared limit of agents working at once, the need a
 * worker raises, a failure's one wake, idle stop and wake, the ready guard,
 * cleanup and the preview. Workers run on the host now (workers-build-in-the-feature-s-folder):
 * the first in the feature's folder, a later one in a folder of its own. No container; where a
 * real agent host matters, an in-process fake ACP agent behind it.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  resetAgentSlotsForTests()
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
})

afterEach(() => {
  setAgentHostForTests(undefined)
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

/** Commit a file in the folder a worker builds in, as its agent would. */
function commitIn(folder: string, file: string, body: string, subject: string): void {
  writeFileSync(join(folder, file), body)
  git(folder, 'add', file)
  git(folder, 'commit', '-q', '-m', subject)
}

const folderOf = (id: string) => getWorker(ctx, id)!.folder!

/** A host worker's handback, as its own `hand_back` leaves it for the turn's end to read. */
async function handBack(id: string, summary = 'Done'): Promise<void> {
  writeHostHandback(id, summary)
  await workerTurnEnded(ctx, { id })
}

const status = (id: string) => getWorker(ctx, id)?.status
const turnEnded = (id: string) => readThreadEvents(id).some((e) => e.type === 'turn_ended')

/** A real agent host over the fake ACP agent, the worker transport and the server's own lifecycle. */
function realHost(fake: FakeAcp): AgentHost {
  const host = createAgentHost({
    ctx,
    // A host worker's agent comes from the base transport: the fake agent.
    transport: fake.transport,
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
    await until(() => turnEnded(a))
    await until(() => turns.waiting() === 1)
    expect(status(b)).toBe('working')
    expect(listAfter(ctx, feature.id, 0).filter((e) => e.type === 'worker.status' && (e.data as { workerId: string }).workerId === b).map((e) => (e.data as { status: string }).status)).toEqual(['queued', 'working'])

    // A worker with no turn running holds no slot: a third starts at once.
    turns.release()
    await until(() => turnEnded(b))
    const c = await startWorker('Footer')
    await until(() => turns.waiting() === 1)
    expect(status(c)).toBe('working')
    turns.release()
    await host.stopAll('shutdown')
  })

  it('takes a waiting turn cancelled before its slot comes out of the line at once (one-number decision 5)', async () => {
    const turns = heldTurns()
    const host = realHost(turns.fake)
    const slots = agentSlots(ctx.config.burnConcurrency)
    const a = await startWorker('Header')
    await until(() => turns.waiting() === 1)
    const b = await startWorker('Thread list')
    await until(() => status(b) === 'queued')
    expect(slots.snapshot().waiting.map((e) => e.holder)).toEqual([b])

    await host.cancel(b)
    // Out of the line while the slot it waited for is still held, and idle, not queued.
    expect(slots.snapshot().waiting).toEqual([])
    expect(slots.snapshot().holding.map((e) => e.holder)).toEqual([a])
    await until(() => status(b) === 'working')

    turns.release()
    await until(() => turnEnded(a))
    expect(slots.held()).toBe(0)
    expect(turns.waiting()).toBe(0)
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

describe("the feature's Stop (burns-become-workers decision 15)", () => {
  beforeEach(() => {
    ctx.config = { ...ctx.config, burnConcurrency: 1 }
  })

  it('cancels the working and the queued worker, leaves both enterable, and starts nothing until the human replies', async () => {
    const started: string[] = []
    const fake = createFakeAcp({
      turn: async (t) => {
        started.push(t.sessionId)
        await t.cancelled
        return 'cancelled'
      },
    })
    const host = realHost(fake)
    const a = await startWorker('Header')
    await until(() => started.length === 1)
    const b = await startWorker('Thread list')
    await until(() => status(b) === 'queued')

    await stopFeature(ctx, feature.id)

    // Both read idle: the human stopped them, so nothing needs the human (needs-you decision 10).
    expect(status(a)).toBe('working')
    expect(status(b)).toBe('working')
    expect(needOf(ctx, feature)).toBeNull()
    await until(() => agentSlots(ctx.config.burnConcurrency).held() === 0)
    // The queued turn never reached its agent, even once the slot it waited for freed.
    await new Promise((r) => setTimeout(r, 30))
    expect(started).toHaveLength(1)
    const logB = readThreadEvents(b)
    expect(logB.some((e) => e.type === 'turn_started')).toBe(false)
    expect(logB.find((e) => e.type === 'turn_ended')).toMatchObject({ reason: 'cancelled' })
    // Both stay enterable: their threads and folders are where they were.
    expect(getWorker(ctx, a)?.status).not.toBe('failed')

    await expect(startWorker('Footer')).rejects.toThrow('Stopped by the human')
    await expect(toolMessageWorker(ctx, leadSession(), { workerId: a, text: 'go on' })).rejects.toThrow('Stopped by the human')

    await new Promise((r) => setTimeout(r, 2))
    markHumanMessage(ctx, feature.id)
    await toolMessageWorker(ctx, leadSession(), { workerId: a, text: 'go on' })
    await until(() => started.length === 2)
    await host.stopAll('shutdown')
  })
})

describe('a worker that needs the human', () => {
  /** The worker's own `wait_for_you`, as its agent's tool reaches the server. */
  const waitForYou = (id: string, args: Record<string, unknown>) =>
    toolWaitForYou(ctx, getSessionRow(ctx, id)!, args as never)

  it('reads idle with no need, not working, when its turn ends without a handback', async () => {
    setAgentHostForTests(fakeHost().host)
    const a = await startWorker('Header')
    await workerTurnEnded(ctx, { id: a })
    expect(shownStatusOf(ctx, getWorker(ctx, a)!)).toBe('idle')
    expect(needOf(ctx, feature)).toBeNull()
  })

  it('needs the human once it calls wait_for_you: its feature’s need opens its thread, pinging once per entry', async () => {
    setAgentHostForTests(fakeHost().host)
    const watch = startNeedWatch(ctx)
    try {
      const a = await startWorker('Header')
      await waitForYou(a, { why: 'Is the API key in the vault?' })
      expect(status(a)).toBe('needs-you')
      expect(needOf(ctx, feature)).toMatchObject({ why: 'Is the API key in the vault?', threadId: a, by: 'agent' })
      const pings = () => listAfter(ctx, feature.id, 0).filter((e) => e.type === FEATURE_NEEDS_YOU).map((e) => e.data)
      await until(() => pings().length === 1)
      expect(pings()).toEqual([{ why: 'Is the API key in the vault?', threadId: a, by: 'agent', featureId: feature.id }])

      // A newer worker's wait is the feature's need, and news of its own.
      await new Promise((r) => setTimeout(r, 5))
      const b = await startWorker('Footer')
      await waitForYou(b, { why: 'Grey or white?' })
      await until(() => pings().length === 2)
      expect(needOf(ctx, feature)).toMatchObject({ threadId: b })

      // Its turn ending pings nothing more.
      await workerTurnEnded(ctx, { id: b })
      await new Promise((r) => setTimeout(r, 120))
      expect(pings()).toHaveLength(2)
    } finally {
      watch.stop()
    }
  })

  it('keeps needing the human through the lead’s message, and stops once the human writes to it or it withdraws', async () => {
    setAgentHostForTests(fakeHost().host)
    const a = await startWorker('Header')
    await waitForYou(a, { why: 'Grey or white?' })
    await toolMessageWorker(ctx, leadSession(), { workerId: a, text: 'carry on' })
    expect(status(a)).toBe('needs-you')
    expect(needOf(ctx, feature)).toMatchObject({ threadId: a })

    threadLifecycle(ctx).humanPrompted!(getSessionRow(ctx, a)!)
    workerPrompted(ctx, a)
    expect(needOf(ctx, feature)).toBeNull()
    expect(status(a)).toBe('working')

    await waitForYou(a, { why: 'Grey or white?' })
    await waitForYou(a, { withdraw: true })
    expect(needOf(ctx, feature)).toBeNull()
    expect(status(a)).toBe('working')
  })

  it('a "+" worker that has only said hello needs nothing', async () => {
    setAgentHostForTests(fakeHost().host)
    const { workerId } = await startUnassignedWorker(ctx, feature.id)
    await workerTurnEnded(ctx, { id: workerId })
    expect(getWorker(ctx, workerId)?.status).toBe('working')
    expect(needOf(ctx, feature)).toBeNull()
  })

  it('a permission request raises no need: the host allows it and the worker stays working', async () => {
    // Even in auto mode, what the checker or the human's own ask rules still ask is answered by the host.
    let answer: unknown
    const asked = createFakeAcp({
      mode: 'auto',
      turn: async (t) => void (answer = (await t.permission({ toolCallId: 'p1', title: 'git push --force origin HEAD:main', kind: 'execute' })).outcome),
    })
    const host = realHost(asked)
    const id = await startWorker()
    await until(() => answer !== undefined)
    expect(answer).toEqual({ outcome: 'selected', optionId: 'allow-once' })
    expect(foldThread(readThreadEvents(id)).ask).toBeUndefined()
    expect(status(id)).toBe('working')
    expect(needOf(ctx, feature)).toBeNull()
    await host.stop(id, 'archived')
  })

  it('raises a need when its agent asks the human a question, opening the worker', async () => {
    const asked = createFakeAcp({
      mode: 'auto',
      turn: async (t) => void (await t.ask([{ header: 'Branch', question: 'Which branch should it push to?', options: ['main', 'release'] }])),
    })
    const host = realHost(asked)
    const id = await startWorker()
    await until(() => foldThread(readThreadEvents(id)).ask?.kind === 'question')
    expect(needOf(ctx, feature)).toMatchObject({ why: 'Which branch should it push to?', threadId: id })
    await host.stop(id, 'archived')
  })
})

describe('a worker whose turn ends with background work still running', () => {
  const BACKGROUND = { reason: 'end_turn', background: true } as const

  it('stays working, and hands back from the turn it starts by itself when that work finishes', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker('Review')
    await workerTurnEnded(ctx, { id }, BACKGROUND)
    expect(status(id)).toBe('working')

    writeHostHandback(id, 'Checks green, two findings')
    await workerTurnEnded(ctx, { id }, { reason: 'end_turn' })
    expect(status(id)).toBe('handed-back')
  })

  it('never comes to need the human by itself, however long the work runs', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker('Review')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await workerTurnEnded(ctx, { id }, BACKGROUND)
      markAwaitingInput(ctx, id)
      vi.advanceTimersByTime(BACKGROUND_WINDOW_MS * 3)
      expect(status(id)).toBe('working')
      expect(needOf(ctx, feature)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a turn that starts while the last one’s end is still being read', () => {
  it('leaves the worker working: the newer turn reports at its own end', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker('Review')
    markAwaitingInput(ctx, id)
    const ending = workerTurnEnded(ctx, { id }, { reason: 'end_turn' })
    // A send-back or a queued message starts the next turn before the handback read finishes.
    markAgentWorking(ctx, id)
    await ending
    expect(status(id)).toBe('working')
  })
})

describe('a worker waiting on an ask', () => {
  it('reads needs-you while the ask is open and working once it is answered, with the one needs-you ping', async () => {
    let finish!: () => void
    const asked = createFakeAcp({
      mode: 'auto',
      turn: async (t) => {
        await t.ask([{ header: 'Branch', question: 'Push to which branch?', options: ['main', 'release'] }])
        await new Promise<void>((resolve) => (finish = resolve))
        await t.say('Pushed.')
      },
    })
    const host = realHost(asked)
    const watch = startNeedWatch(ctx)
    const pings = () => listAfter(ctx, feature.id, 0).filter((e) => e.type === FEATURE_NEEDS_YOU).map((e) => e.data)
    const id = await startWorker()
    try {
      await until(() => foldThread(readThreadEvents(id)).ask?.kind === 'question')
      expect(status(id)).toBe('needs-you')
      await until(() => pings().length === 1)
      expect(pings()[0]).toMatchObject({ why: 'Push to which branch?', threadId: id })

      await host.answer(id, foldThread(readThreadEvents(id)).ask!.id, { kind: 'question', answers: { 'Push to which branch?': 'main' } })
      expect(status(id)).toBe('working')
      await new Promise((r) => setTimeout(r, 120))
      // The worker leaving and the ask closing together are no news.
      expect(pings()).toHaveLength(1)

      finish()
      await until(() => readThreadEvents(id).some((e) => e.type === 'turn_ended'))
      await until(() => turnEnded(id))
      expect(status(id)).toBe('working')
    } finally {
      watch.stop()
      await host.stop(id, 'archived')
    }
  })
})

describe('a failed worker', () => {
  it('is marked failed with what failed, wakes its lead exactly once, and needs nobody else', async () => {
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const id = await startWorker()
    appendThreadEvent(id, { type: 'process', state: 'stopped', error: 'its agent stopped: connection lost' })
    await workerStopped(ctx, { id }, 'crashed')
    await workerStopped(ctx, { id }, 'crashed')

    expect(getWorker(ctx, id)).toMatchObject({ status: 'failed', failure: 'its agent stopped: connection lost' })
    const toLead = host.sent.filter((s) => s.threadId === lead)
    expect(toLead).toHaveLength(1)
    expect(toLead[0]?.display).toEqual({ workerFailed: { workerId: id, label: 'Header', failure: 'its agent stopped: connection lost' } })
    // The lead decides whether the human hears of it (needs-you decision 9).
    expect(needOf(ctx, feature)).toBeNull()
  })
})

describe('idle stop and wake', () => {
  it('leaves a host worker’s folder alone on idle; a message starts its agent again and reloads the same conversation', async () => {
    const fake = createFakeAcp()
    const host = realHost(fake)
    const id = await startWorker()
    await until(() => turnEnded(id))
    const conversation = getSessionRow(ctx, id)!.ccSessionId
    const folder = folderOf(id)

    await host.stop(id, 'idle')
    // Stopping the agent leaves the folder and the worker as they were.
    expect(existsSync(folder)).toBe(true)
    expect(getWorker(ctx, id)?.status).not.toBe('dropped')

    await host.prompt(id, { text: 'Make it taller' }, { source: 'human' })
    await until(() => readThreadEvents(id).filter((e) => e.type === 'turn_ended').length === 2)
    expect(fake.last().received[1]).toMatchObject({ method: 'session/load', params: { sessionId: conversation } })
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe(conversation)
    await host.stopAll('shutdown')
  })
})

describe('a server restart', () => {
  it('removes a dropped worker’s leftover own folder and keeps a working worker’s, touching nothing else', async () => {
    setAgentHostForTests(fakeHost().host)
    const inFeature = await startWorker('Header')
    const working = await startWorker('Footer')
    const gone = await startWorker('Sidebar')
    expect(folderOf(inFeature)).not.toBe(folderOf(working))
    await toolDropWorker(ctx, leadSession(), { workerId: gone })
    expect(existsSync(workerFolder(gone))).toBe(false)
    // A folder the drop did not get, and one no worker row knows of.
    mkdirSync(workerFolder(gone), { recursive: true })
    writeFileSync(join(workerFolder(gone), 'leftover.txt'), 'x')
    const orphan = join(workerFolder('sess_nobody'))
    mkdirSync(orphan, { recursive: true })

    expect(await sweepLeftovers(ctx)).toMatchObject({ failed: 0 })
    expect(existsSync(workerFolder(gone))).toBe(false)
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(folderOf(working))).toBe(true)
    expect(existsSync(folderOf(inFeature))).toBe(true)
    expect(getWorker(ctx, working)?.status).toBe('working')

    // A second boot finds nothing left to do.
    expect(await sweepLeftovers(ctx)).toMatchObject({ removed: 0 })
  })
})

describe('declare_ready', () => {
  it('is refused while a worker works or holds work not landed, naming the workers', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker('Header')
    await expect(toolDeclareReady(ctx, leadSession(), { scenario: 'smoke' })).rejects.toThrow(/Header.*working/)

    commitIn(folderOf(id), 'header.txt', 'header\n', 'feat: header')
    await handBack(id)
    await expect(toolDeclareReady(ctx, leadSession(), { scenario: 'smoke' })).rejects.toThrow(/Header.*handed-back/)

    await toolLandWorker(ctx, leadSession(), { workerId: id })
    expect(await toolDeclareReady(ctx, leadSession(), { scenario: 'smoke' })).toMatchObject({ ok: true })
  })
})

describe('cleanup', () => {
  it('archiving the feature removes each own folder and branch, keeps the feature-folder worker’s commits, and drops the open ones', async () => {
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const first = await startWorker('Header')
    const second = await startWorker('Footer')
    const { folder, branch } = getWorker(ctx, second)!
    expect(branch).toMatch(/^runcastle\/worker\//)
    expect(git(repo, 'branch', '--list', branch!)).not.toBe('')
    commitIn(folderOf(first), 'header.txt', 'header\n', 'feat: header')

    await archiveFeature(ctx, feature.id)
    expect(existsSync(folder!)).toBe(false)
    expect(git(repo, 'branch', '--list', branch!)).toBe('')
    expect(git(repo, 'log', '--format=%s', feature.branch)).toContain('feat: header')
    expect(getWorker(ctx, first)).toMatchObject({ status: 'dropped' })
    expect(getWorker(ctx, second)).toMatchObject({ status: 'dropped' })
    expect(host.stopped).toEqual(expect.arrayContaining([first, second]))
  })

  it('deleting the feature removes the workers’ own folders and their rows', async () => {
    setAgentHostForTests(fakeHost().host)
    const first = await startWorker('Header')
    const second = await startWorker('Footer')
    const folder = folderOf(second)
    await deleteFeature(ctx, feature.id)
    expect(existsSync(folder)).toBe(false)
    expect(getWorker(ctx, first)).toBeUndefined()
    expect(getWorker(ctx, second)).toBeUndefined()
  })

  it('merging the feature removes its workers, a landed one keeping its record', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    commitIn(folderOf(id), 'header.txt', 'header\n', 'feat: header')
    await handBack(id)
    await toolLandWorker(ctx, leadSession(), { workerId: id })

    expect(await mergeFeatureFlow(ctx, feature.id)).toMatchObject({ ok: true })
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

  it('is addressed by worker id, forwards to the worker’s own port on this machine, and wakes nothing', async () => {
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const id = await startWorker()
    const before = host.sent.length
    const { previewPort } = getWorker(ctx, id)!

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
    expect(forwarded).toEqual([`http://127.0.0.1:${previewPort}/index.html`])
    expect(host.sent).toHaveLength(before)
  })

  it('serves nothing for a dropped worker', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(workerPreviews(ctx).url(id)).toBeUndefined()
  })

  it('serves nothing for a landed worker', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    writeHostHandback(id, 'Done.')
    await workerTurnEnded(ctx, { id })
    await toolLandWorker(ctx, leadSession(), { workerId: id })
    expect(getWorker(ctx, id)!.status).toBe('landed')
    expect(workerPreviews(ctx).url(id)).toBeUndefined()
  })

  it('is on worker.list as the pass-through path once something listens on the worker’s port', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker()
    const list = () => createCallerFactory(appRouter)(ctx).worker.list({ featureId: feature.id })
    await workerTurnEnded(ctx, { id })
    expect((await list())[0]).toMatchObject({ id, previewPath: null })

    const server: Server = createServer((socket) => socket.end())
    await new Promise<void>((resolve) => server.listen(getWorker(ctx, id)!.previewPort!, '127.0.0.1', resolve))
    try {
      await workerTurnEnded(ctx, { id })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
    expect((await list())[0]).toMatchObject({ id, previewPath: `/__runcastle/open/worker/${encodeURIComponent(id)}`, passPort: ctx.config.serverPort + 2 })
  })
})
