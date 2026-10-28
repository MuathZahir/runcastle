import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRuntime, Feature, Project } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { launchPrepareSession, launchProjectSession, launchSession, type LaunchSessionOptions } from '../src/launcher/launcher'
import { reconcileStaleSessions } from '../src/launcher/reconcile'
import { claudeRuntime } from '../src/launcher/runtimes/claude'
import { codexRuntime } from '../src/launcher/runtimes/codex'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { subscribeLive, type LiveSignal } from '../src/services/bus'
import { getEventRow, listAfter } from '../src/services/events'
import { createFeatureBranch, PROJECT_BRANCH } from '../src/services/git'
import { openProject } from '../src/services/projects'
import { updateSettings } from '../src/services/settings'
import { listSessionsByFeature } from '../src/services/repo'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { appendThreadEvent, readThreadEvents, type AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp, type FakeScript } from './support/fake-acp-agent'
import { acpLaunchOf, briefOf, kickoffOf, promptsOf, sentPrompts } from './support/thread-launch'

/**
 * Every conversation is a thread (chat-as-web-components; ADR-0015): a launch
 * finds or creates the thread's one row and says its kickoff as runcastle's
 * first prompt; the thread's process is launched over ACP with its kind's
 * brief and posture; Codex threads trust runcastle's hooks; `thread.new` opens
 * an empty thread whose first send is briefed; and a restart leaves every
 * thread idle.
 */

let ctx: AppCtx
let project: Project
let repoPath: string
let restoreDataDir: () => void
let host: AgentHost | undefined
let n = 0

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  repoPath = tmpRepo()
  const g = simpleGit(repoPath)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(repoPath, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  project = await openProject(ctx, repoPath)
})

afterEach(async () => {
  await host?.stopAll('shutdown')
  host = undefined
  setAgentHostForTests(undefined)
  vi.restoreAllMocks()
  restoreDataDir()
  rmTemp(repoPath)
})

async function feature(): Promise<Feature> {
  const f = seedFeature(ctx, project.id, { slug: `thread-${++n}` })
  await createFeatureBranch(project, f.slug, 'main')
  return f
}

function useRuntime(runtime: AgentRuntime): void {
  const id = runtime === 'codex' ? 'gpt-5.6-sol' : 'claude-sonnet-5'
  ctx.config = { ...ctx.config, model: id, models: [{ id, runtime }] }
}

/** A fake agent behind the host, past the readiness gate. */
function fakeHost(script: FakeScript = {}, launch = FAKE_LAUNCH): FakeAcp {
  vi.spyOn(claudeRuntime, 'checkReady').mockReturnValue({ ok: true })
  const fake = createFakeAcp(script)
  host = createAgentHost({ ctx, transport: fake.transport, launch })
  setAgentHostForTests(host)
  return fake
}

const caller = () => createCallerFactory(appRouter)(ctx)

async function chat(featureId: string, opts: { fresh?: boolean } = {}): Promise<string> {
  return (await launchSession(ctx, { featureId, kind: 'chat', ...opts }, { spawn: false })).sessionId
}

