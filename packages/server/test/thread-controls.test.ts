import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { foldThread, type AgentRuntime, type SessionRow, type ThreadEvent } from '@runcastle/core'
import { modelCatalogPath } from '@runcastle/core/paths'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { appendThreadEvent, readThreadEvents, type AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp, type FakeScript } from './support/fake-acp-agent'

/**
 * The thread controls (chat-as-web-components ticket 5) through the router,
 * with a fake ACP agent behind the host: the model, effort and fast mode;
 * edit-and-rewind and branch; usage; `@` files; titles and suggestions; export.
 */

let ctx: AppCtx
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
let projectId: string
let featureId: string
let fake: FakeAcp
let host: AgentHost
let readUsage: ReturnType<typeof vi.fn<(runtime: AgentRuntime) => Promise<unknown>>>
/** The row each agent launch was built from, in order. */
let launched: SessionRow[] = []
let rewindFiles: ReturnType<typeof vi.fn<(input: { sessionId: string; cwd: string; text: string; occurrence: number }) => Promise<string[]>>>
const temps: string[] = []

beforeEach(async () => {
  ctx = await makeTestCtx()
  caller = createCallerFactory(appRouter)(ctx)
  projectId = seedProject(ctx).id
  featureId = seedFeature(ctx, projectId).id
  // Each runtime's model catalog outlives its sessions on disk; each test starts with none.
  rmSync(dirname(modelCatalogPath('claude-code')), { recursive: true, force: true })
  setup()
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  for (const dir of temps.splice(0)) rmTemp(dir)
})

function setup(script: FakeScript = {}): void {
  fake = createFakeAcp(script)
  readUsage = vi.fn(async () => ({}))
  rewindFiles = vi.fn(async () => [] as string[])
  launched = []
  const launch = async (_: AppCtx, row: SessionRow) => {
    launched.push(row)
    return FAKE_LAUNCH()
  }
  host = createAgentHost({ ctx, transport: fake.transport, launch, readUsage, rewindFiles })
  setAgentHostForTests(host)
}

function chat(opts: { runtime?: AgentRuntime; worktreePath?: string; kind?: 'chat' | 'project' } = {}): string {
  const model = opts.runtime === 'codex' ? { model: { id: 'gpt-5.5', runtime: 'codex' as const } } : {}
  const worktreePath = opts.worktreePath ?? '/wt'
  const id =
    opts.kind === 'project'
      ? createSessionRow(ctx, { projectId, kind: 'project', worktreePath, ...model }).id
      : createSessionRow(ctx, { featureId, kind: 'chat', worktreePath, ...model }).id
  // A thread already begun: the first send to an empty one sends its kind's kickoff first (ticket 4).
  appendThreadEvent(id, { type: 'process', state: 'stopped' })
  return id
}

