import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { foldThread, type ThreadEvent, type ThreadItem } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { createAgentHost, type AgentHostDeps } from '../src/threads/host'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp, type FakeScript, type FakeTurn } from './support/fake-acp-agent'

/**
 * The agent host (chat-as-web-components ticket 1) against an in-process fake
 * ACP agent: starting a thread, turning a turn into the log, steering,
 * queueing, cancel, crash, idle stop, and asks.
 */

let ctx: AppCtx
let featureId: string
let fake: FakeAcp
let host: AgentHost

const IDLE_MS = 60_000

beforeEach(async () => {
  ctx = await makeTestCtx()
  featureId = seedFeature(ctx, seedProject(ctx).id).id
})

afterEach(async () => {
  await host?.stopAll('shutdown')
  vi.useRealTimers()
})

function setup(script: FakeScript = {}, deps: Partial<AgentHostDeps> = {}): void {
  fake = createFakeAcp(script)
  host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, idleMs: IDLE_MS, ...deps })
}

function thread(opts: { ccSessionId?: string; purpose?: 'self-plan' } = {}): string {
  const row = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt', ...(opts.purpose ? { purpose: opts.purpose } : {}) })
  if (opts.ccSessionId) {
    markSessionLive(ctx, row.id, { ccSessionId: opts.ccSessionId })
  }
  return row.id
}