describe('the feature’s main chat keeps one row', () => {
  it('reopens its thread on every launch, and creates one only when asked for a fresh one', async () => {
    const f = await feature()
    const first = await chat(f.id)
    markSessionLive(ctx, first, { ccSessionId: 'cc-1' })
    markSessionEnded(ctx, first)

    expect(await chat(f.id)).toBe(first)
    expect(promptsOf(first)).toHaveLength(1)
    const fresh = await chat(f.id, { fresh: true })
    expect(fresh).not.toBe(first)
    expect(listSessionsByFeature(ctx, f.id).map((s) => s.id).sort()).toEqual([first, fresh].sort())
    // The fresh thread is a new conversation, so it is briefed.
    expect(kickoffOf(fresh)).toContain('Feature status:')
  })

  it('starts a new thread from the docs when the conversation on record cannot come back', async () => {
    const f = await feature()
    const gone = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: worktreeDir(project.id, f.slug) })
    markSessionLive(ctx, gone.id, { ccSessionId: 'cc-gone', transcriptPath: join(repoPath, 'gone', 'cc-gone.jsonl') })
    markSessionEnded(ctx, gone.id)

    const thread = await chat(f.id)

    expect(thread).not.toBe(gone.id)
    expect(listAfter(ctx, f.id, 0).find((e) => e.type === 'session.resume_gone')?.data).toMatchObject({
      resumeSessionId: 'cc-gone',
      reason: 'its transcript is no longer on disk',
    })
    expect(kickoffOf(thread)).toContain('Feature status:')
  })

  it('starts a new thread on Claude Code when the conversation was recorded in another worktree', async () => {
    const f = await feature()
    const transcript = join(repoPath, 'cc-moved.jsonl')
    writeFileSync(transcript, '{}\n')
    const moved = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: join(repoPath, 'old-wt') })
    markSessionLive(ctx, moved.id, { ccSessionId: 'cc-moved', transcriptPath: transcript })
    markSessionEnded(ctx, moved.id)

    expect(await chat(f.id)).not.toBe(moved.id)
    expect(listAfter(ctx, f.id, 0).find((e) => e.type === 'session.resume_gone')?.data).toMatchObject({
      reason: 'it was recorded in another worktree',
    })
  })

  it('starts the agent and says the kickoff as runcastle’s first prompt, spawning no terminal', async () => {
    const fake = fakeHost()
    const f = await feature()

    const { sessionId } = await launchSession(ctx, { featureId: f.id, kind: 'chat' })

    expect(host?.isRunning(sessionId)).toBe(true)
    await vi.waitFor(() => expect(fake.last()?.received.some((r) => r.method === 'session/prompt')).toBe(true))
    expect(fake.last().received.map((r) => r.method)).toContain('session/new')
    const sent = fake.last().received.find((r) => r.method === 'session/prompt')?.params as { prompt: { text: string }[] }
    expect(sent.prompt[0].text).toBe(kickoffOf(sessionId))
    expect(promptsOf(sessionId)[0].source).toBe('runcastle')
  })
})

describe('each conversation kind’s ACP launch', () => {
  it('runs a feature chat and a side thread without approvals, briefed as the lead and as a side session', async () => {
    const f = await feature()
    const main = await chat(f.id)
    const side = (await caller().thread.new({ featureId: f.id })).threadId

    for (const id of [main, side]) {
      const spec = await acpLaunchOf(ctx, id)
      expect(spec.sessionMode).toBe('bypassPermissions')
      const options = (spec.sessionMeta.claudeCode as { options: { extraArgs: Record<string, string> } }).options
      expect(Object.keys(options.extraArgs)).toEqual(
        expect.arrayContaining(['settings', 'mcp-config', 'plugin-dir', 'append-system-prompt-file']),
      )
    }
    expect(await briefOf(ctx, main)).toContain("You are this feature's **lead**")
    expect(await briefOf(ctx, side)).toContain('You are a **side session**')
  })

  it('runs the orchestrator in its own worktree without approvals', async () => {
    const id = (await caller().thread.new({ projectId: project.id })).threadId
    const spec = await acpLaunchOf(ctx, id)

    expect(spec.sessionMode).toBe('bypassPermissions')
    expect(getSessionRow(ctx, id)?.worktreePath).toBe(worktreeDir(project.id, PROJECT_WORKTREE_SLUG))
    const brief = await briefOf(ctx, id)
    expect(brief).toContain(PROJECT_BRANCH)
  })

  it('runs preparation in the real checkout with its brief, approvals on', async () => {
    const { sessionId } = await launchPrepareSession(ctx, { projectId: project.id }, { spawn: false })
    const spec = await acpLaunchOf(ctx, sessionId)

    expect(getSessionRow(ctx, sessionId)?.worktreePath).toBe(repoPath)
    expect(spec.sessionMode).toBe('acceptEdits')
    expect(await briefOf(ctx, sessionId)).toMatch(/prepar/i)
  })

  it('gives a Codex feature chat its own home, approvals never, and has its hooks trusted', async () => {
    useRuntime('codex')
    const f = await feature()
    const id = await chat(f.id)
    const spec = await acpLaunchOf(ctx, id)

    expect(spec.trustHooks).toBe(true)
    expect(spec.env.CODEX_HOME).toBeTruthy()
    expect(readFileSync(join(spec.env.CODEX_HOME, 'config.toml'), 'utf8')).toContain('approval_policy = "never"')
    expect(await briefOf(ctx, id)).toContain('$feature')
  })
})

