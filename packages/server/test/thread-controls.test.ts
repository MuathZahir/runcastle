import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { foldThread, type AgentRuntime, type ThreadEvent } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow } from '../src/launcher/sessions'
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
let rewindFiles: ReturnType<typeof vi.fn<(input: { sessionId: string; cwd: string; text: string; occurrence: number }) => Promise<void>>>
const temps: string[] = []

beforeEach(async () => {
  ctx = await makeTestCtx()
  caller = createCallerFactory(appRouter)(ctx)
  projectId = seedProject(ctx).id
  featureId = seedFeature(ctx, projectId).id
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
  rewindFiles = vi.fn(async () => {})
  host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, readUsage, rewindFiles })
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
    expect(await caller.thread.models({ threadId: id })).toEqual([
      { id: 'claude-opus-5-5', label: 'Opus 5.5', fast: true },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    ])
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

  it("answers a never-started thread's models from runcastle's roster without starting an agent", async () => {
    const id = chat()
    const models = await caller.thread.models({ threadId: id })
    expect(models.length).toBeGreaterThan(0)
    expect(models.some((m) => m.fast)).toBe(false)
    expect(fake.processes).toHaveLength(0)
  })

  it('says fast mode is offered on the model the session runs on only when the runtime offers it', async () => {
    setup({ model: { id: 'gpt-5.5', label: '5.5' }, models: [{ id: 'gpt-5.5-mini', label: '5.5 Mini' }], options: 'codex' })
    const codex = chat({ runtime: 'codex' })
    await converse(codex, 'Hello')
    expect(await caller.thread.models({ threadId: codex })).toEqual([
      { id: 'gpt-5.5', label: '5.5', fast: true },
      { id: 'gpt-5.5-mini', label: '5.5 Mini' },
    ])
    setup({ models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }] })
    const plain = chat()
    await converse(plain, 'Hello')
    expect((await caller.thread.models({ threadId: plain })).some((m) => m.fast)).toBe(false)
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
    expect((await caller.thread.list({ featureId })).find((t) => t.id === branched)).toMatchObject({ role: 'side', title: 'first' })

    await caller.thread.send({ threadId: branched, text: 'onwards' })
    await logUntil(branched, turnsEnded(2))
    expect(received('session/fork')).toEqual([expect.objectContaining({ sessionId: 'acp-session-1', _meta: expect.objectContaining({ jetbrains: { air: { fork: { version: 1, messageId: 'm1' } } } }) })])
    expect(getSessionRow(ctx, branched)!.ccSessionId).toBe('acp-session-1-fork-1')
    expect(said(branched)).toEqual(['user:first', 'agent:answer 1', 'user:onwards', 'agent:answer 3'])
    // The thread it came from is as it was.
    expect(said(id)).toEqual(['user:first', 'agent:answer 1', 'user:second', 'agent:answer 2'])
  })

  it('branches a project chat into a new project chat', async () => {
    setup()
    answerWithIds()
    const id = chat({ kind: 'project' })
    const [first] = await converse(id, 'first')
    const { threadId: branched } = await caller.thread.branch({ threadId: id, promptId: first })
    expect(getSessionRow(ctx, branched)).toMatchObject({ kind: 'project', projectId })
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

  it('starts nothing for an idle thread: the last report for the runtime, else no limits', async () => {
    readUsage.mockResolvedValue(claudeUsage)
    const idle = chat()
    expect(await caller.thread.usage({ threadId: idle })).toEqual({ limits: [] })
    expect(fake.processes).toHaveLength(0)
    expect(readUsage).not.toHaveBeenCalled()

    const id = chat()
    await converse(id, 'Hello')
    const read = await caller.thread.usage({ threadId: id })
    expect(await caller.thread.usage({ threadId: idle })).toEqual(read)
  })

  it('degrades to the last report when the read fails', async () => {
    readUsage.mockRejectedValue(new Error('no'))
    const id = chat()
    await converse(id, 'Hello')
    expect(await caller.thread.usage({ threadId: id })).toEqual({ limits: [] })
  })
})

describe('files, titles, suggestions, export', () => {
  it("fuzzy-matches the worktree's tracked files, shortest first", async () => {
    const repo = tmpRepo()
    temps.push(repo)
    for (const path of ['src/threads/controls.ts', 'src/threads/host.ts', 'README.md', 'docs/control-plane.md', 'untracked.ts']) {
      mkdirSync(join(repo, path, '..'), { recursive: true })
      writeFileSync(join(repo, path), '')
    }
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['add', 'src', 'README.md', 'docs'], { cwd: repo })
    const id = chat({ worktreePath: repo })
    expect(await caller.thread.files({ threadId: id, query: 'thcon' })).toEqual(['src/threads/controls.ts'])
    expect(await caller.thread.files({ threadId: id, query: 'CONTROL' })).toEqual(['docs/control-plane.md', 'src/threads/controls.ts'])
    expect(await caller.thread.files({ threadId: id, query: '', limit: 2 })).toEqual(['README.md', 'src/threads/host.ts'])
    expect(await caller.thread.files({ threadId: id, query: 'untracked' })).toEqual([])
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