async function logUntil(id: string, done: (events: ThreadEvent[]) => boolean): Promise<ThreadEvent[]> {
  const deadline = Date.now() + 3000
  for (;;) {
    const events = readThreadEvents(id)
    if (done(events)) return events
    if (Date.now() > deadline) throw new Error(`log never got there: ${events.map((e) => e.type).join(', ')}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}
const turnsEnded = (n: number) => (events: ThreadEvent[]) => events.filter((e) => e.type === 'turn_ended').length >= n

/** Every request the fake agents received, in order, by method. */
const received = (method: string) => fake.processes.flatMap((p) => p.received.filter((r) => r.method === method).map((r) => r.params as Record<string, unknown>))
const methods = () => fake.processes.flatMap((p) => p.received.map((r) => r.method))

/** Answer each prompt with its own message id, `m1`, `m2`…, as the adapters send theirs. */
function answerWithIds(): void {
  let n = 0
  fake.script.turn = async (t) => {
    n++
    await t.say(`answer ${n}`, `m${n}`)
  }
}

async function converse(id: string, ...said: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const [n, text] of said.entries()) {
    ids.push((await caller.thread.send({ threadId: id, text })).promptId)
    await logUntil(id, turnsEnded(n + 1))
  }
  return ids
}

const said = (id: string) =>
  foldThread(readThreadEvents(id)).items.flatMap((i) => (i.kind === 'user' || i.kind === 'agent' ? [`${i.kind}:${i.text}`] : i.kind === 'model' ? [`model:${i.model}`] : []))

describe('model, effort and fast mode', () => {
  it('lists the session models, and switches the model for the next message with a divider', async () => {
    setup({ models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }], options: 'claude' })
    const id = chat()
    await converse(id, 'Hello')
    expect(await caller.thread.models({ threadId: id })).toEqual({
      runtime: 'claude-code',
      models: [
        { id: 'claude-opus-5-5', label: 'Opus 5.5', fast: true, efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high' },
        // No session ran on Sonnet: it takes the levels Claude Code offers.
        { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'max'] },
      ],
      current: 'claude-opus-5-5',
    })
    expect(await caller.thread.setModel({ threadId: id, model: 'claude-sonnet-5-5', effort: 'max', fast: true })).toEqual({ ok: true })
    expect(received('session/set_config_option')).toEqual([
      { sessionId: 'acp-session-1', configId: 'model', value: 'claude-sonnet-5-5' },
      { sessionId: 'acp-session-1', configId: 'effort', value: 'max' },
      { sessionId: 'acp-session-1', configId: 'fast', value: 'on' },
    ])
    expect(readThreadEvents(id).at(-1)).toMatchObject({ type: 'model', model: 'claude-sonnet-5-5', label: 'Sonnet 5.5', effort: 'max', fast: true })
    await caller.thread.send({ threadId: id, text: 'Again' })
    await logUntil(id, turnsEnded(2))
    const view = foldThread(readThreadEvents(id))
    expect(said(id)).toEqual(['user:Hello', 'agent:Done.', 'model:Sonnet 5.5', 'user:Again', 'agent:Done.'])
    expect(view.items.filter((i) => i.kind === 'agent').map((i) => i.kind === 'agent' && i.model)).toEqual(['Opus 5.5', 'Sonnet 5.5'])
    expect(view.model).toEqual({ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', effort: 'max', fast: true })
  })

  it('sets a boolean fast mode as a boolean', async () => {
    setup({ options: 'claude', fastBoolean: true })
    const id = chat()
    await converse(id, 'Hello')
    await caller.thread.setModel({ threadId: id, model: 'claude-opus-5-5', fast: true })
    expect(received('session/set_config_option')).toEqual([{ sessionId: 'acp-session-1', configId: 'fast', type: 'boolean', value: true }])
  })

  it('switches a Codex session before the message that asks for it, through its own option ids', async () => {
    setup({ model: { id: 'gpt-5.5', label: '5.5' }, models: [{ id: 'gpt-5.5-mini', label: '5.5 Mini' }], options: 'codex' })
    const id = chat({ runtime: 'codex' })
    await converse(id, 'Hello')
    await caller.thread.send({ threadId: id, text: 'Faster', model: 'gpt-5.5-mini', effort: 'high', fast: true })
    await logUntil(id, turnsEnded(2))
    expect(methods().slice(-4)).toEqual(['session/set_config_option', 'session/set_config_option', 'session/set_config_option', 'session/prompt'])
    expect(received('session/set_config_option').map((p) => [p.configId, p.value])).toEqual([
      ['model', 'gpt-5.5-mini'],
      ['reasoning_effort', 'high'],
      ['fast-mode', 'on'],
    ])
    expect(said(id)).toEqual(['user:Hello', 'agent:Done.', 'model:5.5 Mini', 'user:Faster', 'agent:Done.'])
  })

  it('sends nothing to the agent when the message asks for what the thread already runs on', async () => {
    setup({ options: 'claude' })
    const id = chat()
    await converse(id, 'Hello')
    await caller.thread.send({ threadId: id, text: 'Same', model: 'claude-opus-5-5', effort: 'high' })
    await logUntil(id, turnsEnded(2))
    expect(received('session/set_config_option')).toEqual([])
  })

  it('records a choice made while no agent runs and applies it when the next message starts one', async () => {
    setup({ models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }] })
    const id = chat()
    await converse(id, 'Hello')
    await host.stop(id, 'idle')
    await caller.thread.setModel({ threadId: id, model: 'claude-sonnet-5-5' })
    expect(fake.processes).toHaveLength(1)
    expect(readThreadEvents(id).at(-1)).toMatchObject({ type: 'model', model: 'claude-sonnet-5-5', label: 'Sonnet 5.5' })
    await caller.thread.send({ threadId: id, text: 'Again' })
    await logUntil(id, turnsEnded(2))
    expect(fake.last().received.map((r) => r.method)).toEqual(['initialize', 'session/load', 'session/set_mode', 'session/set_config_option', 'session/prompt'])
    expect(said(id)).toEqual(['user:Hello', 'agent:Done.', 'model:Sonnet 5.5', 'user:Again', 'agent:Done.'])
  })

  it('says fast mode is offered on the model the session runs on only when the runtime offers it', async () => {
    setup({ model: { id: 'gpt-5.5', label: '5.5' }, models: [{ id: 'gpt-5.5-mini', label: '5.5 Mini' }], options: 'codex' })
    const codex = chat({ runtime: 'codex' })
    await converse(codex, 'Hello')
    expect((await caller.thread.models({ threadId: codex })).models).toEqual([
      // Codex's `xhigh` is no level runcastle offers.
      { id: 'gpt-5.5', label: '5.5', fast: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      // No session ran on it: it takes what one said of its GPT generation.
      { id: 'gpt-5.5-mini', label: '5.5 Mini', fast: true, efforts: ['low', 'medium', 'high'] },
    ])
    setup({ models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }] })
    const plain = chat()
    await converse(plain, 'Hello')
    expect((await caller.thread.models({ threadId: plain })).models.some((m) => m.fast)).toBe(false)
  })
})

describe('the model the composer shows is the one the agent runs on', () => {
  /**
   * Claude Code's list as claude-agent-acp gives it: its values are aliases,
   * not runcastle's roster ids, and "Default (recommended)" stands for Opus.
   */
  const ALIASES: FakeScript = {
    model: { id: 'default', label: 'Default (recommended)', description: 'Opus 5' },
    models: [
      { id: 'opus', label: 'Opus 5' },
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ],
    options: 'claude',
  }

  /** A project chat nobody has talked to yet, as `thread.new` opens it. */
  const unstarted = () => createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' }).id
  const dividers = (id: string) => foldThread(readThreadEvents(id)).items.filter((i) => i.kind === 'model')

  it('runs the first message on the model, effort and fast mode picked before it, its opening held into the same prompt', async () => {
    setup(ALIASES)
    const id = unstarted()
    // The picker before any session has run offers runcastle's roster ids.
    expect((await caller.thread.models({ threadId: id })).models.map((m) => m.id)).toContain('claude-sonnet-5')

    await caller.thread.send({ threadId: id, text: 'Hello', model: 'claude-sonnet-5', effort: 'low', fast: true })
    await logUntil(id, turnsEnded(1))

    expect(methods()).toEqual(['initialize', 'session/new', 'session/set_mode', 'session/set_config_option', 'session/set_config_option', 'session/set_config_option', 'session/prompt'])
    expect(received('session/set_config_option').map((p) => [p.configId, p.value])).toEqual([
      ['model', 'sonnet'],
      ['effort', 'low'],
      ['fast', 'on'],
    ])
    expect(received('session/prompt')).toHaveLength(1)
    const view = foldThread(readThreadEvents(id))
    expect(view.model).toEqual({ id: 'sonnet', label: 'Sonnet 5', effort: 'low', fast: true })
    expect(view.items.filter((i) => i.kind === 'agent').map((i) => i.kind === 'agent' && i.model)).toEqual(['Sonnet 5'])
    expect(dividers(id)).toEqual([])
  })

  it('starts on a choice made in the picker before the first message, with no divider until the thread has started', async () => {
    setup(ALIASES)
    const id = unstarted()
    await caller.thread.setModel({ threadId: id, model: 'claude-sonnet-5' })
    await caller.thread.setModel({ threadId: id, model: 'claude-haiku-4-5', effort: 'max' })

    expect(readThreadEvents(id)).toEqual([])
    expect((await caller.thread.models({ threadId: id })).current).toBe('claude-haiku-4-5')
    await caller.thread.send({ threadId: id, text: 'Hello' })
    await logUntil(id, turnsEnded(1))

    expect(received('session/set_config_option').map((p) => [p.configId, p.value])).toEqual([
      ['model', 'haiku'],
      ['effort', 'max'],
    ])
    expect(foldThread(readThreadEvents(id)).model).toMatchObject({ id: 'haiku', label: 'Haiku 4.5', effort: 'max' })
    expect(dividers(id)).toEqual([])
  })

  it("switches mid-thread with the adapter's own value, says 'Now on' the label, and the picker names it", async () => {
    setup(ALIASES)
    const id = chat()
    await converse(id, 'Hello')
    // A picker read before the session reported still holds the roster's id.
    await caller.thread.setModel({ threadId: id, model: 'claude-haiku-4-5' })

    expect(received('session/set_config_option')).toEqual([{ sessionId: 'acp-session-1', configId: 'model', value: 'haiku' }])
    expect(readThreadEvents(id).at(-1)).toMatchObject({ type: 'model', model: 'haiku', label: 'Haiku 4.5' })
    const { models, current } = await caller.thread.models({ threadId: id })
    expect(models.find((m) => m.id === current)?.label).toBe('Haiku 4.5')
    await caller.thread.send({ threadId: id, text: 'Again' })
    await logUntil(id, turnsEnded(2))
    expect(said(id)).toEqual(['user:Hello', 'agent:Done.', 'model:Haiku 4.5', 'user:Again', 'agent:Done.'])
    expect(foldThread(readThreadEvents(id)).items.filter((i) => i.kind === 'agent').map((i) => i.kind === 'agent' && i.model)).toEqual(['Opus 5', 'Haiku 4.5'])
  })

  it('logs a switch made while a started thread is idle under the id and label its picker offers', async () => {
    setup(ALIASES)
    const id = chat()
    await converse(id, 'Hello')
    await host.stop(id, 'idle')
    await caller.thread.setModel({ threadId: id, model: 'claude-haiku-4-5' })

    expect(readThreadEvents(id).at(-1)).toMatchObject({ type: 'model', model: 'haiku', label: 'Haiku 4.5' })
    await caller.thread.send({ threadId: id, text: 'Again' })
    await logUntil(id, turnsEnded(2))
    expect(received('session/set_config_option').map((p) => p.value)).toEqual(['haiku'])
  })

  /** A main chat runcastle opens on `model`, as Settings resolve it, sent its kickoff. */
  async function runcastleStarted(model: string): Promise<string> {
    ctx.config.model = model
    const id = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt', model: { id: model, runtime: 'claude-code' } }).id
    await host.prompt(id, { text: 'Proceed with your task' }, { source: 'runcastle' })
    await logUntil(id, turnsEnded(1))
    return id
  }

  it('runs a thread runcastle starts on the model resolved for it, set before its first prompt', async () => {
    setup(ALIASES)
    const id = await runcastleStarted('claude-sonnet-5')

    expect(methods()).toEqual(['initialize', 'session/new', 'session/set_mode', 'session/set_config_option', 'session/prompt'])
    expect(received('session/set_config_option').map((p) => [p.configId, p.value])).toEqual([['model', 'sonnet']])
    expect(foldThread(readThreadEvents(id)).items.filter((i) => i.kind === 'agent').map((i) => i.kind === 'agent' && i.model)).toEqual(['Sonnet 5'])
    expect(dividers(id)).toEqual([])
  })

  // claude-agent-acp announces its own model as the session opens, before it
  // answers; logged, that announcement must not pass for the human's last pick.
  it('runs on the resolved model when the adapter announces its own model as the session opens', async () => {
    setup({ ...ALIASES, model: { id: 'opus', label: 'Opus 5' }, models: ALIASES.models!.slice(1), announceOptions: true })
    const id = await runcastleStarted('claude-sonnet-5')

    expect(received('session/set_config_option').map((p) => [p.configId, p.value])).toEqual([['model', 'sonnet']])
    expect(foldThread(readThreadEvents(id)).model).toMatchObject({ id: 'sonnet', label: 'Sonnet 5' })
    expect(dividers(id)).toEqual([])
  })

  it("runs a 1M model on the adapter's 1M entry, however the adapter spells its context", async () => {
    setup({ ...ALIASES, models: [...ALIASES.models!, { id: 'opus[1m]', label: 'Opus 5 (1M context)' }] })
    const id = await runcastleStarted('claude-opus-5[1m]')
    expect(received('session/set_config_option').map((p) => p.value)).toEqual(['opus[1m]'])
    expect(foldThread(readThreadEvents(id)).model).toMatchObject({ id: 'opus[1m]', label: 'Opus 5 (1M context)' })
  })

  it("finds the 1M entry by Claude Code's alias suffix when its name says nothing of 1M", async () => {
    setup({ ...ALIASES, models: [...ALIASES.models!, { id: 'sonnet[1m]', label: 'Sonnet 5 long' }] })
    await runcastleStarted('claude-sonnet-5[1m]')
    expect(received('session/set_config_option').map((p) => p.value)).toEqual(['sonnet[1m]'])
  })

  it('runs a 1M model the adapter offers no 1M entry for on the same model, never another', async () => {
    setup(ALIASES)
    const id = await runcastleStarted('claude-sonnet-5[1m]')
    expect(received('session/set_config_option').map((p) => p.value)).toEqual(['sonnet'])
    expect(foldThread(readThreadEvents(id)).model).toMatchObject({ id: 'sonnet', label: 'Sonnet 5' })
  })

  it("restarts a thread on the model the human last picked, not its row's, with no divider", async () => {
    setup(ALIASES)
    const id = await runcastleStarted('claude-sonnet-5')
    await caller.thread.setModel({ threadId: id, model: 'claude-haiku-4-5', effort: 'low' })
    expect(dividers(id).map((d) => d.kind === 'model' && d.model)).toEqual(['Haiku 4.5'])
    // The process is gone (an idle stop, a restart): the next adapter opens on its own default.
    await host.stop(id, 'idle')
    await caller.thread.send({ threadId: id, text: 'Again' })
    await logUntil(id, turnsEnded(2))

    expect(fake.last().received.filter((r) => r.method === 'session/set_config_option').map((r) => r.params)).toEqual([
      { sessionId: 'acp-session-1', configId: 'model', value: 'haiku' },
      { sessionId: 'acp-session-1', configId: 'effort', value: 'low' },
    ])
    expect(foldThread(readThreadEvents(id)).model).toMatchObject({ id: 'haiku', effort: 'low' })
    expect(dividers(id).map((d) => d.kind === 'model' && d.model)).toEqual(['Haiku 4.5'])
  })

  // A thread started before the start path stopped logging the adapter's opening announcement carries it unpicked.
  it('restarts a thread nobody picked a model in on the model runcastle resolves, never on a model the adapter reported', async () => {
    setup(ALIASES)
    const id = await runcastleStarted('claude-sonnet-5')
    await host.stop(id, 'idle')
    appendThreadEvent(id, { type: 'model', model: 'opus', label: 'Opus 5' })
    await caller.thread.send({ threadId: id, text: 'Again' })
    await logUntil(id, turnsEnded(2))

    expect(fake.last().received.filter((r) => r.method === 'session/set_config_option').map((r) => r.params)).toEqual([
      { sessionId: 'acp-session-1', configId: 'model', value: 'sonnet' },
    ])
  })

  it('marks every model the human picks, before the thread starts and after, and no model the adapter reports', async () => {
    setup(ALIASES)
    const id = unstarted()
    await caller.thread.setModel({ threadId: id, model: 'claude-haiku-4-5' })
    await caller.thread.send({ threadId: id, text: 'Hello' })
    await logUntil(id, turnsEnded(1))
    await caller.thread.send({ threadId: id, text: 'Again', model: 'claude-sonnet-5' })
    await logUntil(id, turnsEnded(2))
    const plain = await runcastleStarted('claude-sonnet-5')

    const models = (thread: string) => readThreadEvents(thread).flatMap((e) => (e.type === 'model' ? [[e.model, e.picked ?? false]] : []))
    expect(models(id)).toEqual([
      ['haiku', true],
      ['sonnet', true],
    ])
    expect(models(plain)).toEqual([['sonnet', false]])
  })

  describe('a thread nobody picked a model in follows Settings', () => {
    const ANNOUNCING: FakeScript = { ...ALIASES, model: { id: 'opus', label: 'Opus 5' }, models: ALIASES.models!.slice(1), announceOptions: true }
    const setConfigs = () => fake.last().received.filter((r) => r.method === 'session/set_config_option').map((r) => r.params)
    const modelsLogged = (id: string) => readThreadEvents(id).flatMap((e) => (e.type === 'model' ? [[e.model, e.picked ?? false]] : []))

    /**
     * A preparation thread as round 13 left it: its row on a model Settings has
     * since moved off, and its start logged that model `picked`, though nobody
     * touched the picker.
     */
    function stalePrepare(): string {
      const id = createSessionRow(ctx, { projectId, kind: 'prepare', worktreePath: '/wt', model: { id: 'claude-opus-5[1m]', runtime: 'claude-code' } }).id
      markSessionLive(ctx, id, { ccSessionId: 'acp-session-1' })
      for (const body of [
        { type: 'prompt', id: 'prompt_1', text: 'Hello', source: 'human' },
        { type: 'process', state: 'starting' },
        { type: 'process', state: 'running' },
        { type: 'model', model: 'opus[1m]', label: 'Opus 5 (1M)', effort: 'high', picked: true },
        { type: 'process', state: 'stopped' },
      ] as const) {
        appendThreadEvent(id, body)
      }
      markSessionEnded(ctx, id)
      return id
    }

    it('reopens a stale preparation chat with a send on the model Settings resolve now, launch and session alike, logged unpicked', async () => {
      setup(ANNOUNCING)
      ctx.config.stepModels = { ...ctx.config.stepModels, prepare: 'claude-sonnet-5' }
      const id = stalePrepare()
      expect((await caller.thread.models({ threadId: id })).current).toBe('claude-sonnet-5')

      await caller.thread.send({ threadId: id, text: 'Again' })
      await logUntil(id, turnsEnded(1))

      expect(launched.map((r) => r.model)).toEqual(['claude-sonnet-5'])
      expect(getSessionRow(ctx, id)?.model).toBe('claude-sonnet-5')
      expect(setConfigs()).toEqual([{ sessionId: 'acp-session-1', configId: 'model', value: 'sonnet' }])
      expect(modelsLogged(id).at(-1)).toEqual(['sonnet', false])
    })

    it('moves an unpicked thread to a new Settings model on its next start, and keeps a human pick across restarts', async () => {
      setup(ANNOUNCING)
      ctx.config.model = 'claude-sonnet-5'
      const unpicked = chat()
      const picked = chat()
      await converse(unpicked, 'Hello')
      await converse(picked, 'Hello')
      await caller.thread.setModel({ threadId: picked, model: 'claude-sonnet-5' })
      await host.stopAll('idle')

      ctx.config.model = 'claude-haiku-4-5'
      expect((await caller.thread.models({ threadId: unpicked })).current).toBe('haiku')
      expect((await caller.thread.models({ threadId: picked })).current).toBe('sonnet')
      await caller.thread.send({ threadId: unpicked, text: 'Again' })
      await logUntil(unpicked, turnsEnded(2))
      expect(setConfigs().map((p) => p.value)).toEqual(['haiku'])
      await caller.thread.send({ threadId: picked, text: 'Again' })
      await logUntil(picked, turnsEnded(2))
      expect(setConfigs().map((p) => p.value)).toEqual(['sonnet'])
      expect(launched.map((r) => r.model)).toEqual(['claude-sonnet-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-sonnet-5'])
    })
  })

  it('knows, before a thread starts, the effort each model starts on and the efforts every model takes', async () => {
    setup(ALIASES)
    await converse(chat(), 'Hello')
    const id = unstarted()
    const { models, current } = await caller.thread.models({ threadId: id })

    // The session opened on Opus at High, and said Opus's levels.
    expect(models.find((m) => m.id === current)).toMatchObject({ label: 'Opus 5', defaultEffort: 'high', efforts: ['low', 'medium', 'high', 'max'], fast: true })
    // No session ran on Sonnet or Haiku: they take the levels Claude Code offers.
    for (const label of ['Sonnet 5', 'Haiku 4.5']) expect(models.find((m) => m.label === label)?.efforts).toEqual(['low', 'medium', 'high', 'max'])

    // Sending the effort shown asks nothing of the agent: it starts on it.
    await caller.thread.send({ threadId: id, text: 'Hello', model: current!, effort: 'high', fast: false })
    await logUntil(id, turnsEnded(1))
    expect(fake.last().received.filter((r) => r.method === 'session/set_config_option')).toEqual([])
    expect(foldThread(readThreadEvents(id)).model).toMatchObject({ effort: 'high' })
  })
})

describe("a runtime's one model catalog", () => {
  /** Claude's list as claude-agent-acp gives it: "Default (recommended)" first, describing the model it stands for. */
  const CLAUDE: FakeScript = {
    model: { id: 'default', label: 'Default (recommended)', description: 'Opus 5.5' },
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', description: 'Most capable for complex work' },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', description: 'Best for everyday tasks' },
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    ],
    options: 'claude',
  }
  const EFFORTS = ['low', 'medium', 'high', 'max']
  const OPUS = { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Most capable for complex work', fast: true, efforts: EFFORTS, defaultEffort: 'high' }
  const LIST = [
    OPUS,
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Best for everyday tasks', efforts: EFFORTS },
    { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: EFFORTS, fast: true },
  ]

  it('answers the same list, ids and labels before the agent starts, while it runs and after it stops', async () => {
    setup(CLAUDE)
    const id = chat()
    await converse(id, 'Hello')
    const running = await caller.thread.models({ threadId: id })
    expect(running).toEqual({ runtime: 'claude-code', models: LIST, current: 'claude-opus-5-5' })
    await host.stop(id, 'idle')
    expect(await caller.thread.models({ threadId: id })).toEqual(running)

    // A fresh server: nothing in memory, the catalog read from disk.
    setup(CLAUDE)
    const fresh = createSessionRow(ctx, { featureId, kind: 'side', worktreePath: '/wt' }).id
    expect(await caller.thread.models({ threadId: fresh })).toEqual(running)
    expect(await caller.thread.models({ featureId })).toEqual(running)
    expect(fake.processes).toHaveLength(0)
  })

  it('names the model Default stands for, and never writes "Default (recommended)" in the thread', async () => {
    setup(CLAUDE)
    const id = chat()
    await converse(id, 'Hello')
    const models = await caller.thread.models({ threadId: id })
    expect(models.models.map((m) => m.label)).not.toContain('Default (recommended)')
    expect(foldThread(readThreadEvents(id)).model).toMatchObject({ id: 'claude-opus-5-5', label: 'Opus 5.5' })
    // Asking for the model Default already stands for changes nothing.
    await caller.thread.send({ threadId: id, text: 'Same', model: 'claude-opus-5-5' })
    await logUntil(id, turnsEnded(2))
    expect(received('session/set_config_option')).toEqual([])
    await caller.thread.setModel({ threadId: id, model: 'claude-sonnet-5-5' })
    await caller.thread.setModel({ threadId: id, model: 'claude-opus-5-5' })
    expect(said(id).filter((s) => s.startsWith('model:'))).toEqual(['model:Sonnet 5.5', 'model:Opus 5.5'])
  })

  it('learns each model’s effort levels from the sessions that ran on it', async () => {
    setup(CLAUDE)
    const id = chat()
    await converse(id, 'Hello')
    await caller.thread.setModel({ threadId: id, model: 'claude-sonnet-5-5' })
    const { models } = await caller.thread.models({ threadId: id })
    expect(models.find((m) => m.id === 'claude-sonnet-5-5')?.efforts).toEqual(['low', 'medium', 'high', 'max'])
    expect(models.find((m) => m.id === 'claude-opus-5-5')?.efforts).toEqual(['low', 'medium', 'high', 'max'])
    // No session ran on Opus 4.8: it takes what one said of Opus.
    expect(models.find((m) => m.id === 'claude-opus-4-8')).toMatchObject({ efforts: ['low', 'medium', 'high', 'max'], fast: true })
  })

  it("maps runcastle's roster to adapter-style labels, once per model, before any session has reported", async () => {
    ctx.config = {
      ...ctx.config,
      models: [
        { id: 'claude-haiku-4-5-20251001', runtime: 'claude-code', note: 'quick lookups' },
        { id: 'claude-opus-4-8', runtime: 'claude-code', note: 'opus 4.8 — UI work' },
      ],
    }
    const id = chat()
    const { models, current } = await caller.thread.models({ threadId: id })
    const labels = models.map((m) => m.label)
    expect(labels).toEqual(expect.arrayContaining(['Opus 5', 'Opus 5 (1M)', 'Opus 4.8', 'Haiku 4.5']))
    expect(labels.filter((l) => l.startsWith('claude-'))).toEqual([])
    expect(new Set(labels).size).toBe(labels.length)
    expect(models.find((m) => m.label === 'Haiku 4.5')).toMatchObject({ id: 'claude-haiku-4-5', note: 'quick lookups' })
    expect(models.find((m) => m.label === 'Opus 4.8')?.note).toBe('opus 4.8 — UI work')
    expect(models.map((m) => m.id)).toContain(current)
    expect(fake.processes).toHaveLength(0)
  })

  it("keeps the operator's notes on the adapter's models once a session has reported", async () => {
    ctx.config = { ...ctx.config, models: [{ id: 'claude-opus-4-8', runtime: 'claude-code', note: 'opus 4.8 — UI work' }] }
    setup(CLAUDE)
    const id = chat()
    await converse(id, 'Hello')
    const { models } = await caller.thread.models({ threadId: id })
    expect(models.find((m) => m.id === 'claude-opus-4-8')?.note).toBe('opus 4.8 — UI work')
    expect(models).toHaveLength(3)
  })
})

describe('compact', () => {
  /** A turn that compacts on the compaction command the way both adapters report it, and answers anything else. */
  function compactOnCommand(): void {
    fake.script.turn = async (t) => {
      const said = t.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('')
      if (said !== '/compact') return void (await t.say('Done.'))
      await t.update({ sessionUpdate: 'compaction_update', compactionId: 'cmp1', status: 'in_progress' } as never)
      await t.update({ sessionUpdate: 'compaction_update', compactionId: 'cmp1', status: 'completed' } as never)
    }
  }

  for (const runtime of ['claude-code', 'codex'] as const) {
    it(`sends ${runtime}'s compaction command with no message of the human's, and shows the divider`, async () => {
      setup()
      compactOnCommand()
      const id = chat({ runtime })
      await converse(id, 'Hello')
      expect(await caller.thread.compact({ threadId: id })).toEqual({ ok: true })
      const events = await logUntil(id, turnsEnded(2))
      expect(received('session/prompt').at(-1)).toMatchObject({ prompt: [{ type: 'text', text: '/compact' }] })
      expect(events.find((e) => e.type === 'prompt' && e.text === '/compact')).toMatchObject({ source: 'runcastle', hidden: true })
      const view = foldThread(events)
      expect(view.items.map((i) => (i.kind === 'user' ? `user:${i.text}` : i.kind))).toEqual(['user:Hello', 'agent', 'compacted'])
      expect(view.state).toBe('idle')
      // Both adapters send `compaction_update` only to a client that says it takes them.
      expect(received('initialize')[0]).toMatchObject({ clientCapabilities: { session: { compaction: {} } } })
    })
  }

  it('starts a stopped agent to compact; the resumed chat’s opening waits for the next message rather than riding on the command', async () => {
    setup()
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, lifecycle: { opening: () => '[state]' } })
    setAgentHostForTests(host)
    compactOnCommand()
    const id = chat()
    await caller.thread.compact({ threadId: id })
    await logUntil(id, turnsEnded(1))
    await caller.thread.send({ threadId: id, text: 'Hello' })
    await logUntil(id, turnsEnded(2))
    expect(fake.processes).toHaveLength(1)
    expect(received('session/prompt').map((p) => p.prompt)).toEqual([
      [{ type: 'text', text: '/compact' }],
      [{ type: 'text', text: 'Hello\n\n[state]' }],
    ])
  })

  it('is refused while a turn runs', async () => {
    setup()
    const id = chat()
    let finish = () => {}
    fake.script.turn = async (t) => {
      await t.say('Working')
      await new Promise<void>((r) => (finish = r))
    }
    await caller.thread.send({ threadId: id, text: 'Long job' })
    await logUntil(id, (events) => events.some((e) => e.type === 'agent_text'))
    await expect(caller.thread.compact({ threadId: id })).rejects.toThrow(/working/)
    finish()
    await logUntil(id, turnsEnded(1))
    expect(received('session/prompt')).toHaveLength(1)
  })
})

describe('edit and rewind', () => {
  it('forks the conversation at the answer before the edited message and sends the new words', async () => {
    setup()
    answerWithIds()
    const id = chat()
    const [, second] = await converse(id, 'first', 'second')
    const { promptId } = await caller.thread.edit({ threadId: id, promptId: second, text: 'second, better' })
    const events = await logUntil(id, turnsEnded(3))
    expect(received('session/fork')).toEqual([
      expect.objectContaining({ sessionId: 'acp-session-1', cwd: '/wt', _meta: expect.objectContaining({ jetbrains: { air: { fork: { version: 1, messageId: 'm1' } } } }) }),
    ])
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe('acp-session-1-fork-1')
    // The superseded turn stays in the log; the fold leaves it out.
    expect(events.some((e) => e.type === 'prompt' && e.text === 'second')).toBe(true)
    expect(events.find((e) => e.type === 'rewound')).toMatchObject({ toPromptId: second })
    expect(said(id)).toEqual(['user:first', 'agent:answer 1', 'user:second, better', 'agent:answer 3'])
    expect(events.find((e) => e.type === 'prompt' && e.id === promptId)).toMatchObject({ text: 'second, better', source: 'human' })
    expect(rewindFiles).not.toHaveBeenCalled()
  })

  it('undoes the file changes since the message first, on Claude', async () => {
    setup()
    answerWithIds()
    const id = chat()
    const [, second] = await converse(id, 'first', 'second')
    await caller.thread.edit({ threadId: id, promptId: second, text: 'other', undoFiles: true })
    await logUntil(id, turnsEnded(3))
    expect(rewindFiles).toHaveBeenCalledWith({ sessionId: 'acp-session-1', cwd: '/wt', text: 'second', occurrence: 1 })
  })

  it('says which files the rewound turns changed that the undo left as they are, and nothing when it restored them all', async () => {
    setup()
    let n = 0
    const edit = (path: string) => ({ type: 'diff' as const, path: join('/wt', path), oldText: 'a\n', newText: 'b\n' })
    fake.script.turn = async (t) => {
      n++
      const files = n === 1 ? ['first.ts'] : n === 2 ? ['src/edited.ts', 'built.js'] : []
      for (const [k, path] of files.entries()) await t.update({ sessionUpdate: 'tool_call', toolCallId: `c${n}-${k}`, title: `Edit ${path}`, kind: 'edit', status: 'completed', content: [edit(path)] })
      await t.say(`answer ${n}`, `m${n}`)
    }
    const id = chat()
    const [, second] = await converse(id, 'first', 'second')
    rewindFiles.mockResolvedValueOnce([join('/wt', 'src', 'edited.ts')])
    await caller.thread.edit({ threadId: id, promptId: second, text: 'other', undoFiles: true })
    await logUntil(id, turnsEnded(3))
    const notices = foldThread(readThreadEvents(id)).items.filter((i) => i.kind === 'notice')
    expect(notices).toEqual([expect.objectContaining({ text: 'Left as they are — changed outside the agent’s edit tools, so not undone: built.js' })])

    const again = (await caller.thread.send({ threadId: id, text: 'more' })).promptId
    await logUntil(id, turnsEnded(4))
    rewindFiles.mockResolvedValueOnce([])
    await caller.thread.edit({ threadId: id, promptId: again, text: 'other again', undoFiles: true })
    await logUntil(id, turnsEnded(5))
    expect(foldThread(readThreadEvents(id)).items.filter((i) => i.kind === 'notice')).toHaveLength(1)
  })

  it('rewinds the conversation only on Codex, whatever undoFiles says', async () => {
    setup({ model: { id: 'gpt-5.5', label: '5.5' } })
    answerWithIds()
    const id = chat({ runtime: 'codex' })
    const [, second] = await converse(id, 'first', 'second')
    await caller.thread.edit({ threadId: id, promptId: second, text: 'other', undoFiles: true })
    await logUntil(id, turnsEnded(3))
    expect(rewindFiles).not.toHaveBeenCalled()
    expect(received('session/fork')).toHaveLength(1)
  })

  it('starts the conversation afresh when the first message is edited', async () => {
    setup()
    answerWithIds()
    const id = chat()
    const [first] = await converse(id, 'first', 'second')
    await caller.thread.edit({ threadId: id, promptId: first, text: 'start over' })
    await logUntil(id, turnsEnded(3))
    expect(received('session/fork')).toEqual([])
    expect(received('session/new')).toHaveLength(2)
    expect(said(id)).toEqual(['user:start over', 'agent:answer 3'])
  })

  it("tells the agent the message was replaced when the adapter gave its answers no ids to fork at", async () => {
    setup()
    const id = chat()
    const [, second] = await converse(id, 'first', 'second')
    await caller.thread.edit({ threadId: id, promptId: second, text: 'second, better' })
    await logUntil(id, turnsEnded(3))
    expect(received('session/fork')).toEqual([])
    const sent = received('session/prompt').at(-1) as { prompt: { text: string }[] }
    expect(sent.prompt[0].text).toMatch(/^\[runcastle\] The human edited an earlier message[\s\S]*\("second"\)[\s\S]*\n\nsecond, better$/)
    expect(said(id)).toEqual(['user:first', 'agent:Done.', 'user:second, better', 'agent:Done.'])
  })

  it('refuses an edit while the agent works', async () => {
    setup({ turn: async (t) => void (await t.cancelled) })
    const id = chat()
    const { promptId } = await caller.thread.send({ threadId: id, text: 'long' })
    await logUntil(id, (e) => e.some((x) => x.type === 'turn_started'))
    await expect(caller.thread.edit({ threadId: id, promptId, text: 'x' })).rejects.toThrow(/working/)
    await expect(caller.thread.edit({ threadId: id, promptId: 'prompt_nope', text: 'x' })).rejects.toThrow(/no message/)
  })
})

describe('branch', () => {
  it('starts a side thread with the conversation through that turn, forked there when it is first sent to', async () => {
    setup()
    answerWithIds()
    const id = chat()
    const [first] = await converse(id, 'first', 'second')
    const { threadId: branched } = await caller.thread.branch({ threadId: id, promptId: first })
    expect(branched).not.toBe(id)
    expect(fake.processes).toHaveLength(1)
    expect(received('session/fork')).toEqual([])
    const copied = readThreadEvents(branched)
    expect(copied.map((e) => e.i)).toEqual(copied.map((_, n) => n))
    expect(said(branched)).toEqual(['user:first', 'agent:answer 1'])
    const row = getSessionRow(ctx, branched)!
    expect(row).toMatchObject({ kind: 'side', featureId, worktreePath: '/wt', openedBeside: id })
    const named = async (thread: string) => (await caller.thread.list({ featureId })).find((t) => t.id === thread)
    // Named as a branch of its parent until the human writes in it.
    expect(await named(branched)).toMatchObject({ role: 'side', title: 'Branch of first' })

    await caller.thread.send({ threadId: branched, text: 'onwards' })
    await logUntil(branched, turnsEnded(2))
    expect(received('session/fork')).toEqual([expect.objectContaining({ sessionId: 'acp-session-1', _meta: expect.objectContaining({ jetbrains: { air: { fork: { version: 1, messageId: 'm1' } } } }) })])
    expect(getSessionRow(ctx, branched)!.ccSessionId).toBe('acp-session-1-fork-1')
    expect(said(branched)).toEqual(['user:first', 'agent:answer 1', 'user:onwards', 'agent:answer 3'])
    expect(await named(branched)).toMatchObject({ title: 'onwards' })
    expect(await named(id)).toMatchObject({ title: 'first' })
    // The thread it came from is as it was.
    expect(said(id)).toEqual(['user:first', 'agent:answer 1', 'user:second', 'agent:answer 2'])
  })

  it('branches a project chat into a new project chat', async () => {
    setup()
    answerWithIds()
    const id = chat({ kind: 'project' })
    const [first] = await converse(id, 'first')
    await caller.thread.rename({ threadId: id, title: 'Release notes' })
    const { threadId: branched } = await caller.thread.branch({ threadId: id, promptId: first })
    expect(getSessionRow(ctx, branched)).toMatchObject({ kind: 'project', projectId })
    const named = async (thread: string) => (await caller.thread.list({ projectId })).find((t) => t.id === thread)?.title
    // The parent's rename, copied with its log, is the parent's name, not the branch's.
    expect(await named(branched)).toBe('Branch of Release notes')
    await caller.thread.rename({ threadId: branched, title: 'Changelog' })
    expect(await named(branched)).toBe('Changelog')
    expect(await named(id)).toBe('Release notes')
  })
})

describe('usage', () => {
  const claudeUsage = { usage: { rate_limits: { five_hour: { utilization: 42, resets_at: '2026-10-27T15:40:00Z' } }, subscription_type: 'max' } }

  it('reads the Claude account through the usage mapper, with the plan the adapter pushed', async () => {
    setup({ authStatus: { kind: 'subscription', label: 'Claude Max 20x' } })
    readUsage.mockResolvedValue(claudeUsage)
    const id = chat()
    await converse(id, 'Hello')
    const report = await caller.thread.usage({ threadId: id })
    expect(readUsage).toHaveBeenCalledWith('claude-code')
    expect(report).toMatchObject({ plan: 'Claude Max 20x', limits: [{ label: 'Current 5-hour window', percent: 42 }] })
  })

  it('reads the Codex rate limits through the usage mapper', async () => {
    setup({ model: { id: 'gpt-5.5', label: '5.5' } })
    readUsage.mockResolvedValue({ rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1_800_000_000 }, planType: 'pro' } })
    const id = chat({ runtime: 'codex' })
    await converse(id, 'Hello')
    expect(await caller.thread.usage({ threadId: id })).toMatchObject({ plan: 'ChatGPT Pro', limits: [{ label: 'Current 5-hour window', percent: 10 }] })
    expect(readUsage).toHaveBeenCalledWith('codex')
  })

  it("reads the account for a thread whose agent does not run, without starting it", async () => {
    readUsage.mockResolvedValue({ rateLimits: { primary: { usedPercent: 13, windowDurationMins: 43200, resetsAt: 1_800_000_000 }, planType: 'free' } })
    const idle = chat({ runtime: 'codex' })
    expect(await caller.thread.usage({ threadId: idle })).toMatchObject({ plan: 'ChatGPT Free', limits: [{ label: 'Current 30-day window', percent: 13 }] })
    expect(readUsage).toHaveBeenCalledWith('codex')
    expect(fake.processes).toHaveLength(0)
  })

  it("answers every thread of the runtime from one read for a minute, then reads again", async () => {
    readUsage.mockResolvedValue(claudeUsage)
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      const read = await caller.thread.usage({ threadId: chat() })
      expect(await caller.thread.usage({ threadId: chat() })).toEqual(read)
      expect(readUsage).toHaveBeenCalledTimes(1)

      now.mockReturnValue(1_000_000 + 61_000)
      await caller.thread.usage({ threadId: chat() })
      expect(readUsage).toHaveBeenCalledTimes(2)
    } finally {
      now.mockRestore()
    }
  })

  it('degrades to the last report when the read fails', async () => {
    readUsage.mockRejectedValue(new Error('no'))
    const id = chat()
    expect(await caller.thread.usage({ threadId: id })).toEqual({ limits: [] })
  })
})

describe('files, titles, suggestions, export', () => {
  it("ranks the worktree's tracked and untracked files like a fuzzy finder, leaving ignored ones out", async () => {
    const repo = tmpRepo()
    temps.push(repo)
    const write = (path: string) => {
      mkdirSync(join(repo, path, '..'), { recursive: true })
      writeFileSync(join(repo, path), '')
    }
    for (const path of ['src/threads/controls.ts', 'src/threads/host.ts', 'README.md', 'docs/control-plane.md', 'hostile/a.md', 'src/components/ThreadSwitcher.tsx']) write(path)
    for (const path of ['untracked.ts', '.gitignore', 'dist/bundle.js']) write(path)
    writeFileSync(join(repo, '.gitignore'), 'dist/\n')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['add', 'src', 'README.md', 'docs', 'hostile'], { cwd: repo })
    const id = chat({ worktreePath: repo })
    // A file name's match first, however long the path; at the same rank the shorter path.
    expect(await caller.thread.files({ threadId: id, query: 'host' })).toEqual(['src/threads/host.ts', 'hostile/a.md', 'src/threads/controls.ts'])
    expect(await caller.thread.files({ threadId: id, query: 'control' })).toEqual(['docs/control-plane.md', 'src/threads/controls.ts'])
    // Word starts: ThreadSwitcher's T and S.
    expect(await caller.thread.files({ threadId: id, query: 'thsw' })).toEqual(['src/components/ThreadSwitcher.tsx'])
    expect(await caller.thread.files({ threadId: id, query: '', limit: 2 })).toEqual(['README.md', '.gitignore'])
    expect(await caller.thread.files({ threadId: id, query: 'untracked' })).toEqual(['untracked.ts'])
    expect(await caller.thread.files({ threadId: id, query: 'bundle' })).toEqual([])

    // A file the agent writes in a turn is there once the turn ends.
    setup({
      turn: async () => {
        write('src/threads/naming.ts')
      },
    })
    expect(await caller.thread.files({ threadId: id, query: 'naming' })).toEqual([])
    await converse(id, 'Add naming')
    expect(await caller.thread.files({ threadId: id, query: 'naming' })).toEqual(['src/threads/naming.ts'])
  })

  it('renames a thread, and keeps the name over a title the runtime generates later', async () => {
    setup({
      turn: async (t) => {
        await t.update({ sessionUpdate: 'session_info_update', title: 'Generated title' })
        await t.say('Done.')
      },
    })
    const id = chat()
    await converse(id, 'Hello')
    expect(getSessionRow(ctx, id)!.title).toBe('Generated title')
    expect((await caller.thread.list({ featureId }))[0]).toMatchObject({ id, title: 'Generated title' })

    expect(await caller.thread.rename({ threadId: id, title: 'Login page' })).toEqual({ ok: true })
    await converse(id, 'Hello')
    await logUntil(id, turnsEnded(2))
    expect((await caller.thread.list({ featureId }))[0]).toMatchObject({ id, title: 'Login page' })
    expect((await caller.thread.view({ threadId: id })).title).toBe('Login page')
  })

  it("shows Claude's prompt suggestion in the fold", async () => {
    setup({
      turn: async (t) => {
        await t.say('Done.')
        await t.update({ sessionUpdate: 'session_info_update', _meta: { promptSuggestions: { suggestions: [{ text: 'Run the tests' }] } } })
      },
    })
    const id = chat()
    await converse(id, 'Hello')
    expect((await caller.thread.view({ threadId: id })).suggestion).toBe('Run the tests')
  })

  it('exports the thread as Markdown', async () => {
    setup({
      turn: async (t) => {
        await t.update({ sessionUpdate: 'tool_call', toolCallId: 'r1', title: 'README.md', kind: 'read', status: 'completed' })
        await t.update({ sessionUpdate: 'tool_call', toolCallId: 'r2', title: 'host.ts', kind: 'read', status: 'completed' })
        await t.update({ sessionUpdate: 'tool_call', toolCallId: 'x1', title: 'bun test', kind: 'execute', status: 'completed' })
        await t.say('All green.')
      },
    })
    const id = chat()
    await caller.thread.rename({ threadId: id, title: 'Tests' })
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
    await caller.thread.send({ threadId: id, text: 'Run them', images: [{ name: 'crop.png', mimeType: 'image/png', data: png }] })
    await logUntil(id, turnsEnded(1))
    const { markdown } = await caller.thread.export({ threadId: id })
    const src = (readThreadEvents(id).find((e) => e.type === 'prompt') as Extract<ThreadEvent, { type: 'prompt' }>).images![0].src
    expect(markdown).toBe(
      ['# Tests', '## You', `Run them\n\n![crop.png](${src})`, '## Agent', '*Worked for 0s: read 2 files, ran 1 command*', 'All green.'].join('\n\n') + '\n',
    )
  })
})