describe('Codex hook trust', () => {
  const codexLaunch = async () => ({ ...(await FAKE_LAUNCH()), trustHooks: true })

  it('trusts the session’s untrusted hooks through codex-acp after the session opens, before the first turn', async () => {
    const fake = fakeHost(
      {
        codexHooks: [
          { key: 'guard', currentHash: 'h1', trustStatus: 'untrusted' },
          { key: 'status', currentHash: 'h2', trustStatus: 'trusted' },
        ],
      },
      codexLaunch,
    )
    const f = await feature()
    const row = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt/codex' })

    await host!.prompt(row.id, { text: 'hi' }, { source: 'human' })
    await vi.waitFor(() => expect(fake.last()?.received.some((r) => r.method === 'session/prompt')).toBe(true))

    const methods = fake.last().received.map((r) => r.method)
    expect(methods.indexOf('session/new')).toBeLessThan(methods.indexOf('_codex/hooks/list'))
    expect(methods.indexOf('_codex/hooks/trust')).toBeLessThan(methods.indexOf('session/prompt'))
    expect(fake.last().received.find((r) => r.method === '_codex/hooks/trust')?.params).toEqual({
      cwd: '/wt/codex',
      hooks: [{ key: 'guard', currentHash: 'h1' }],
    })
  })

  it('asks nothing of a Claude thread', async () => {
    const fake = fakeHost({ codexHooks: [{ key: 'guard', currentHash: 'h1' }] })
    const f = await feature()
    const row = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' })

    await host!.prompt(row.id, { text: 'hi' }, { source: 'human' })
    await vi.waitFor(() => expect(fake.last()?.received.some((r) => r.method === 'session/prompt')).toBe(true))

    expect(fake.last().received.map((r) => r.method)).not.toContain('_codex/hooks/list')
  })
})

