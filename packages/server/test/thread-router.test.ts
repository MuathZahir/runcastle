import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { foldThread, type ThreadEvent, type ThreadEventBody } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive, setThreadPurpose } from '../src/launcher/sessions'
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
      { type: 'prompt', id: 'p', text: 'add dark mode', source: 'human' },
      { type: 'title', title: 'Dark mode for the app' },
    ])
    const renamed = thread([{ type: 'prompt', id: 'p', text: 'whatever', source: 'human' }])
    await caller.thread.rename({ threadId: renamed, title: 'Journal audit' })
    // Runcastle's words reached the conversation later, or rode unseen with a prompt: no generated title names it.
    const wokenLater = thread([
      { type: 'prompt', id: 'p', text: 'Audit the journal', source: 'human' },
      { type: 'prompt', id: 'w', text: '[runcastle] The round ended.', source: 'runcastle' },
      { type: 'title', title: 'Runcastle round summary' },
    ])
    const briefedUnseen = thread([
      { type: 'prompt', id: 'p', text: 'Pick up the release', source: 'human' },
      { type: 'briefed' },
      { type: 'title', title: 'Runcastle feature session' },
    ])

    const names = Object.fromEntries((await caller.thread.list({ projectId })).map((t) => [t.id, t.title]))
    expect(names).toEqual({
      [empty]: 'New chat',
      [firstMessage]: 'A notes inbox for the project',
      [generated]: 'Dark mode for the app',
      [renamed]: 'Journal audit',
      [wokenLater]: 'Audit the journal',
      [briefedUnseen]: 'Pick up the release',
    })
  })

  it('names a resumed chat by the human’s message when its opening rode with it, never by the title made of it', async () => {
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, lifecycle: { opening: () => '[runcastle] Feature status: Talking with you.' } })
    setAgentHostForTests(host)
    fake.script.turn = async (t) => {
      await t.update({ sessionUpdate: 'session_info_update', title: 'Runcastle feature session' })
    }
    const id = chat()
    await caller.thread.send({ threadId: id, text: 'Where were we on the login page?' })
    await logUntil(id, turnEnded)

    const sent = fake.last().received.find((r) => r.method === 'session/prompt')!.params as { prompt: { text: string }[] }
    expect(sent.prompt[0].text).toContain('Feature status: Talking with you.')
    expect((await caller.thread.list({ featureId }))[0]).toMatchObject({ id, title: 'Where were we on the login page?' })
    expect(getSessionRow(ctx, id)?.title ?? null).toBeNull()
  })

  // decision 12 merges the opening into the first prompt: a title the runtime made of it names runcastle's words.
  it('names a merged-opening thread by the human first message, never by the title made of the opening', async () => {
    const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    markSessionLive(ctx, row.id, { ccSessionId: `acp-${row.id}` })
    fake.script.turn = async (t) => {
      await t.update({ sessionUpdate: 'session_info_update', title: 'Runcastle project skill session' })
    }
    await host.prompt(row.id, { text: 'You are the project session…' }, { source: 'runcastle', hold: true })
    await caller.thread.send({ threadId: row.id, text: 'Tidy the release notes' })
    await logUntil(row.id, (e) => e.some((x) => x.type === 'title'))
    await logUntil(row.id, turnEnded)

    expect((await caller.thread.list({ projectId }))[0]).toMatchObject({ id: row.id, title: 'Tidy the release notes' })
    // Never stored on the row, where it would read as the human's rename.
    expect(getSessionRow(ctx, row.id)?.title ?? null).toBeNull()
  })

  it('names a thread no human has spoken in by what it is doing', async () => {
    const thread = (kind: 'chat' | 'scenario' | 'drive-fix', purpose?: 'self-plan'): string => {
      const row = createSessionRow(ctx, { featureId, kind, worktreePath: '/wt', ...(purpose ? { purpose } : {}) })
      appendThreadEvent(row.id, { type: 'prompt', id: 'k', text: 'Proceed with your task…', source: 'runcastle' })
      appendThreadEvent(row.id, { type: 'title', title: 'Runcastle feature session' })
      return row.id
    }
    const selfPlan = thread('chat', 'self-plan')
    const scenario = thread('scenario')
    const fix = thread('drive-fix')
    const started = thread('chat')

    const names = async () => Object.fromEntries((await caller.thread.list({ featureId })).map((t) => [t.id, t.title]))
    expect(await names()).toEqual({
      [selfPlan]: 'Planning by itself',
      [scenario]: 'Scenario: writing scenarios',
      [fix]: 'Fix: the test drive',
      // A feature's main chat only runcastle has spoken in is named after the feature.
      [started]: 'Demo feature',
    })

    // The planning run is over (finished or stopped): the purpose goes, and with it "Planning by itself".
    setThreadPurpose(ctx, selfPlan, null)
    expect((await names())[selfPlan]).toBe('Demo feature')
    // Once the human writes, the first message names it.
    appendThreadEvent(selfPlan, { type: 'prompt', id: 'p', text: 'Split the plan in two', source: 'human' })
    expect((await names())[selfPlan]).toBe('Split the plan in two')
  })

  it('names a feature main chat nothing has been said in yet after the feature', async () => {
    const id = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt' }).id
    expect(await caller.thread.list({ featureId })).toEqual([expect.objectContaining({ id, title: 'Demo feature' })])
  })

  it("shows the human's rename at once, over a thread runcastle opened and the runtime titled", async () => {
    const id = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt' }).id
    appendThreadEvent(id, { type: 'prompt', id: 'k', text: 'Proceed with your task…', source: 'runcastle' })
    appendThreadEvent(id, { type: 'prompt', id: 'p', text: 'Fix the login page', source: 'human' })
    appendThreadEvent(id, { type: 'title', title: 'Runcastle feature session' })
    await caller.thread.rename({ threadId: id, title: 'Login rework' })
    // A title the runtime generates later does not take the name back.
    appendThreadEvent(id, { type: 'title', title: 'Login page fixes' })

    expect((await caller.thread.list({ featureId }))[0]).toMatchObject({ id, title: 'Login rework' })
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

  it('continues a terminal-era conversation with its history in order, live and after a reload, keeping its name', async () => {
    const [, newer] = terminalEra('cc-continued', [
      ['Make the header blue', 'Done, it is blue.'],
      ['And bold', 'Bold too.'],
    ])
    fake.script.turn = async (t) => {
      await t.update({ sessionUpdate: 'session_info_update', title: 'Runcastle feature session' })
      await t.say('Italic as well.')
    }
    // What a client opened on the thread holds before it is continued.
    const held = (await caller.thread.events({ threadId: newer })).events

    await caller.thread.send({ threadId: newer, text: 'Now italic' })
    await logUntil(newer, (e) => e.filter((x) => x.type === 'turn_ended').length === 3)

    const said = (events: ThreadEvent[]) =>
      foldThread(events).items.map((i) => (i.kind === 'user' || i.kind === 'agent' ? `${i.kind}:${i.text}` : i.kind))
    const history = ['user:Make the header blue', 'agent:Done, it is blue.', 'user:And bold', 'agent:Bold too.', 'user:Now italic', 'agent:Italic as well.']
    // Live: the held turns, then what came after them.
    const live = (await caller.thread.events({ threadId: newer, after: held.at(-1)!.i })).events
    expect(said([...held, ...live]).filter((s) => s.startsWith('user:') || s.startsWith('agent:'))).toEqual(history)
    // After a reload: the whole log, read from the start.
    const reloaded = (await caller.thread.events({ threadId: newer })).events
    expect(reloaded.slice(0, held.length)).toEqual(held)
    expect(reloaded.map((e) => e.i)).toEqual(reloaded.map((_, n) => n))
    expect(said(reloaded).filter((s) => s.startsWith('user:') || s.startsWith('agent:'))).toEqual(history)

    const listed = (await caller.thread.list({ featureId })).find((t) => t.id === newer)
    expect(listed).toMatchObject({ title: 'Make the header blue' })
    expect(listed).not.toHaveProperty('readOnlyTranscript')
    expect(getSessionRow(ctx, newer)?.title ?? null).toBeNull()
  })

  it('reads a terminal-era slash command back as what was typed, and drops the CLI’s own output and caveat', async () => {
    const [, newer] = terminalEra('cc-commands', [
      ['<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>', null],
      ['<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>sonnet</command-args>', null],
      ['<local-command-stdout>Set model to \u001b[1mSonnet\u001b[22m</local-command-stdout>', null],
      ['<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>', null],
      ['Make the header blue', 'Done, it is blue.'],
    ])
    const view = await caller.thread.view({ threadId: newer })
    expect(view.items.map((i) => (i.kind === 'user' || i.kind === 'agent' ? `${i.kind}:${i.text}` : i.kind))).toEqual([
      'user:/model sonnet',
      'user:/clear',
      'user:Make the header blue',
      'agent:Done, it is blue.',
    ])
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
