import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ThreadEvent, ThreadEventBody } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import threadsApp from '../src/routes/threads'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { appendThreadEvent, readThreadEvents, type AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'

/**
 * The thread router (chat-as-web-components ticket 1) through the caller, with
 * a fake ACP agent behind the host: list, view, events, send, stop, answer, a
 * terminal-era conversation read back from its transcript, and a sent image
 * served back over HTTP.
 */

let ctx: AppCtx
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
let projectId: string
let featureId: string
let fake: FakeAcp
let host: AgentHost

beforeEach(async () => {
  ctx = await makeTestCtx()
  caller = createCallerFactory(appRouter)(ctx)
  projectId = seedProject(ctx).id
  featureId = seedFeature(ctx, projectId).id
  fake = createFakeAcp()
  host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH })
  setAgentHostForTests(host)
})

const tempDirs: string[] = []

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function logUntil(id: string, done: (events: ThreadEvent[]) => boolean): Promise<ThreadEvent[]> {
  const deadline = Date.now() + 3000
  for (;;) {
    const events = readThreadEvents(id)
    if (done(events)) return events
    if (Date.now() > deadline) throw new Error(`log never got there: ${events.map((e) => e.type).join(', ')}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}
const turnEnded = (events: ThreadEvent[]) => events.some((e) => e.type === 'turn_ended')

/** A thread whose conversation is under way, so a send is just the human's message. */
function chat(kind: 'chat' | 'side' | 'scenario' | 'drive-fix' = 'chat'): string {
  const id = createSessionRow(ctx, { featureId, kind, worktreePath: '/wt' }).id
  markSessionLive(ctx, id, { ccSessionId: `acp-${id}` })
  return id
}

/**
 * A conversation from before threads had logs: a row per relaunch, one Claude
 * transcript. An answer of `null` is a prompt that got none. With
 * `newestUnrecorded` the newest relaunch never recorded the transcript's path.
 */
function terminalEra(
  ccSessionId: string,
  turns: [string, string | null][],
  opts: { kind?: 'chat' | 'side' | 'project' | 'prepare'; newestUnrecorded?: boolean } = {},
): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-transcript-'))
  tempDirs.push(dir)
  const path = join(dir, `${ccSessionId}.jsonl`)
  writeFileSync(
    path,
    turns
      .flatMap(([said, answered]) => [
        JSON.stringify({ type: 'user', message: { role: 'user', content: said } }),
        ...(answered === null ? [] : [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answered }] } })]),
      ])
      .join('\n'),
  )
  const kind = opts.kind ?? 'chat'
  const scope = kind === 'project' || kind === 'prepare' ? { projectId } : { featureId }
  return [0, 1].map((n) => {
    const row = createSessionRow(ctx, { ...scope, kind, worktreePath: '/wt' })
    markSessionLive(ctx, row.id, { ccSessionId, ...(n === 1 && opts.newestUnrecorded ? {} : { transcriptPath: path }) })
    markSessionEnded(ctx, row.id)
    return row.id
  })
}

describe('thread router', () => {
  it('sends, and reads the thread back as events and as a view', async () => {
    const id = chat()
    const { promptId } = await caller.thread.send({ threadId: id, text: 'Hello there' })
    await logUntil(id, turnEnded)
    const { events } = await caller.thread.events({ threadId: id })
    expect(events[0]).toMatchObject({ type: 'prompt', id: promptId, text: 'Hello there', source: 'human' })
    const after = await caller.thread.events({ threadId: id, after: events[2].i })
    expect(after.events.map((e) => e.i)).toEqual(events.slice(3).map((e) => e.i))
    const view = await caller.thread.view({ threadId: id })
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'agent'])
    expect(view.state).toBe('idle')
    expect(view.model).toMatchObject({ label: 'Opus 5.5' })
  })

  it('stops a running turn and answers an open ask', async () => {
    fake.script.turn = async (t) => {
      if (t.prompt[0].type === 'text' && t.prompt[0].text === 'ask') {
        await t.permission({ toolCallId: 'b1', title: 'bun test' })
        return
      }
      await t.cancelled
      return 'cancelled'
    }
    const id = chat()
    await caller.thread.send({ threadId: id, text: 'long' })
    await logUntil(id, (e) => e.some((x) => x.type === 'turn_started'))
    expect(await caller.thread.stop({ threadId: id })).toEqual({ ok: true })
    await logUntil(id, turnEnded)

    await caller.thread.send({ threadId: id, text: 'ask' })
    await logUntil(id, (e) => e.some((x) => x.type === 'ask'))
    const { ask } = await caller.thread.view({ threadId: id })
    expect(await caller.thread.answer({ threadId: id, askId: ask!.id, answer: { kind: 'approval', choice: 'allow' } })).toEqual({ ok: true })
    const events = await logUntil(id, (e) => e.filter((x) => x.type === 'turn_ended').length === 2)
    expect(events.find((e) => e.type === 'ask_resolved')).toMatchObject({ lines: [{ what: 'Allowed', answer: 'bun test' }] })
    await expect(caller.thread.answer({ threadId: id, askId: ask!.id, answer: { kind: 'approval', choice: 'allow' } })).rejects.toThrow(/not open/)
  })

  it('refuses an unknown thread', async () => {
    await expect(caller.thread.view({ threadId: 'sess_nope' })).rejects.toThrow(/no thread/)
    await expect(caller.thread.send({ threadId: 'sess_nope', text: 'hi' })).rejects.toThrow(/no thread/)
    await expect(caller.thread.stop({ threadId: 'sess_nope' })).rejects.toThrow(/no thread/)
  })

  it('lists the feature threads newest first, with roles, titles and state', async () => {
    const scenario = chat('scenario')
    const main = chat()
    await caller.thread.send({ threadId: main, text: 'Fix the login page' })
    await logUntil(main, turnEnded)
    const list = await caller.thread.list({ featureId })
    expect(list.map((t) => [t.id, t.role])).toEqual([
      [main, 'main'],
      [scenario, 'scenario'],
    ])
    expect(list[0]).toMatchObject({ title: 'Fix the login page', state: 'idle', runtime: 'claude-code' })
    expect(list[0]).not.toHaveProperty('readOnlyTranscript')
    expect(await caller.thread.list({ projectId })).toEqual([])
  })

  // decision 14: a thread is named by what it is about, never by its kind.
  it('names each thread by its rename, its generated title, its first message, or New chat', async () => {
    const thread = (log: ThreadEventBody[]): string => {
      const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
      for (const body of log) appendThreadEvent(row.id, body)
      return row.id
    }
    const briefing: ThreadEventBody = { type: 'prompt', id: 'k', text: 'You are the project session…', source: 'runcastle' }
    const empty = thread([])
    const firstMessage = thread([
      briefing,
      { type: 'title', title: 'Runcastle project session' },
      { type: 'prompt', id: 'p', text: 'A notes  inbox\nfor the project', source: 'human' },
    ])
    const generated = thread([
      briefing,
      { type: 'prompt', id: 'p', text: 'add dark mode', source: 'human' },
      { type: 'title', title: 'Dark mode for the app' },
    ])
    const renamed = thread([{ type: 'prompt', id: 'p', text: 'whatever', source: 'human' }])
    await caller.thread.rename({ threadId: renamed, title: 'Journal audit' })

    const names = Object.fromEntries((await caller.thread.list({ projectId })).map((t) => [t.id, t.title]))
    expect(names).toEqual({
      [empty]: 'New chat',
      [firstMessage]: 'A notes inbox for the project',
      [generated]: 'Dark mode for the app',
      [renamed]: 'Journal audit',
    })
  })

  it('reads a terminal-era conversation back from its transcript, listed once with readOnlyTranscript', async () => {
    const [older, newer] = terminalEra('cc-conv', [
      ['Make the header blue', 'Done, it is blue.'],
      ['And bold', 'Bold too.'],
    ])
    const list = await caller.thread.list({ featureId })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: newer, title: 'Make the header blue', readOnlyTranscript: true, state: 'idle' })
    expect(list.some((t) => t.id === older)).toBe(false)

    const { events } = await caller.thread.events({ threadId: newer })
    expect(events.map((e) => e.type)).toEqual(['prompt', 'turn_started', 'agent_text', 'turn_ended', 'prompt', 'turn_started', 'agent_text', 'turn_ended'])
    expect(events.map((e) => e.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect((await caller.thread.events({ threadId: newer, after: 3 })).events[0]).toMatchObject({ i: 4, type: 'prompt', text: 'And bold' })
    const view = await caller.thread.view({ threadId: newer })
    expect(view.items.map((i) => (i.kind === 'user' || i.kind === 'agent' ? `${i.kind}:${i.text}` : i.kind))).toEqual([
      'user:Make the header blue',
      'agent:Done, it is blue.',
      'user:And bold',
      'agent:Bold too.',
    ])
  })

  it.each(['project', 'prepare', 'side'] as const)('reads a terminal-era %s conversation back, by its first words, even where its newest row never recorded the transcript', async (kind) => {
    const [, newer] = terminalEra(`cc-${kind}`, [['Set up the env file', 'Done, .env is in place.']], { kind, newestUnrecorded: true })
    const list = await caller.thread.list(kind === 'side' ? { featureId } : { projectId })
    expect(list).toEqual([expect.objectContaining({ id: newer, title: 'Set up the env file', readOnlyTranscript: true })])
    const view = await caller.thread.view({ threadId: newer })
    expect(view.items.map((i) => i.kind)).toEqual(['user', 'agent'])
  })

  it('reads a terminal-era conversation whose last prompt got no answer as idle, not starting', async () => {
    const [, newer] = terminalEra('cc-unanswered', [
      ['Make the header blue', 'Done.'],
      ['And bold', null],
    ])
    const view = await caller.thread.view({ threadId: newer })
    expect(view.state).toBe('idle')
    expect(view.items.at(-1)).toMatchObject({ kind: 'user', text: 'And bold' })
    expect(view.items.some((i) => i.kind === 'user' && i.starting)).toBe(false)
  })

  it('stores a sent image, logs its URL, passes it to the agent, and serves it back', async () => {
    const id = chat()
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
    await caller.thread.send({ threadId: id, text: 'Look', images: [{ name: 'crop.png', mimeType: 'image/png', data: png }] })
    const events = await logUntil(id, turnEnded)
    const prompt = events[0] as Extract<ThreadEvent, { type: 'prompt' }>
    expect(prompt.images).toHaveLength(1)
    expect(prompt.images![0]).toMatchObject({ name: 'crop.png', src: expect.stringMatching(new RegExp(`^/api/threads/${id}/images/img_[\\w-]+\\.png$`)) })
    const sent = fake.last().received.find((r) => r.method === 'session/prompt')!.params as { prompt: unknown[] }
    expect(sent.prompt).toEqual([
      { type: 'text', text: 'Look' },
      { type: 'image', data: png, mimeType: 'image/png' },
    ])

    const app = new Hono()
    app.route('/api/threads', threadsApp)
    const res = await app.request(prompt.images![0].src)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).toString('base64')).toBe(png)
    expect((await app.request(`/api/threads/${id}/images/missing.png`)).status).toBe(404)
    expect((await app.request(`/api/threads/${id}/images/..%2Fthread.jsonl`)).status).toBe(404)
    expect((await app.request(`/api/threads/${id}/images/x.svg`)).status).toBe(404)
  })
})