describe('thread.new', () => {
  it('opens a side thread on a feature with nothing said and nothing started', async () => {
    const fake = fakeHost()
    const f = await feature()
    const main = await chat(f.id)

    const { threadId } = await caller().thread.new({ featureId: f.id })

    expect(getSessionRow(ctx, threadId)).toMatchObject({ kind: 'side', featureId: f.id, openedBeside: main })
    expect(promptsOf(threadId)).toEqual([])
    expect(fake.processes).toEqual([])
    expect((await caller().thread.list({ featureId: f.id })).map((t) => t.id)).toContain(threadId)
  })

  it('opens a fresh project chat in the project’s worktree, with nothing started', async () => {
    const fake = fakeHost()

    const { threadId } = await caller().thread.new({ projectId: project.id })

    expect(getSessionRow(ctx, threadId)).toMatchObject({ kind: 'project', projectId: project.id })
    expect(fake.processes).toEqual([])
    expect((await caller().thread.list({ projectId: project.id })).map((t) => t.id)).toEqual([threadId])
  })

  it('announces a new project chat on the live stream so the project’s thread list refreshes', async () => {
    fakeHost()
    const signals: LiveSignal[] = []
    const unsubscribe = subscribeLive((s) => signals.push(s))

    const { threadId } = await caller().thread.new({ projectId: project.id })
    unsubscribe()

    const event = signals.find((s) => s.kind === 'event' && s.projectId === project.id && s.featureId === undefined)
    expect(event).toBeDefined()
    const row = event?.kind === 'event' ? getEventRow(ctx, event.eventId) : null
    expect(row).toMatchObject({ type: 'session.project_opened', data: { sessionId: threadId } })
  })

  it('starts a new chat on the runtime of its configured default model, Codex included, with that runtime’s models', async () => {
    ctx.config = { ...ctx.config, model: 'gpt-5.6-terra' }
    const fake = fakeHost({ model: { id: 'gpt-5.6-terra', label: '5.6 Terra' } })
    vi.spyOn(codexRuntime, 'checkReady').mockReturnValue({ ok: true })
    const f = await feature()
    const threads = [
      (await caller().thread.new({ projectId: project.id })).threadId,
      (await caller().thread.new({ featureId: f.id })).threadId,
      (await launchPrepareSession(ctx, { projectId: project.id }, { holdOpening: true })).sessionId,
    ]

    for (const threadId of threads) {
      expect(getSessionRow(ctx, threadId)).toMatchObject({ runtime: 'codex', model: 'gpt-5.6-terra' })
      const { runtime, models, current } = await caller().thread.models({ threadId })
      expect(runtime).toBe('codex')
      expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(['gpt-5.6-sol', 'gpt-5.6-terra']))
      expect(models.some((m) => m.id.startsWith('claude-'))).toBe(false)
      expect(current).toBe('gpt-5.6-terra')
      expect((await acpLaunchOf(ctx, threadId)).env.CODEX_HOME).toBeTruthy()
    }
    expect((await caller().thread.models({ projectId: project.id, kind: 'project' })).runtime).toBe('codex')
    expect((await caller().thread.models({ featureId: f.id })).runtime).toBe('codex')
    expect(fake.processes).toEqual([])

    // The project's own default beats the global one.
    ctx.config = { ...ctx.config, model: 'claude-sonnet-5' }
    updateSettings(ctx, { projectId: project.id, key: 'model', value: 'gpt-5.6-terra' })
    const own = (await caller().thread.new({ projectId: project.id })).threadId
    expect(getSessionRow(ctx, own)).toMatchObject({ runtime: 'codex', model: 'gpt-5.6-terra' })
    expect((await caller().thread.models({ threadId: own })).runtime).toBe('codex')
  })

  it('briefs an empty thread before the human’s first words, and only the first time', async () => {
    fakeHost()
    const f = await feature()
    const side = (await caller().thread.new({ featureId: f.id })).threadId
    const orchestrator = (await caller().thread.new({ projectId: project.id })).threadId

    await caller().thread.send({ threadId: side, text: 'what is decision 4?' })
    await caller().thread.send({ threadId: orchestrator, text: 'plan the audit' })
    await caller().thread.send({ threadId: side, text: 'and 5?' })

    const sideSaid = promptsOf(side)
    expect(sideSaid.map((p) => p.source)).toEqual(['runcastle', 'human', 'human'])
    expect(sideSaid[0].text).toContain('[runcastle] Proceed as a side session')
    expect(sideSaid.slice(1).map((p) => p.text)).toEqual(['what is decision 4?', 'and 5?'])
    const projectSaid = promptsOf(orchestrator)
    expect(projectSaid.map((p) => p.source)).toEqual(['runcastle', 'human'])
    expect(projectSaid[0].text).toMatch(/\/runcastle:/)
  })

  it('sends an empty thread’s briefing and the human’s first words as one prompt in one turn', async () => {
    const fake = fakeHost()
    const { threadId } = await caller().thread.new({ projectId: project.id })

    await caller().thread.send({ threadId, text: 'Hello' })

    await vi.waitFor(() => expect(readThreadEvents(threadId).some((e) => e.type === 'turn_ended')).toBe(true))
    const [briefing] = promptsOf(threadId)
    expect(sentPrompts(fake)).toEqual([`${briefing.text}\n\nHello`])
    expect(readThreadEvents(threadId).filter((e) => e.type === 'turn_started')).toHaveLength(1)
  })

  // decision 12: a held opening and the ask are one prompt, so the opening says the ask follows rather than to wait for it.
  it('tells a side thread the human’s message follows its opening, and names it by that message', async () => {
    const fake = fakeHost({
      turn: async (t) => {
        await t.update({ sessionUpdate: 'session_info_update', title: 'Review probe side session' })
        await t.say('Decision 4 keeps five things from the terminal.')
      },
    })
    const f = await feature()
    const side = (await caller().thread.new({ featureId: f.id })).threadId

    await caller().thread.send({ threadId: side, text: 'what is decision 4?' })

    await vi.waitFor(() => expect(readThreadEvents(side).some((e) => e.type === 'turn_ended')).toBe(true))
    const [sent] = sentPrompts(fake)
    expect(sent).toMatch(/^\[runcastle\] Proceed as a side session/)
    expect(sent.endsWith("The human's message follows.\n\nwhat is decision 4?")).toBe(true)
    expect(sent).not.toContain("Wait for the human's ask")
    expect((await caller().thread.list({ featureId: f.id })).find((t) => t.id === side)?.title).toBe('what is decision 4?')
  })

  it('ends every held opening by saying the human’s message follows', async () => {
    fakeHost()
    const f = await feature()
    const { sessionId: main } = await launchSession(ctx, { featureId: f.id, kind: 'chat' }, { holdOpening: true })
    const { sessionId: orchestrator } = await launchProjectSession(ctx, { projectId: project.id }, { holdOpening: true })
    const { sessionId: prepare } = await launchPrepareSession(ctx, { projectId: project.id }, { holdOpening: true })

    for (const id of [main, orchestrator, prepare]) {
      expect(promptsOf(id)).toEqual([expect.objectContaining({ source: 'runcastle', text: expect.stringMatching(/\n\nThe human's message follows\.$/) })])
    }
  })
})

describe('a launch’s opening held for the human’s first message', () => {
  /** Launch, then send the human's first words as the web does on a never-started thread's first Send. */
  async function startOnFirstSend(launch: (opts: LaunchSessionOptions) => Promise<{ sessionId: string }>): Promise<{ id: string; fake: FakeAcp }> {
    const fake = fakeHost()
    const { sessionId } = await launch({ holdOpening: true })
    expect(fake.processes).toEqual([])
    expect(promptsOf(sessionId).map((p) => p.source)).toEqual(['runcastle'])
    await caller().thread.send({ threadId: sessionId, text: 'Hello' })
    await vi.waitFor(() => expect(readThreadEvents(sessionId).some((e) => e.type === 'turn_ended')).toBe(true))
    return { id: sessionId, fake }
  }

  it.each([
    ['the feature’s main chat', async (opts: LaunchSessionOptions) => launchSession(ctx, { featureId: (await feature()).id, kind: 'chat' }, opts)],
    ['a new project chat', (opts: LaunchSessionOptions) => launchProjectSession(ctx, { projectId: project.id, fresh: true }, opts)],
    ['the preparation chat', (opts: LaunchSessionOptions) => launchPrepareSession(ctx, { projectId: project.id }, opts)],
  ])('%s sends its opening and the first message as one prompt in one turn', async (_, launch) => {
    const { id, fake } = await startOnFirstSend(launch)
    const [opening, hello] = promptsOf(id)
    expect([opening.source, hello.source]).toEqual(['runcastle', 'human'])
    expect(sentPrompts(fake)).toEqual([`${opening.text}\n\nHello`])
    expect(readThreadEvents(id).filter((e) => e.type === 'turn_started')).toHaveLength(1)
  })

  it('without the flag, a launch sends its opening at once', async () => {
    const fake = fakeHost()
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id, fresh: true })
    await vi.waitFor(() => expect(sentPrompts(fake)).toEqual([promptsOf(sessionId)[0].text]))
  })
})

describe('boot reconciliation', () => {
  it('leaves every thread idle: rows ended, a log cut off mid-turn closed', async () => {
    const f = await feature()
    const row = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' })
    markSessionLive(ctx, row.id, { ccSessionId: 'cc-cut' })
    appendThreadEvent(row.id, { type: 'prompt', id: 'p1', text: 'go', source: 'human' })
    appendThreadEvent(row.id, { type: 'process', state: 'running' })
    appendThreadEvent(row.id, { type: 'turn_started' })
    expect((await caller().thread.view({ threadId: row.id })).state).toBe('working')

    reconcileStaleSessions(ctx)

    expect(getSessionRow(ctx, row.id)?.status).toBe('ended')
    const view = await caller().thread.view({ threadId: row.id })
    expect(view.state).toBe('idle')
    // The cut-off turn says the restart stopped it, not the human.
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'notice'])
    expect(view.items.at(-1)).toMatchObject({ kind: 'notice', text: 'Interrupted — runcastle restarted' })
    // An idle log is left as it is.
    const idle = (await caller().thread.events({ threadId: row.id })).events.length
    reconcileStaleSessions(ctx)
    expect((await caller().thread.events({ threadId: row.id })).events).toHaveLength(idle)
  })
})
