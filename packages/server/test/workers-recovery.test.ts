import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolStartWorker } from '../src/mcp/server'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { resetAgentSlotsForTests } from '../src/services/agent-slots'
import { listAfter } from '../src/services/events'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import type { AgentHost } from '../src/threads/types'
import { setSandboxEngineForTests } from '../src/workers/engine'
import {
  getWorker,
  landWorker,
  setWorkerRetryDelayForTests,
  withWorkers,
  workerStallBounds,
  workerTurnEnded,
  workerTurnSlot,
} from '../src/workers/service'
import { refreshWorkerFeatureBranch, workerOrigin } from '../src/workers/worker'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp, type FakeTurn } from './support/fake-acp-agent'
import { commitOn, fakeEngine, fakeHost, git, initRepo, type FakeEngine } from './support/fake-workers'
import { promptsOf } from './support/thread-launch'

/**
 * Workers recover by themselves (burns-become-workers decisions 6, 8, 9, 21):
 * a transient error or a stall is retried in the same conversation, a fatal
 * one or the fourth transient fails the worker with one wake of its lead, an
 * account error holds the queue until the human writes, and an "on its own"
 * worker whose land conflicts is sent back to resolve it.
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
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  resetAgentSlotsForTests()
  setWorkerRetryDelayForTests(() => 5)
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
})

afterEach(async () => {
  await host?.stopAll('shutdown')
  host = undefined
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  setWorkerRetryDelayForTests(undefined)
  vi.unstubAllEnvs()
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
})

let host: AgentHost | undefined

const leadSession = () => getSessionRow(ctx, lead)!
const status = (id: string) => getWorker(ctx, id)?.status

async function startWorker(label = 'Header', kind: 'with-you' | 'on-its-own' = 'on-its-own'): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, leadSession(), { label, purpose: `The ${label}`, kind, goal: `Build the ${label}` })
  return workerId
}

async function until(done: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done()) {
    if (Date.now() > deadline) throw new Error('never got there')
    await new Promise((r) => setTimeout(r, 5))
  }
}

/** A real agent host over the fake ACP agent (workers and the lead alike), the worker transport and the server's lifecycle. */
function realHost(fake: FakeAcp, stall = { silenceMs: 60_000, commandMs: 60_000 }): AgentHost {
  engine.transport = fake.transport
  host = createAgentHost({
    ctx,
    transport: withWorkers(ctx, fake.transport),
    launch: FAKE_LAUNCH,
    lifecycle: threadLifecycle(ctx),
    turnSlot: workerTurnSlot(ctx),
    stallBounds: workerStallBounds(stall),
    readUsage: async () => ({}),
    idleMs: 60_000,
  })
  setAgentHostForTests(host)
  return host
}

const text = (t: FakeTurn) => t.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('')

/** A fake agent whose worker turns fail with each of `errors` in turn, then end cleanly; the lead's turns just end. */
function failing(...errors: string[]): FakeAcp {
  return createFakeAcp({
    turn: async (t) => {
      if (!text(t).includes('Build the') && !text(t).includes('[runcastle] The last turn')) return
      const error = errors.shift()
      if (error) throw new Error(error)
      await t.say('Done.')
    },
  })
}

const workerPrompts = (id: string) => promptsOf(id).map((p) => p.text)
const leadWakes = () => promptsOf(lead).filter((p) => p.display && 'workerFailed' in p.display)
const eventsOf = (type: string, id: string) =>
  listAfter(ctx, feature.id, 0).filter((e) => e.type === type && (e.data as { workerId: string }).workerId === id)

describe('a transient error', () => {
  it('is retried in the same conversation after a backoff, the worker staying working', async () => {
    const fake = failing('API Error: 529 overloaded_error')
    realHost(fake)
    const id = await startWorker()
    await until(() => status(id) === 'needs-you')

    expect(workerPrompts(id)).toEqual(['Start your assignment: Build the Header', expect.stringContaining('[runcastle] The last turn stopped on a transient error (')])
    expect(eventsOf('worker.retrying', id).map((e) => (e.data as { attempt: number }).attempt)).toEqual([1])
    expect(eventsOf('worker.status', id).map((e) => (e.data as { status: string }).status)).toEqual(['needs-you'])
    // One process, one conversation.
    expect(fake.processes).toHaveLength(1)
    expect(fake.last().received.filter((r) => r.method === 'session/new')).toHaveLength(1)
    expect(leadWakes()).toHaveLength(0)
  })

  it('fails the worker on the fourth in a row, waking the lead once', async () => {
    realHost(failing('429 rate limit', '429 rate limit', '429 rate limit', '429 rate limit'))
    const id = await startWorker()
    await until(() => status(id) === 'failed')
    await until(() => leadWakes().length === 1)

    expect(eventsOf('worker.retrying', id)).toHaveLength(3)
    expect(getWorker(ctx, id)?.failure).toMatch(/429 rate limit.*still failing after 3 retries/)
    await new Promise((r) => setTimeout(r, 50))
    expect(leadWakes()).toHaveLength(1)
  })
})

