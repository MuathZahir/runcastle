import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { foldThread, type ThreadEvent, type ThreadItem } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { createAgentHost } from '../src/threads/host'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp, type FakeScript } from './support/fake-acp-agent'

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

function setup(script: FakeScript = {}): void {
  fake = createFakeAcp(script)
  host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, idleMs: IDLE_MS })
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
    expect(view.items[3]).toMatchObject({ kind: 'changes', files: [{ path: '/wt/src/a.ts', added: 1, removed: 1 }] })
    expect(view.context).toEqual({ used: 12000, size: 200000, costUsd: 0.5 })
    expect(view.state).toBe('idle')
    expect(view.process).toBe('running')
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

  it('logs a crashed agent as a stopped process with the tail of its stderr, and starts afresh on the next prompt', async () => {
    setup({ turn: (t) => t.cancelled.then(() => undefined) })
    const id = thread()
    await host.prompt(id, { text: 'Go' }, { source: 'human' })
    await logUntil(id, has('turn_started'))
    fake.last().crash('warming up\nError: the model stream died')
    const events = await logUntil(id, (e) => e.some((x) => x.type === 'process' && x.state === 'stopped'))
    expect(events.at(-1)).toMatchObject({ type: 'process', state: 'stopped', error: expect.stringContaining('the model stream died') })
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
  async function approval(choice: 'allow' | 'always' | 'deny', instead?: string) {
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
    await host.answer(id, view.ask!.id, { kind: 'approval', choice, ...(instead ? { instead } : {}) })
    const after = await logUntil(id, turnsEnded(instead ? 2 : 1))
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

  it('answers an approval with deny, and sends what to do instead as the next prompt', async () => {
    const { outcome, events } = await approval('deny', 'use valibot')
    expect(outcome).toEqual({ outcome: 'selected', optionId: 'reject' })
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what: 'Denied', answer: 'bun add zod', denied: true }] })
    expect(prompts().map((p) => p.prompt[0].text)).toEqual(['Add zod', 'use valibot'])
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
