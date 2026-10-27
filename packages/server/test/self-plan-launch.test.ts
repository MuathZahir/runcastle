import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentRuntime, Feature, SessionPurpose, ThreadEvent } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { launchSession } from '../src/launcher/launcher'
import { claudeRuntime } from '../src/launcher/runtimes/claude'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { setWaiting } from '../src/services/lead-status'
import { featureDocPath } from '../src/services/feature-docs'
import { createFeatureBranch } from '../src/services/git'
import { listSessionsByFeature, projectForFeature } from '../src/services/repo'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp, type FakeScript } from './support/fake-acp-agent'
import { briefOf, kickoffOf, promptsOf } from './support/thread-launch'

/**
 * "Plan it yourself" (`features-plan-themselves` decisions 3, 9, 11;
 * chat-as-web-components decision 6): the feature's main chat thread opened
 * with the `self-plan` purpose — unattended, so the host declines what the
 * agent asks — what it says and is briefed with, what it refuses, and what the
 * end of its planning turn says about the plan.
 */

describe('a self-planning run', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  let host: AgentHost | undefined
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-self-plan-'))
    cleanup.push(repoPath)
    const g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.raw(['commit', '--allow-empty', '-m', 'initial commit'])
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(async () => {
    await host?.stopAll('shutdown')
    host = undefined
    setAgentHostForTests(undefined)
    vi.restoreAllMocks()
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  async function feature(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    const f = seedFeature(ctx, projectId, { slug, ...overrides })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return f
  }

  function useRuntime(runtime: AgentRuntime): void {
    const id = runtime === 'codex' ? 'gpt-5.6-sol' : 'claude-sonnet-5'
    ctx.config = { ...ctx.config, model: id, models: [{ id, runtime }] }
  }

  async function launch(featureId: string, purpose?: SessionPurpose): Promise<string> {
    const { sessionId } = await launchSession(
      ctx,
      { featureId, kind: 'chat', ...(purpose ? { purpose } : {}) },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    return sessionId
  }

  /** A fake agent behind the host, with the lifecycle, past the readiness gate. */
  function fakeHost(script: FakeScript = {}): FakeAcp {
    vi.spyOn(claudeRuntime, 'checkReady').mockReturnValue({ ok: true })
    const fake = createFakeAcp(script)
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })
    setAgentHostForTests(host)
    return fake
  }

  async function logUntil(id: string, done: (events: ThreadEvent[]) => boolean): Promise<ThreadEvent[]> {
    await vi.waitFor(() => expect(done(readThreadEvents(id))).toBe(true))
    return readThreadEvents(id)
  }

  it('keeps its purpose on the session row', async () => {
    const f = await feature('row')
    const row = createSessionRow(ctx, {
      featureId: f.id,
      kind: 'chat',
      purpose: 'self-plan',
      worktreePath: 'C:\\wt',
    })
    expect(getSessionRow(ctx, row.id)?.purpose).toBe('self-plan')
  })

  it('opens the main chat thread on Claude Code, briefed that no human is present', async () => {
    useRuntime('claude-code')
    const f = await feature('claude-plan')
    const sessionId = await launch(f.id, 'self-plan')

    const row = getSessionRow(ctx, sessionId)
    expect(row?.kind).toBe('chat')
    expect(row?.purpose).toBe('self-plan')
    const launching = listAfter(ctx, f.id, 0).find((e) => e.type === 'session.launching')
    expect(launching?.data?.purpose).toBe('self-plan')

    const said = kickoffOf(sessionId)
    expect(promptsOf(sessionId)[0].source).toBe('runcastle')
    expect(said).toContain('Proceed with your task: no human is present')
    expect(said).toContain('/runcastle:feature')
    expect(said).toContain('references/planning-alone.md')
    // The feature-state part of the chat header still follows the opening.
    // No lap in it: the round count is the human-facing number (decision 16).
    expect(said).toContain('Feature status: Talking with you; rounds run: 0;')
    expect(said).not.toMatch(/\blap\b/i)
    expect(await briefOf(ctx, sessionId)).toContain('## No human is present')
  })

  it('names the skill its way on Codex', async () => {
    useRuntime('codex')
    const f = await feature('codex-plan')
    const sessionId = await launch(f.id, 'self-plan')

    const said = kickoffOf(sessionId)
    expect(said).toContain('no human is present')
    expect(said).toContain('$feature')
    expect(said).toContain('references/planning-alone.md')
    expect(await briefOf(ctx, sessionId)).toContain('## No human is present')
  })

  it('runs in the feature’s one main chat thread, marking it unattended', async () => {
    useRuntime('claude-code')
    const f = await feature('reuse')
    const earlier = await launch(f.id)
    markSessionLive(ctx, earlier, { ccSessionId: 'cc-earlier' })
    markSessionEnded(ctx, earlier)

    const sessionId = await launch(f.id, 'self-plan')

    expect(sessionId).toBe(earlier)
    expect(getSessionRow(ctx, sessionId)?.purpose).toBe('self-plan')
    expect(promptsOf(sessionId).at(-1)?.text).toContain('no human is present')
  })

  it('declines what the agent asks, so nobody has to be there', async () => {
    const fake = fakeHost({
      turn: async (t) => {
        await t.permission({ toolCallId: 'p1', title: 'rm -rf build' })
        await t.ask([{ header: 'Scope', question: 'Which scope?', options: ['A', 'B'] }])
      },
    })
    const f = await feature('unattended')
    const { sessionId } = await launchSession(ctx, { featureId: f.id, kind: 'chat', purpose: 'self-plan' })
    cleanup.push(sessionDir(sessionId))

    const events = await logUntil(sessionId, (e) => e.some((x) => x.type === 'turn_ended'))
    expect(events.filter((e) => e.type === 'ask')).toEqual([])
    expect(events.filter((e) => e.type === 'ask_resolved')).toHaveLength(2)
    expect(fake.last().received.some((r) => r.method === 'session/new')).toBe(true)
  })

  describe('is refused, leaving no session behind,', () => {
    async function expectRefused(f: Feature, reason: RegExp): Promise<void> {
      const before = listSessionsByFeature(ctx, f.id).map((s) => s.id)
      const attempt = launch(f.id, 'self-plan')
      await expect(attempt).rejects.toBeInstanceOf(GateError)
      await expect(attempt).rejects.toThrow(reason)
      expect(listSessionsByFeature(ctx, f.id).map((s) => s.id)).toEqual(before)
    }

    it('when the feature is a draft', async () => {
      const f = await feature('drafted', { status: 'draft' })
      await expectRefused(f, /in the backlog/)
    })

    it('when the feature has shipped', async () => {
      const f = await feature('done', { status: 'shipped' })
      await expectRefused(f, /is shipped/)
    })
  })

  it('plans a started feature whatever it has already produced or done', async () => {
    for (const [slug, overrides] of [['decided', {}], ['building', {}]] as const) {
      const f = await feature(slug, overrides)
      const path = featureDocPath(projectForFeature(ctx, f), f, 'decisions.md')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '# decisions\n')
      const sessionId = await launch(f.id, 'self-plan')
      expect(getSessionRow(ctx, sessionId)?.purpose).toBe('self-plan')
    }
  })

  // A running plan is an ordinary thread the human can open and type into (decision 6).
  it('lets the Chat door open a running plan’s thread', async () => {
    const f = await feature('running')
    const run = await launch(f.id, 'self-plan')
    markSessionLive(ctx, run, { ccSessionId: 'cc-run' })

    expect(await launch(f.id)).toBe(run)
    expect(listSessionsByFeature(ctx, f.id).map((s) => s.id)).toEqual([run])
  })

  it('refuses the retired relay and lead-wake runs', async () => {
    const f = await feature('retired')
    for (const purpose of ['relay', 'lead-wake'] as const) {
      await expect(launch(f.id, purpose)).rejects.toThrow(/no longer exists/)
    }
    expect(listSessionsByFeature(ctx, f.id)).toEqual([])
  })

  describe('at its planning turn’s end', () => {
    function selfPlanEnded(featureId: string) {
      return listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.self_plan_ended')
    }

    it('says the plan is complete when the run ended by asking the human for the yes', async () => {
      const f = await feature('done')
      fakeHost({ turn: async () => setWaiting(ctx, f.id, 'Start round 1?') })
      const { sessionId } = await launchSession(ctx, { featureId: f.id, kind: 'chat', purpose: 'self-plan' })

      await vi.waitFor(() => expect(selfPlanEnded(f.id)).toHaveLength(1))
      const [ended] = selfPlanEnded(f.id)
      expect(ended?.message).toBe('planning finished')
      expect(ended?.data).toEqual({ sessionId, complete: true })
      // The run is over: the thread is the lead's ordinary chat from here on.
      expect(getSessionRow(ctx, sessionId)?.purpose).toBeUndefined()
    })

    it('says planning stopped short otherwise', async () => {
      const f = await feature('short')
      fakeHost()
      const { sessionId } = await launchSession(ctx, { featureId: f.id, kind: 'chat', purpose: 'self-plan' })

      await vi.waitFor(() => expect(selfPlanEnded(f.id)).toHaveLength(1))
      const [ended] = selfPlanEnded(f.id)
      expect(ended?.message).toBe('planning stopped before the plan was complete')
      expect(ended?.data).toEqual({ sessionId, complete: false })
    })

    it('says nothing for a human’s turn, or a thread with any other purpose', async () => {
      const f = await feature('plain')
      fakeHost()
      const { sessionId } = await launchSession(ctx, { featureId: f.id, kind: 'chat' })
      await logUntil(sessionId, (e) => e.some((x) => x.type === 'turn_ended'))

      const g = await feature('typed-into')
      const plan = createSessionRow(ctx, { featureId: g.id, kind: 'chat', purpose: 'self-plan', worktreePath: 'C:\\wt' })
      await host?.prompt(plan.id, { text: 'how is it going?' }, { source: 'human' })
      await logUntil(plan.id, (e) => e.some((x) => x.type === 'turn_ended'))

      expect(selfPlanEnded(f.id)).toEqual([])
      expect(selfPlanEnded(g.id)).toEqual([])
    })
  })
})