describe('a fatal error', () => {
  it('fails the worker at once and wakes the lead once', async () => {
    realHost(failing('API Error: 400 Prompt is too long'))
    const id = await startWorker()
    await until(() => status(id) === 'failed')
    await until(() => leadWakes().length === 1)
    expect(eventsOf('worker.retrying', id)).toHaveLength(0)
    expect(workerPrompts(id)).toHaveLength(1)
  })
})

describe('the usage limit', () => {
  it('is not retried here: the worker waits on the human, as the carry-on setting (off) says', async () => {
    realHost(failing("You've hit your usage limit · resets 3pm"))
    const id = await startWorker()
    await until(() => status(id) === 'needs-you')
    await new Promise((r) => setTimeout(r, 50))
    expect(eventsOf('worker.retrying', id)).toHaveLength(0)
    expect(workerPrompts(id)).toHaveLength(1)
    expect(leadWakes()).toHaveLength(0)
  })
})

describe('an account error', () => {
  it('holds every queued worker on its runtime, says why, tells the lead once, and lifts at the human’s next message', async () => {
    ctx.config = { ...ctx.config, burnConcurrency: 1 }
    let failA!: () => void
    const fake = createFakeAcp({
      turn: async (t) => {
        if (text(t).includes('Build the Header')) {
          await new Promise<void>((resolve) => (failA = resolve))
          throw new Error('Invalid API key · Please run /login')
        }
        await t.say('Done.')
      },
    })
    realHost(fake)
    const a = await startWorker('Header')
    await until(() => failA !== undefined)
    const b = await startWorker('Footer')
    await until(() => status(b) === 'queued')

    failA()
    await until(() => status(a) === 'failed')
    await until(() => leadWakes().length === 1)
    await new Promise((r) => setTimeout(r, 50))
    expect(status(b)).toBe('queued')
    expect(leadWakes()[0]?.text).toContain('no queued worker on claude-code starts until the human next writes')
    const list = await createCallerFactory(appRouter)(ctx).worker.list({ featureId: feature.id })
    expect(list.find((w) => w.id === b)?.heldBy).toBe('Invalid API key · Please run /login')
    expect(list.find((w) => w.id === a)?.heldBy).toBeNull()

    await host!.prompt(lead, { text: 'I fixed the login' }, { source: 'human' })
    await until(() => status(b) === 'needs-you')
    expect(leadWakes()).toHaveLength(1)
  })
})

describe('a stalled turn', () => {
  it('is cancelled after the silence bound with no command running, and retried', async () => {
    let turns = 0
    const fake = createFakeAcp({
      turn: async (t) => {
        if (!text(t).includes('Build the') && !text(t).includes('[runcastle]')) return
        if (++turns > 1) return void (await t.say('Done.'))
        await t.say('Looking…')
        await t.cancelled
        return 'cancelled'
      },
    })
    realHost(fake, { silenceMs: 60, commandMs: 60_000 })
    const id = await startWorker()
    await until(() => status(id) === 'needs-you')
    expect(eventsOf('worker.retrying', id).map((e) => (e.data as { error: string }).error)).toEqual(['stalled: no progress for 0s'])
    expect(workerPrompts(id)[1]).toContain('transient error (stalled')
  })

  it('is cancelled when one command runs past the ceiling, however much it reports meanwhile', async () => {
    let turns = 0
    const fake = createFakeAcp({
      turn: async (t) => {
        if (!text(t).includes('Build the') && !text(t).includes('[runcastle]')) return
        if (++turns > 1) return void (await t.say('Done.'))
        await t.update({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'bun test', kind: 'execute', status: 'in_progress' })
        let cancelled = false
        void t.cancelled.then(() => (cancelled = true))
        while (!cancelled) {
          await t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' })
          await new Promise((r) => setTimeout(r, 10))
        }
        return 'cancelled'
      },
    })
    realHost(fake, { silenceMs: 40, commandMs: 150 })
    const id = await startWorker()
    await until(() => status(id) === 'needs-you')
    expect(eventsOf('worker.retrying', id).map((e) => (e.data as { error: string }).error)).toEqual([expect.stringMatching(/^stalled: one command ran past/)])
  })
})