/** Wait until the thread's log satisfies `done`. */
async function logUntil(id: string, done: (events: ThreadEvent[]) => boolean, ms = 3000): Promise<ThreadEvent[]> {
  const deadline = Date.now() + ms
  for (;;) {
    const events = readThreadEvents(id)
    if (done(events)) return events
    if (Date.now() > deadline) throw new Error(`log never got there: ${events.map((e) => e.type).join(', ')}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

const turnsEnded = (n: number) => (events: ThreadEvent[]) => events.filter((e) => e.type === 'turn_ended').length >= n
const has = (type: ThreadEvent['type']) => (events: ThreadEvent[]) => events.some((e) => e.type === type)
const methods = () => fake.processes.flatMap((p) => p.received.map((r) => r.method))
const prompts = () => fake.processes.flatMap((p) => p.received.filter((r) => r.method === 'session/prompt').map((r) => r.params as { prompt: { text?: string }[] }))

describe('starting a thread', () => {
  it('starts with session/new, records the agent session id and the model, and applies the launch posture', async () => {
    setup()
    const id = thread()
    const { promptId } = await host.prompt(id, { text: 'Hello' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(events.map((e) => e.type)).toEqual(['prompt', 'process', 'process', 'model', 'turn_started', 'agent_text', 'turn_ended'])
    expect(events[0]).toMatchObject({ type: 'prompt', id: promptId, text: 'Hello', source: 'human' })
    expect(events[3]).toMatchObject({ model: 'claude-opus-5-5', label: 'Opus 5.5' })
    expect(methods()).toEqual(['initialize', 'session/new', 'session/set_mode', 'session/prompt'])
    expect(fake.last().received[0].params).toMatchObject({ clientCapabilities: { terminal: false, elicitation: { form: {}, url: {} } } })
    const row = getSessionRow(ctx, id)!
    expect(row.ccSessionId).toBe('acp-session-1')
    expect(row.status).toBe('live')
    expect(row.awaitingInput).toBe(true)
    expect(host.isRunning(id)).toBe(true)
  })

  it('loads the conversation when the row has one, without logging its replayed history', async () => {
    setup({ replay: [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'from before' } }, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review' }] }] })
    const id = thread({ ccSessionId: 'cc-old' })
    await host.prompt(id, { text: 'Again' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(fake.last().received[1]).toMatchObject({ method: 'session/load', params: { sessionId: 'cc-old', cwd: '/wt', mcpServers: [] } })
    expect(events.some((e) => e.type === 'agent_text' && e.text === 'from before')).toBe(false)
    expect(foldThread(events).commands).toEqual([{ name: 'review', description: 'Review' }])
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe('cc-old')
  })

  it('logs a start that fails as a stopped process with the reason', async () => {
    setup({ failSession: 'not logged in' })
    const id = thread()
    await host.prompt(id, { text: 'Hello' }, { source: 'human' })
    const events = await logUntil(id, (e) => e.some((x) => x.type === 'process' && x.state === 'stopped'))
    const view = foldThread(events)
    expect(view.items.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('not logged in') })
    expect(host.isRunning(id)).toBe(false)
  })
})

describe('reopening a conversation after a restart', () => {
  const stoppedWithError = (e: ThreadEvent[]) => e.some((x) => x.type === 'process' && x.state === 'stopped')

  it('reloads the conversation it started, in the directory it started it in', async () => {
    setup()
    const id = thread()
    await host.prompt(id, { text: 'Hello' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))
    await host.stopAll('shutdown')

    // A new server run: a new host, with the row as the last run left it.
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, idleMs: IDLE_MS })
    await host.prompt(id, { text: 'Still there?' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(2))
    expect(fake.processes[0].received[1]).toMatchObject({ method: 'session/new', params: { cwd: '/wt' } })
    expect(fake.last().received.map((r) => r.method)).toEqual(['initialize', 'session/load', 'session/set_mode', 'session/prompt'])
    expect(fake.last().received[1].params).toMatchObject({ sessionId: 'acp-session-1', cwd: '/wt' })
    expect(foldThread(events).items.some((i) => i.kind === 'notice')).toBe(false)
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe('acp-session-1')
  })

  it('does not start a new conversation when the load fails for another reason', async () => {
    setup({ loadError: 'Claude native binary not found for win32-x64' })
    const id = thread({ ccSessionId: 'cc-old' })
    await host.prompt(id, { text: 'Again' }, { source: 'human' })
    const events = await logUntil(id, stoppedWithError)
    expect(methods()).toEqual(['initialize', 'session/load'])
    expect(foldThread(events).items.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('native binary not found') })
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe('cc-old')
  })

  it('does not start a new conversation over one the adapter calls gone that is still on disk', async () => {
    const onDisk = vi.fn(() => true)
    setup({ gone: true }, { conversationOnDisk: onDisk })
    const id = thread({ ccSessionId: 'cc-on-disk' })
    await host.prompt(id, { text: 'Again' }, { source: 'human' })
    const events = await logUntil(id, stoppedWithError)
    expect(onDisk).toHaveBeenCalledWith('claude-code', 'cc-on-disk')
    expect(methods()).toEqual(['initialize', 'session/load'])
    const view = foldThread(events)
    expect(view.items.some((i) => i.kind === 'notice')).toBe(false)
    expect(view.items.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('would not reopen') })
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe('cc-on-disk')
  })

  it('refuses a new conversation that comes back under the gone one’s id', async () => {
    setup({ gone: true, sessionId: 'cc-gone' }, { conversationOnDisk: () => false })
    const id = thread({ ccSessionId: 'cc-gone' })
    await host.prompt(id, { text: 'Again' }, { source: 'human' })
    await logUntil(id, stoppedWithError)
    expect(methods()).toEqual(['initialize', 'session/load', 'session/new'])
    expect(prompts()).toHaveLength(0)
  })
})

describe('a turn', () => {
  it('becomes the work, the answer and the changes the thread renders', async () => {
    setup({
      turn: async (t) => {
        await t.think('Let me look.')
        await t.update({ sessionUpdate: 'tool_call', toolCallId: 'r1', title: 'Read src/a.ts', kind: 'read', status: 'in_progress' })
        await t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'r1', status: 'completed' })
        await t.update({ sessionUpdate: 'plan', entries: [{ content: 'Fix it', priority: 'high', status: 'in_progress' }] })
        await t.update({
          sessionUpdate: 'tool_call',
          toolCallId: 'e1',
          title: 'Edit src/a.ts',
          kind: 'edit',
          status: 'pending',
          content: [{ type: 'diff', path: '/wt/src/a.ts', oldText: 'const a = 1\n', newText: 'const a = 2\n' }],
        })
        await t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: 'completed' })
        await t.update({ sessionUpdate: 'usage_update', used: 12000, size: 200000, cost: { amount: 0.5, currency: 'USD' } })
        await t.say('All ')
        await t.say('done.')
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Fix a' }, { source: 'human' })
    const view = foldThread(await logUntil(id, turnsEnded(1)))
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'work', 'agent', 'changes'])
    const work = view.items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps.map((s) => s.kind)).toEqual(['thought', 'tools'])
    expect(work.steps[1]).toMatchObject({ calls: [{ id: 'r1', status: 'completed' }, { id: 'e1', kind: 'edit', status: 'completed' }] })
    expect(view.items[2]).toMatchObject({ kind: 'agent', text: 'All done.', model: 'Opus 5.5' })
    expect(view.items[3]).toMatchObject({ kind: 'changes', files: [{ path: 'src/a.ts', added: 1, removed: 1 }] })
    expect(view.context).toEqual({ used: 12000, size: 200000, costUsd: 0.5 })
    expect(view.state).toBe('idle')
    expect(view.process).toBe('running')
  })

  it("shows a long Codex turn's live work: its reasoning, and its command's output as codex-acp streams it in _meta", async () => {
    setup({
      turn: async (t) => {
        await t.update({ sessionUpdate: 'agent_thought_chunk', messageId: 'rs_1', content: { type: 'text', text: '**Running the suite**' } })
        await t.update({ sessionUpdate: 'agent_thought_chunk', messageId: 'rs_1', content: { type: 'text', text: '\n\nIt takes a while.' } })
        await t.update({
          sessionUpdate: 'tool_call',
          toolCallId: 'call_1',
          title: 'bun run test',
          kind: 'execute',
          status: 'in_progress',
          content: [{ type: 'terminal', terminalId: 'call_1' }],
          _meta: { terminal_info: { cwd: '/wt', terminal_id: 'call_1' } },
        })
        await t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_1', _meta: { terminal_output_delta: { data: ' ✓ a.test.ts\n', terminal_id: 'call_1' } } })
        await t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_1', _meta: { terminal_output_delta: { data: ' ✓ b.test.ts\n', terminal_id: 'call_1' } } })
        await t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_1', _meta: { terminal_exit: { exit_code: 0, signal: null, terminal_id: 'call_1' } } })
        await t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'completed' })
        await t.say('Green.')
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Run the tests' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(events.filter((e) => e.type === 'tool').map((e) => (e.type === 'tool' ? e.outputAppend ?? '' : '')).join('')).toBe(' ✓ a.test.ts\n ✓ b.test.ts\n')
    const work = foldThread(events).items[1] as Extract<ThreadItem, { kind: 'work' }>
    expect(work.steps).toMatchObject([
      { kind: 'thought', text: '**Running the suite**\n\nIt takes a while.' },
      { kind: 'tools', calls: [{ id: 'call_1', title: 'bun run test', status: 'completed', output: ' ✓ a.test.ts\n ✓ b.test.ts\n' }] },
    ])
  })

  it('steers a human prompt into the running turn', async () => {
    setup({
      turn: async (t) => {
        const steer = await t.nextSteer()
        await t.say(`Heard: ${steer[0].type === 'text' ? steer[0].text : ''}`)
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Start' }, { source: 'human' })
    await logUntil(id, has('turn_started'))
    await host.prompt(id, { text: 'also this' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(events.find((e) => e.type === 'prompt' && e.text === 'also this')).toMatchObject({ steered: true })
    expect(methods().filter((m) => m === 'session/prompt')).toHaveLength(1)
    expect(foldThread(events).items.at(-1)).toMatchObject({ kind: 'agent', text: 'Heard: also this' })
  })

  it('queues a human prompt as the next turn when the agent does not steer', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    setup({ steering: false, turn: async (t) => void (t.prompt[0].type === 'text' && t.prompt[0].text === 'Start' ? await gate : undefined) })
    const id = thread()
    await host.prompt(id, { text: 'Start' }, { source: 'human' })
    await logUntil(id, has('turn_started'))
    await host.prompt(id, { text: 'next' }, { source: 'human' })
    expect(methods()).not.toContain('_session/steering')
    release()
    await logUntil(id, turnsEnded(2))
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Start', 'next'])
  })

  it('holds a runcastle prompt until the running turn ends, and never steers it', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    setup({ turn: async (t) => void (t.prompt[0].type === 'text' && t.prompt[0].text === 'Start' ? await gate : undefined) })
    const id = thread()
    await host.prompt(id, { text: 'Start' }, { source: 'human' })
    await logUntil(id, has('turn_started'))
    const { promptId } = await host.prompt(id, { text: 'Round ended' }, { source: 'runcastle' })
    // Not in the log mid-turn: it is runcastle's next message, not a line inside this turn.
    expect(readThreadEvents(id).some((e) => e.type === 'prompt' && e.id === promptId)).toBe(false)
    release()
    const events = await logUntil(id, turnsEnded(2))
    const firstEnd = events.findIndex((e) => e.type === 'turn_ended')
    const queued = events.findIndex((e) => e.type === 'prompt' && e.id === promptId)
    expect(queued).toBeGreaterThan(firstEnd)
    expect(events[queued]).toMatchObject({ source: 'runcastle' })
    expect(methods()).not.toContain('_session/steering')
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Start', 'Round ended'])
  })

  it('a held prompt alone is logged and starts nothing', async () => {
    setup()
    const id = thread()
    const { promptId } = await host.prompt(id, { text: 'Opening' }, { source: 'runcastle', hold: true })
    expect(readThreadEvents(id)).toMatchObject([{ type: 'prompt', id: promptId, text: 'Opening', source: 'runcastle' }])
    expect(fake.processes).toHaveLength(0)
    expect(host.isRunning(id)).toBe(false)
  })

  it('sends a held prompt and the next one as one prompt in one turn; the thread shows both, then one answer', async () => {
    setup()
    const id = thread()
    await host.prompt(id, { text: 'Opening' }, { source: 'runcastle', hold: true })
    await host.prompt(id, { text: 'Hello', images: [{ name: 'a.png', mimeType: 'image/png', data: 'AAAA' }] }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(prompts()).toHaveLength(1)
    expect(prompts()[0].prompt).toEqual([
      { type: 'text', text: 'Opening\n\nHello' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ])
    expect(events.filter((e) => e.type === 'turn_started')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'prompt')).toMatchObject([
      { text: 'Opening', source: 'runcastle' },
      { text: 'Hello', source: 'human' },
    ])
    const view = foldThread(events)
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'user', 'agent'])
    expect(view.items[0]).toMatchObject({ text: 'Opening', from: 'runcastle' })
    expect(view.items[1]).toMatchObject({ text: 'Hello' })
    expect(view.items[1]).not.toHaveProperty('from')
    expect(view.items.some((i) => i.kind === 'user' && i.starting)).toBe(false)
  })

  it("a held prompt still gets a resumed chat's opening header after the words", async () => {
    fake = createFakeAcp()
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, idleMs: IDLE_MS, lifecycle: { opening: () => 'STATE' } })
    const id = thread()
    await host.prompt(id, { text: 'Opening' }, { source: 'runcastle', hold: true })
    await host.prompt(id, { text: 'Hello' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Opening\n\nHello\n\nSTATE'])
  })

  it('cancels the running turn', async () => {
    setup({
      turn: async (t) => {
        await t.cancelled
        return 'cancelled'
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Go' }, { source: 'human' })
    await logUntil(id, has('turn_started'))
    await host.cancel(id)
    const events = await logUntil(id, turnsEnded(1))
    expect(events.at(-1)).toMatchObject({ type: 'turn_ended', reason: 'cancelled' })
    expect(methods()).toContain('session/cancel')
    expect(foldThread(events).items.at(-1)).toMatchObject({ kind: 'stopped' })
  })

  it('logs a crashed agent as a stopped process with the error its stderr gave, and starts afresh on the next prompt', async () => {
    setup({ turn: (t) => t.cancelled.then(() => undefined) })
    const id = thread()
    await host.prompt(id, { text: 'Go' }, { source: 'human' })
    await logUntil(id, has('turn_started'))
    fake.last().crash('[session/query] sessionId=s1 resume=s1 apiType=native\nError: the model stream died\n    at stream (cli.js:1:2)')
    const events = await logUntil(id, (e) => e.some((x) => x.type === 'process' && x.state === 'stopped'))
    expect(events.at(-1)).toMatchObject({
      type: 'process',
      state: 'stopped',
      error: 'The agent stopped unexpectedly: Error: the model stream died. Your next message restarts it.',
    })
    const view = foldThread(events)
    expect(view.state).toBe('idle')
    expect(view.items.some((i) => i.kind === 'error')).toBe(true)
    expect(getSessionRow(ctx, id)!.status).toBe('ended')
    expect(host.isRunning(id)).toBe(false)

    fake.script.turn = undefined
    await host.prompt(id, { text: 'Again' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))
    expect(fake.processes).toHaveLength(2)
    expect(fake.last().received[1].method).toBe('session/load')
  })

  it('shows a crash whose stderr is only the adapter’s debug log as one short line, and keeps the log in the session dir', async () => {
    setup({ turn: (t) => t.cancelled.then(() => undefined) })
    const id = thread()
    await host.prompt(id, { text: 'Go' }, { source: 'human' })
    await logUntil(id, has('turn_started'))
    const debug = [
      '[session/create] sessionId=18edac9e phase=validate-cwd durationMs=0 totalMs=0',
      '[session/models] sessionId=18edac9e phase=read-transcript durationMs=1 totalMs=1 messages=12 model=claude-opus-5-5',
      '[authStatus] session account carries no identity signal; keeping probe',
      '[session/create] sessionId=18edac9e phase=prepare-query durationMs=9 totalMs=11',
    ].join('\n')
    fake.last().crash(debug)
    const events = await logUntil(id, (e) => e.some((x) => x.type === 'process' && x.state === 'stopped'))
    expect(events.at(-1)).toMatchObject({ type: 'process', state: 'stopped', error: 'The agent stopped unexpectedly. Your next message restarts it.' })
    expect(JSON.stringify(events)).not.toContain('phase=')
    expect(readFileSync(join(sessionDir(id), 'agent-stderr.log'), 'utf8')).toContain('phase=prepare-query durationMs=9')
  })
})

describe('idle stop', () => {
  it('stops a process idle for the configured time, quietly', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    const id = thread()
    await host.prompt(id, { text: 'Hi' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))
    vi.advanceTimersByTime(IDLE_MS - 1000)
    expect(host.isRunning(id)).toBe(true)
    vi.advanceTimersByTime(2000)
    const events = await logUntil(id, (e) => e.at(-1)?.type === 'process')
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: 'process', state: 'stopped' }))
    expect(events.at(-1)).not.toHaveProperty('error')
    expect(fake.last().killed).toBe(true)
    expect(getSessionRow(ctx, id)!.status).toBe('ended')
  })

  it('never stops a process while an ask is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ turn: async (t) => void (await t.permission({ toolCallId: 'b1', title: 'bun add zod', kind: 'execute' })) })
    const id = thread()
    await host.prompt(id, { text: 'Add zod' }, { source: 'human' })
    await logUntil(id, has('ask'))
    vi.advanceTimersByTime(IDLE_MS * 3)
    expect(host.isRunning(id)).toBe(true)
    expect(fake.last().killed).toBe(false)
  })
})

describe('asks', () => {
  async function approval(choice: 'allow' | 'always' | 'deny') {
    let outcome: unknown
    setup({
      turn: async (t) => {
        if (t.prompt[0].type === 'text' && t.prompt[0].text !== 'Add zod') return
        outcome = (await t.permission({ toolCallId: 'b1', title: 'bun add zod', kind: 'execute' })).outcome
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Add zod' }, { source: 'human' })
    const events = await logUntil(id, has('ask'))
    const view = foldThread(events)
    expect(view.state).toBe('waiting')
    expect(view.ask).toMatchObject({ kind: 'approval', call: { id: 'b1', title: 'bun add zod', kind: 'execute' } })
    expect(getSessionRow(ctx, id)!.awaitingInput).toBe(true)
    await host.answer(id, view.ask!.id, { kind: 'approval', choice })
    const after = await logUntil(id, turnsEnded(1))
    return { id, outcome, events: after }
  }

  it('answers an approval with allow', async () => {
    const { outcome, events } = await approval('allow')
    expect(outcome).toEqual({ outcome: 'selected', optionId: 'allow' })
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what: 'Allowed', answer: 'bun add zod' }] })
  })

  it('answers an approval with always', async () => {
    const { outcome, events } = await approval('always')
    expect(outcome).toEqual({ outcome: 'selected', optionId: 'always' })
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what: 'Always allowed' }] })
  })

  it('answers an approval with deny', async () => {
    const { outcome, events } = await approval('deny')
    expect(outcome).toEqual({ outcome: 'selected', optionId: 'reject' })
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what: 'Denied', answer: 'bun add zod', denied: true }] })
  })

  it('denies with a reason in one turn: the reason reaches the agent within it, and shows with the denial, not as a bubble', async () => {
    let outcome: unknown
    setup({
      turn: async (t) => {
        outcome = (await t.permission({ toolCallId: 'b1', title: 'bun add zod', kind: 'execute' })).outcome
        const steer = await t.nextSteer()
        await t.say(`Using ${steer[0].type === 'text' ? steer[0].text.replace('use ', '') : ''} instead.`)
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Add zod' }, { source: 'human' })
    const asked = foldThread(await logUntil(id, has('ask')))
    await host.answer(id, asked.ask!.id, { kind: 'approval', choice: 'deny', instead: 'use valibot' })
    const events = await logUntil(id, turnsEnded(1))
    expect(outcome).toEqual({ outcome: 'selected', optionId: 'reject' })
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Add zod'])
    const view = foldThread(events)
    expect(view.items.filter((i) => i.kind === 'agent')).toEqual([expect.objectContaining({ text: 'Using valibot instead.' })])
    expect(view.items.some((i) => i.kind === 'user' && i.text === 'use valibot')).toBe(false)
    expect(view.items.find((i) => i.kind === 'answered')).toMatchObject({ what: 'Denied —', answer: 'use valibot', denied: true })
  })

  it('denies with a reason to an agent that does not steer: the reason is its next prompt, still shown only with the denial', async () => {
    setup({
      steering: false,
      turn: async (t) => {
        if (t.prompt[0].type === 'text' && t.prompt[0].text === 'Add zod') await t.permission({ toolCallId: 'b1', title: 'bun add zod', kind: 'execute' })
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Add zod' }, { source: 'human' })
    const asked = foldThread(await logUntil(id, has('ask')))
    await host.answer(id, asked.ask!.id, { kind: 'approval', choice: 'deny', instead: 'use valibot' })
    const events = await logUntil(id, turnsEnded(2))
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Add zod', 'use valibot'])
    expect(foldThread(events).items.some((i) => i.kind === 'user' && i.text === 'use valibot')).toBe(false)
  })

  it('refuses an answer to an ask that is not open', async () => {
    setup({ turn: async (t) => void (await t.permission({ toolCallId: 'b1', title: 'x' })) })
    const id = thread()
    await host.prompt(id, { text: 'Go' }, { source: 'human' })
    await logUntil(id, has('ask'))
    await expect(host.answer(id, 'ask_nope', { kind: 'approval', choice: 'allow' })).rejects.toBeInstanceOf(GateError)
  })

  it('turns AskUserQuestion into a question ask and answers it by question text', async () => {
    let response: unknown
    setup({
      turn: async (t) => {
        response = await t.ask([
          { header: 'Page size', question: 'Which page size?', options: ['A4', 'Letter'] },
          { header: 'Margins', question: 'How wide?', options: ['Narrow', 'Wide'] },
        ])
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Print' }, { source: 'human' })
    const view = foldThread(await logUntil(id, has('ask')))
    expect(view.ask).toMatchObject({ kind: 'question', questions: [{ header: 'Page size', question: 'Which page size?' }, { header: 'Margins' }] })
    await host.answer(id, view.ask!.id, { kind: 'question', answers: { 'Which page size?': 'A4', 'How wide?': '2cm' } })
    const events = await logUntil(id, turnsEnded(1))
    expect(response).toEqual({ action: 'accept', content: { question_0: 'A4', question_1_custom: '2cm' } })
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({
      lines: [
        { what: 'Page size:', answer: 'A4' },
        { what: 'Margins:', answer: '2cm' },
      ],
    })
  })

  it('declines every ask at once on an unattended thread', async () => {
    const seen: unknown[] = []
    setup({
      turn: async (t) => {
        seen.push((await t.permission({ toolCallId: 'b1', title: 'rm -rf build' })).outcome)
        seen.push((await t.ask([{ header: 'Scope', question: 'Which?', options: ['A', 'B'] }])).action)
      },
    })
    const id = thread({ purpose: 'self-plan' })
    await host.prompt(id, { text: 'Plan yourself' }, { source: 'runcastle' })
    const events = await logUntil(id, turnsEnded(1))
    expect(seen).toEqual([{ outcome: 'selected', optionId: 'reject' }, 'decline'])
    expect(events.some((e) => e.type === 'ask')).toBe(false)
    const declined = events.filter((e) => e.type === 'ask_resolved')
    expect(declined).toHaveLength(2)
    expect(declined[0]).toMatchObject({ lines: [{ what: 'Declined', answer: 'nobody is watching this run', denied: true }] })
  })
})

describe('subagents and background commands', () => {
  const subagentSteps = (events: ThreadEvent[]) => {
    const work = foldThread(events).items.find((i): i is Extract<ThreadItem, { kind: 'work' }> => i.kind === 'work')
    return work?.steps.filter((s) => s.kind === 'subagent')
  }

  it('takes subagents as child sessions', async () => {
    setup()
    const id = thread()
    await host.prompt(id, { text: 'Hello' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))
    expect(fake.last().received[0].params).toMatchObject({ clientCapabilities: { subagents: {} } })
  })

  it("logs a Claude subagent (RFD form) with its session's calls under it, and folds it into one segment", async () => {
    setup({
      turn: async (t) => {
        await t.send({ sessionUpdate: 'subagent_update', sessionId: 'child-1', title: 'Explore', description: 'Find the auth code', capabilities: { cancel: {} }, state: { state: 'running' } })
        await t.send({ sessionUpdate: 'tool_call', toolCallId: 'g1', title: 'grep auth', kind: 'search', status: 'in_progress' }, 'child-1')
        await t.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The subagent talking' } }, 'child-1')
        await t.send({ sessionUpdate: 'config_option_update', configOptions: [] }, 'child-1')
        await t.send({ sessionUpdate: 'tool_call_update', toolCallId: 'g1', status: 'completed' }, 'child-1')
        await t.send({ sessionUpdate: 'subagent_update', sessionId: 'child-1', state: { state: 'idle', stopReason: 'end_turn' } })
        await t.say('It is in auth.ts.')
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Where is auth?' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(events.filter((e) => e.type === 'subagent')).toMatchObject([
      { id: 'child-1', title: 'Find the auth code', status: 'in_progress' },
      { id: 'child-1', status: 'completed' },
    ])
    expect(events.filter((e) => e.type === 'tool')).toMatchObject([{ parentId: 'child-1' }, { parentId: 'child-1' }])
    expect(subagentSteps(events)).toMatchObject([{ id: 'child-1', title: 'Find the auth code', status: 'completed', calls: [{ id: 'g1', title: 'grep auth', status: 'completed' }] }])
    const view = foldThread(events)
    expect(view.items.at(-1)).toMatchObject({ kind: 'agent', text: 'It is in auth.ts.' })
    expect(view.items.some((i) => i.kind === 'agent' && i.text.includes('The subagent talking'))).toBe(false)
    expect(view.model).toMatchObject({ id: 'claude-opus-5-5' })
  })

  it('logs a Codex subagent (the draft form, which the ACP client alone would reject) with its calls under it', async () => {
    setup({
      turn: async (t) => {
        await t.send({ sessionUpdate: 'subagent_spawned', subagentSessionId: 'thr-9', name: 'explorer', task: 'Map the router', capabilities: {} })
        await t.send({ sessionUpdate: 'tool_call', toolCallId: 'x1', title: 'rg router', kind: 'execute', status: 'completed' }, 'thr-9')
        await t.send({ sessionUpdate: 'subagent_state_update', subagentSessionId: 'thr-9', state: 'completed' })
        await t.say('Mapped.')
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Map it' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(subagentSteps(events)).toMatchObject([{ id: 'thr-9', title: 'explorer', status: 'completed', calls: [{ id: 'x1', title: 'rg router' }] }])
  })

  it('does not log a replayed subagent again when a conversation loads', async () => {
    setup({ replay: [{ sessionUpdate: 'subagent_update', sessionId: 'old-child', title: 'Explore', state: { state: 'idle', stopReason: 'end_turn' } }] })
    const id = thread({ ccSessionId: 'cc-old' })
    await host.prompt(id, { text: 'Again' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(events.some((e) => e.type === 'subagent')).toBe(false)
  })

  it("lists Claude's background commands while they run and drops them when they finish", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const changed = (tasks: { task_id: string; task_type: string; description: string; subagent_type?: string }[]) => ({
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks,
      uuid: '00000000-0000-0000-0000-000000000000',
      session_id: 'acp-session-1',
    })
    setup({
      turn: async (t) => {
        await t.sdkMessage(
          changed([
            { task_id: 'b1', task_type: 'local_bash', description: 'bun run dev' },
            { task_id: 'a1', task_type: 'local_agent', subagent_type: 'Explore', description: 'Find the auth code' },
          ]),
        )
        await t.say('Started the dev server.')
        await gate
        await t.sdkMessage(changed([]))
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Run it' }, { source: 'human' })
    const running = await logUntil(id, has('tasks'))
    expect(foldThread(running).tasks).toEqual([{ id: 'b1', title: 'bun run dev', startedAt: expect.any(Number) }])
    release()
    const done = await logUntil(id, turnsEnded(1))
    expect(done.filter((e) => e.type === 'tasks')).toHaveLength(2)
    expect(foldThread(done).tasks).toEqual([])
  })
})

describe("an MCP server's forms and links", () => {
  const FORM = {
    mode: 'form' as const,
    message: 'Where should the issue go?',
    requestedSchema: {
      type: 'object' as const,
      properties: {
        team: { type: 'string' as const, title: 'Team', oneOf: [{ const: 'eng', title: 'Engineering' }, { const: 'ops', title: 'Operations' }] },
        email: { type: 'string' as const, title: 'Reporter', format: 'email', description: 'Who hears back' },
        points: { type: 'integer' as const, title: 'Points', default: 3 },
        urgent: { type: 'boolean' as const },
      },
      required: ['team', 'email'],
    },
  }
  const LINK = { mode: 'url' as const, message: 'Sign in to Linear', url: 'https://linear.app/oauth', elicitationId: 'el-1' }

  /** A thread whose turn sends `request` and keeps what came back. */
  async function eliciting(request: Record<string, unknown>, opts: { purpose?: 'self-plan' } = {}) {
    const got: { response?: unknown } = {}
    setup({
      turn: async (t) => {
        got.response = await t.elicit({ sessionId: t.sessionId, ...request } as Parameters<typeof t.elicit>[0])
      },
    })
    const id = thread(opts)
    await host.prompt(id, { text: 'File it' }, { source: 'human' })
    return { id, got }
  }

  it('docks a form with fields from its schema; submitting sends its values back', async () => {
    const { id, got } = await eliciting(FORM)
    const view = foldThread(await logUntil(id, has('ask')))
    expect(view.state).toBe('waiting')
    expect(view.ask).toEqual({
      kind: 'form',
      id: view.ask!.id,
      message: 'Where should the issue go?',
      fields: [
        { key: 'team', type: 'enum', title: 'Team', required: true, options: [{ value: 'eng', label: 'Engineering' }, { value: 'ops', label: 'Operations' }] },
        { key: 'email', type: 'string', title: 'Reporter', description: 'Who hears back', required: true, format: 'email' },
        { key: 'points', type: 'number', title: 'Points', integer: true, default: 3 },
        { key: 'urgent', type: 'boolean', title: 'urgent' },
      ],
    })
    await host.answer(id, view.ask!.id, { kind: 'form', values: { team: 'eng', email: 'a@b.co', points: 5, urgent: true, stray: 'x' } })
    const events = await logUntil(id, turnsEnded(1))
    expect(got.response).toEqual({ action: 'accept', content: { team: 'eng', email: 'a@b.co', points: 5, urgent: true } })
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({
      lines: [
        { what: 'Team:', answer: 'Engineering' },
        { what: 'Reporter:', answer: 'a@b.co' },
        { what: 'Points:', answer: '5' },
        { what: 'urgent:', answer: 'Yes' },
      ],
    })
  })

  it('declines a form the human declines', async () => {
    const { id, got } = await eliciting(FORM)
    const view = foldThread(await logUntil(id, has('ask')))
    await host.answer(id, view.ask!.id, { kind: 'decline' })
    const events = await logUntil(id, turnsEnded(1))
    expect(got.response).toEqual({ action: 'decline' })
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what: 'Declined', answer: 'Where should the issue go?', denied: true }] })
  })

  it('docks a link to open; Done accepts it and Decline declines it', async () => {
    for (const [answer, action, what] of [
      [{ kind: 'link', done: true }, 'accept', 'Done'],
      [{ kind: 'decline' }, 'decline', 'Declined'],
    ] as const) {
      const { id, got } = await eliciting(LINK)
      const view = foldThread(await logUntil(id, has('ask')))
      expect(view.ask).toEqual({ kind: 'link', id: view.ask!.id, message: 'Sign in to Linear', url: 'https://linear.app/oauth' })
      await host.answer(id, view.ask!.id, answer)
      const events = await logUntil(id, turnsEnded(1))
      expect(got.response).toEqual({ action })
      expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what, answer: 'Sign in to Linear' }] })
      await host.stopAll('shutdown')
    }
  })

  it('takes a link down when the agent says its page was finished', async () => {
    setup({
      turn: async (t) => {
        const pending = t.elicit({ sessionId: t.sessionId, ...LINK })
        await new Promise((r) => setTimeout(r, 20))
        await t.completeElicitation('el-1')
        await pending
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Sign in' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what: 'Done', answer: 'Sign in to Linear' }] })
    expect(foldThread(events).ask).toBeUndefined()
  })

  it('refuses a decline for an approval or a question', async () => {
    setup({ turn: async (t) => void (await t.permission({ toolCallId: 'b1', title: 'x' })) })
    const id = thread()
    await host.prompt(id, { text: 'Go' }, { source: 'human' })
    const view = foldThread(await logUntil(id, has('ask')))
    await expect(host.answer(id, view.ask!.id, { kind: 'decline' })).rejects.toBeInstanceOf(GateError)
  })

  it('declines a form and a link at once on an unattended thread', async () => {
    const seen: unknown[] = []
    setup({
      turn: async (t) => {
        seen.push(await t.elicit({ sessionId: t.sessionId, ...FORM }))
        seen.push(await t.elicit({ sessionId: t.sessionId, ...LINK }))
      },
    })
    const id = thread({ purpose: 'self-plan' })
    await host.prompt(id, { text: 'Plan yourself' }, { source: 'runcastle' })
    const events = await logUntil(id, turnsEnded(1))
    expect(seen).toEqual([{ action: 'decline' }, { action: 'decline' }])
    expect(events.some((e) => e.type === 'ask')).toBe(false)
    expect(events.filter((e) => e.type === 'ask_resolved').map((e) => e.type === 'ask_resolved' && e.lines)).toEqual([
      [{ what: 'Declined', answer: 'nobody is watching this run', denied: true }],
      [{ what: 'Declined', answer: 'nobody is watching this run', denied: true }],
    ])
  })

  it('declines a form whose schema the dock cannot show, with a line saying so', async () => {
    const { id, got } = await eliciting({
      mode: 'form',
      message: 'Pick labels',
      requestedSchema: { type: 'object', properties: { labels: { type: 'array', items: { type: 'string', enum: ['bug', 'ux'] } } } },
    })
    const events = await logUntil(id, turnsEnded(1))
    expect(got.response).toEqual({ action: 'decline' })
    expect(events.some((e) => e.type === 'ask')).toBe(false)
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({
      lines: [{ what: 'Declined', answer: 'Pick labels — runcastle cannot show this form: its field "labels" is not a plain value', denied: true }],
    })
  })
})

describe('a thread always shows what is happening', () => {
  const quietly = { type: 'system', subtype: 'session_state_changed', state: 'idle' }

  it('wraps a turn Claude starts by itself in turn events, and settles it when the session goes idle', async () => {
    let later!: FakeTurn
    setup({
      turn: async (t) => {
        later = t
        await t.say('Started the build in the background.')
      },
    })
    const id = thread()
    await host.prompt(id, { text: 'Build it' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))

    await later.update({ sessionUpdate: 'tool_call', toolCallId: 'bg1', title: 'Read build.log', kind: 'read', status: 'completed' })
    await later.say('The build finished.', 'm-self')
    const working = await logUntil(id, (e) => e.some((x) => x.type === 'agent_text' && x.text === 'The build finished.'))
    expect(working.filter((e) => e.type === 'turn_started').at(-1)).toMatchObject({ source: 'agent' })
    expect(foldThread(working).state).toBe('working')
    expect(getSessionRow(ctx, id)!.awaitingInput).toBe(false)

    await later.sdkMessage(quietly)
    const events = await logUntil(id, turnsEnded(2))
    expect(events.at(-1)).toMatchObject({ type: 'turn_ended', reason: 'end_turn' })
    const view = foldThread(events)
    expect(view.state).toBe('idle')
    expect(view.items.at(-1)).toMatchObject({ kind: 'agent', text: 'The build finished.' })
    expect(getSessionRow(ctx, id)!.awaitingInput).toBe(true)
  })

  it('a runcastle prompt sent during a self-started turn waits for its end', async () => {
    let later!: FakeTurn
    setup({ turn: async (t) => void (later ??= t) })
    const id = thread()
    await host.prompt(id, { text: 'Hi' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))
    await later.say('A background command finished.')
    await logUntil(id, (e) => e.filter((x) => x.type === 'turn_started').length === 2)
    await host.prompt(id, { text: 'Round ended' }, { source: 'runcastle' })
    expect(prompts()).toHaveLength(1)
    await later.sdkMessage(quietly)
    await logUntil(id, turnsEnded(3))
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Hi', 'Round ended'])
  })

  it('ends a self-started turn on a runtime with no end signal once it goes quiet', async () => {
    let later!: FakeTurn
    fake = createFakeAcp({ turn: async (t) => void (later = t) })
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, idleMs: IDLE_MS, selfTurnQuietMs: 50 })
    const id = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt', model: { id: 'gpt-5.5', runtime: 'codex' } }).id
    await host.prompt(id, { text: 'Hi' }, { source: 'human' })
    await logUntil(id, turnsEnded(1))
    await later.say('Your tests passed.')
    const events = await logUntil(id, turnsEnded(2))
    expect(foldThread(events).state).toBe('idle')
  })

  it('starts a new conversation when the one on record cannot be loaded: briefed again with the message, in one prompt, and says so', async () => {
    fake = createFakeAcp({ gone: true })
    host = createAgentHost({
      ctx,
      transport: fake.transport,
      launch: FAKE_LAUNCH,
      idleMs: IDLE_MS,
      lifecycle: { opening: () => 'STATE', briefing: () => 'BRIEFING' },
      conversationOnDisk: () => false,
    })
    const id = thread({ ccSessionId: 'cc-gone' })
    await host.prompt(id, { text: 'Hello again' }, { source: 'human' })
    const events = await logUntil(id, turnsEnded(1))
    expect(methods()).toEqual(['initialize', 'session/load', 'session/new', 'session/set_mode', 'session/prompt'])
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Hello again\n\nBRIEFING'])
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe('acp-session-1')
    const view = foldThread(events)
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'notice', 'agent'])
    expect(view.items[1]).toMatchObject({ text: 'Started a new conversation — the earlier one could not be found' })

    // The next start loads the new conversation.
    await host.stop(id, 'idle')
    fake.script.gone = false
    await host.prompt(id, { text: 'And now?' }, { source: 'human' })
    await logUntil(id, turnsEnded(2))
    expect(fake.last().received[1]).toMatchObject({ method: 'session/load', params: { sessionId: 'acp-session-1' } })
  })

  it('stopping a self-planning run closes its turn as stopped, and the next prompt says planning was stopped by the human', async () => {
    setup({ turn: (t) => (t.prompt[0].type === 'text' && t.prompt[0].text === 'Plan yourself' ? new Promise(() => {}) : t.say('Understood.')) })
    const id = thread({ purpose: 'self-plan' })
    await host.prompt(id, { text: 'Plan yourself' }, { source: 'runcastle' })
    await logUntil(id, has('turn_started'))
    await host.stop(id, 'archived')
    const stopped = readThreadEvents(id)
    expect(stopped.slice(-3)).toMatchObject([
      { type: 'turn_ended', reason: 'cancelled' },
      { type: 'notice' },
      { type: 'process', state: 'stopped' },
    ])
    // Not a silent "Stopped by you": the thread says planning stopped and how it goes on.
    expect(foldThread(stopped).items.slice(-2)).toMatchObject([
      { kind: 'stopped' },
      { kind: 'notice', text: 'Planning stopped. Send a message to pick it up with the lead.' },
    ])

    await host.prompt(id, { text: 'What now?' }, { source: 'human' })
    await logUntil(id, turnsEnded(2))
    const said = prompts().at(-1)!.prompt[0].text!
    expect(said).toMatch(/^\[runcastle\] The human stopped your self-planning run/)
    expect(said).toMatch(/planning was stopped by the human/)
    expect(said.endsWith('\n\nWhat now?')).toBe(true)
  })

  it('puts files changed by shell commands in the turn’s changes, relative to the worktree, beside the edit tools’ diffs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runcastle-turn-files-'))
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
      git('init', '-q')
      git('config', 'user.email', 't@example.com')
      git('config', 'user.name', 'T')
      writeFileSync(join(dir, 'README.md'), '# Probe\n')
      writeFileSync(join(dir, 'untouched.txt'), 'one\n')
      git('add', '.')
      git('commit', '-qm', 'init')
      // Dirty before the turn and left alone by it: not the turn's.
      writeFileSync(join(dir, 'untouched.txt'), 'one\ntwo\n')
      setup({
        turn: async (t) => {
          writeFileSync(join(dir, 'README.md'), '# Probe\nA line from the shell\n')
          mkdirSync(join(dir, 'notes'))
          writeFileSync(join(dir, 'notes', 'probe.txt'), 'probe\n')
          await t.update({ sessionUpdate: 'tool_call', toolCallId: 'x1', title: 'echo >> README.md', kind: 'execute', status: 'completed' })
          await t.update({
            sessionUpdate: 'tool_call',
            toolCallId: 'e1',
            title: 'Edit src/a.ts',
            kind: 'edit',
            status: 'completed',
            content: [{ type: 'diff', path: join(dir, 'src', 'a.ts'), oldText: 'const a = 1\n', newText: 'const a = 2\n' }],
          })
          await t.say('Done.')
        },
      })
      const id = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: dir }).id
      await host.prompt(id, { text: 'Probe' }, { source: 'human' })
      const events = await logUntil(id, turnsEnded(1))
      const end = events.find((e) => e.type === 'turn_ended')
      expect(end?.type === 'turn_ended' && end.files?.map((f) => [f.path, f.added, f.removed])).toEqual([
        ['README.md', 1, 0],
        ['notes/probe.txt', 1, 0],
        ['src/a.ts', 1, 1],
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