describe('a landing conflict', () => {
  /** The worker's branch and the feature branch both change README.md since the worker forked. */
  async function conflictingHandback(id: string, round: number): Promise<void> {
    const w = getWorker(ctx, id)!
    commitOn(repo, w.branch!, 'README.md', `worker ${round}\n`, `feat: worker side ${round}`)
    commitOn(repo, feature.branch, 'README.md', `feature ${round}\n`, `feat: feature side ${round}`)
    engine.handbacks.set(id, { summary: 'Done', at: Date.now() })
    await workerTurnEnded(ctx, { id })
  }

  it('sends an "on its own" worker back twice with the files and the other side’s commits, then leaves it to the lead', async () => {
    const fake = fakeHost()
    setAgentHostForTests(fake.host)
    const id = await startWorker('Header', 'on-its-own')
    const container = getWorker(ctx, id)!.container!

    for (const round of [1, 2]) {
      await conflictingHandback(id, round)
      const res = await landWorker(ctx, id)
      expect(res).toMatchObject({ ok: false, conflict: true, files: ['README.md'], sentBack: true })
      expect(!res.ok && res.error).toContain(`try ${round} of 2`)
      expect(status(id)).toBe('working')
      const told = fake.sent.filter((s) => s.threadId === id).at(-1)!.text
      expect(told).toContain('Conflicting files: README.md')
      expect(told).toContain(`feat: feature side ${round}`)
      expect(told).toContain(`git merge origin/${feature.branch}`)
    }
    expect(engine.refreshed).toEqual([container, container])

    await conflictingHandback(id, 3)
    const third = await landWorker(ctx, id)
    expect(third).toMatchObject({ ok: false, conflict: true })
    expect(third.ok === false && third.sentBack).toBeFalsy()
    expect(!third.ok && third.error).toMatch(/resolve it yourself.*send_back_worker/)
    expect(status(id)).toBe('handed-back')
  })

  it('leaves a "with you" worker’s conflict to the lead at once, naming both choices', async () => {
    setAgentHostForTests(fakeHost().host)
    const id = await startWorker('Header', 'with-you')
    await conflictingHandback(id, 1)
    const res = await landWorker(ctx, id)
    expect(res.ok === false && res.sentBack).toBeFalsy()
    expect(!res.ok && res.error).toMatch(/resolve it yourself.*send_back_worker/)
    expect(status(id)).toBe('handed-back')
  })

  it('gives the worker’s bare copy the feature branch’s tip, so a clone of it can merge it in', async () => {
    const sb = {
      id: 'w_refresh',
      engine: 'docker' as const,
      runtime: 'claude-code' as const,
      container: 'c',
      repoPath: repo,
      featureBranch: feature.branch,
      branch: 'runcastle/worker/refresh',
      port: 41001,
      previewUrl: '',
    }
    const origin = workerOrigin(sb.id)
    execFileSync('git', ['clone', '-q', '--bare', '--single-branch', '--branch', feature.branch, repo, origin])
    git(origin, 'branch', '-f', sb.branch, feature.branch)
    const inside = tmpRepo()
    try {
      execFileSync('git', ['clone', '-q', '--branch', sb.branch, origin, inside])
      git(inside, 'config', 'user.email', 't@t.t')
      git(inside, 'config', 'user.name', 't')
      commitOn(repo, feature.branch, 'later.txt', 'later\n', 'feat: landed later')

      await refreshWorkerFeatureBranch(sb)
      git(inside, 'fetch', '-q', 'origin')
      git(inside, 'merge', '-q', '--no-edit', `origin/${feature.branch}`)
      expect(git(inside, 'log', '--format=%s', '-1', `origin/${feature.branch}`).trim()).toBe('feat: landed later')
      expect(git(inside, 'ls-files')).toContain('later.txt')
    } finally {
      rmTemp(inside)
    }
  })
})
