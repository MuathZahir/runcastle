import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { deliverToLead } from '../src/services/lead-delivery'
import { markHumanMessage } from '../src/services/lead-status'
import { getFeatureRow } from '../src/services/repo'
import { setWait } from '../src/services/waits'
import { setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { listThreads } from '../src/threads/read'
import { appendThreadEvent, type AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Needs you is the agent's call (spec "Seams"): a chat needs the human only
 * when its agent says so, and only the human's word in that chat (or the
 * agent's own withdraw) clears it. Driven through the real `/mcp` route the
 * lead calls and the `feature.get` / `feature.list` queries the web reads.
 */

let ctx: AppCtx
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
let app: Hono
let projectId: string
let featureId: string
let leadId: string
/** Threads whose process the stand-in host says runs. */
const running = new Set<string>()
/** What the stand-in host was prompted with. */
let prompted: { threadId: string; text: string; source: string }[]
/** Set to make every prompt fail, as a lead that cannot be reached does. */
let promptFails: Error | null

beforeEach(async () => {
  ctx = await makeTestCtx()
  caller = createCallerFactory(appRouter)(ctx)
  const repo = tmpRepo()
  projectId = seedProject(ctx, repo).id
  featureId = seedFeature(ctx, projectId, { slug: 'coupons' }).id
  leadId = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repo }).id
  markSessionLive(ctx, leadId)
  // A conversation on record: delivery prompts this thread rather than opening a new one.
  appendThreadEvent(leadId, { type: 'prompt', id: 'p0', text: 'hello', source: 'human' })
  running.clear()
  prompted = []
  promptFails = null
  setAgentHostForTests({
    isRunning: (id: string) => running.has(id),
    prompt: async (threadId: string, input: { text: string }, opts: { source: string }) => {
      if (promptFails) throw promptFails
      prompted.push({ threadId, text: input.text, source: opts.source })
      return { promptId: `prompt_${prompted.length}` }
    },
    cancel: async () => {},
    stop: async () => {},
  } as unknown as AgentHost)
  setRuntimeCtx(ctx)
  app = new Hono()
  app.route('/mcp', mcpApp)
})

afterEach(() => {
  setAgentHostForTests(undefined)
  clearRuntimeCtx()
  vi.useRealTimers()
})

/** Call an MCP tool as `sessionId`, as its agent does. */
async function call(sessionId: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'X-Runcastle-Session': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  expect(res.status).toBe(200)
  const envelope = (await res.json()) as { result: { isError?: boolean; content: [{ text: string }] } }
  return { isError: !!envelope.result.isError, text: envelope.result.content[0].text }
}

const need = async () => (await caller.feature.get({ id: featureId })).need
const listed = async () => (await caller.feature.list({ projectId })).find((f) => f.id === featureId)?.need

describe('wait_for_you → feature.get().need', () => {
  it('needs nothing until the agent says so, and nothing of a draft', async () => {
    expect(await need()).toBeNull()
    const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', baseBranch: null })
    const chat = createSessionRow(ctx, { featureId: draft.id, kind: 'chat', worktreePath: '/wt' }).id
    setWait(ctx, chat, 'which model?')
    expect((await caller.feature.get({ id: draft.id })).need).toBeNull()
  })

  it('shows the lead’s line on the feature and the list, opening the lead’s chat', async () => {
    const out = await call(leadId, 'wait_for_you', { why: 'Which coupon codes stack?' })
    expect(out.isError).toBe(false)
    const expected = { why: 'Which coupon codes stack?', threadId: leadId, by: 'agent' }
    expect(await need()).toMatchObject(expected)
    expect(await listed()).toMatchObject(expected)
  })

  it('folds the line to one line and takes no kind', async () => {
    await call(leadId, 'wait_for_you', { why: '  Pick a theme:\n  light or dark?  ' })
    expect((await need())?.why).toBe('Pick a theme: light or dark?')
    expect((await call(leadId, 'wait_for_you', {})).isError).toBe(true)
  })

  it('is cleared by the human writing in that chat', async () => {
    await call(leadId, 'wait_for_you', { why: 'Which coupon codes stack?' })
    const row = (await caller.feature.get({ id: featureId })).sessions.find((s) => s.id === leadId)!
    threadLifecycle(ctx).humanPrompted!(row)
    expect(await need()).toBeNull()
    expect(listAfter(ctx, featureId, 0).find((e) => e.type === 'session.wait_cleared')?.data).toMatchObject({ cause: 'human' })
  })

  it('is not cleared by a worker handback, a runcastle notice or the after-Stop mark', async () => {
    await call(leadId, 'wait_for_you', { why: 'Which coupon codes stack?' })
    const feature = getFeatureRow(ctx, featureId)
    // A worker's handback reaches the lead as a runcastle message.
    await deliverToLead(ctx, feature, { text: 'Worker "api" handed back', source: 'runcastle', display: undefined })
    // (The orchestrator's send_to_feature reaches only a feature on autopilot,
    // and joining autopilot closes the lead's wait: epics-on-autopilot decision 24.)
    markHumanMessage(ctx, featureId)
    expect(prompted.length).toBeGreaterThanOrEqual(1)
    expect(await need()).toMatchObject({ why: 'Which coupon codes stack?', threadId: leadId })
  })

  it('is cleared when the agent withdraws it', async () => {
    await call(leadId, 'wait_for_you', { why: 'Which coupon codes stack?' })
    expect((await call(leadId, 'wait_for_you', { withdraw: true })).isError).toBe(false)
    expect(await need()).toBeNull()
  })

  it('is replaced by a newer wait', async () => {
    await call(leadId, 'wait_for_you', { why: 'First question' })
    await call(leadId, 'wait_for_you', { why: 'Second question' })
    expect((await need())?.why).toBe('Second question')
  })

  it('is cleared by the human’s Stop and by archiving', async () => {
    await call(leadId, 'wait_for_you', { why: 'Which coupon codes stack?' })
    await caller.feature.stop({ featureId })
    expect(await need()).toBeNull()
    await call(leadId, 'wait_for_you', { why: 'Again?' })
    await caller.feature.archive({ featureId })
    expect((await caller.feature.get({ id: featureId })).need).toBeNull()
  })
})

describe('declare_ready → need', () => {
  it('reads Ready to test · <scenario> on the lead’s chat, until the human writes', async () => {
    await call(leadId, 'declare_ready', { scenario: 'Apply a coupon at checkout' })
    expect(await need()).toMatchObject({ why: 'Ready to test · Apply a coupon at checkout', threadId: leadId, by: 'agent' })
    const row = (await caller.feature.get({ id: featureId })).sessions.find((s) => s.id === leadId)!
    threadLifecycle(ctx).humanPrompted!(row)
    expect(await need()).toBeNull()
  })
})

describe('an open ask', () => {
  it('reads a question in a running side thread as its text, opening that thread', async () => {
    const side = createSessionRow(ctx, { featureId, kind: 'side', worktreePath: '/wt' }).id
    running.add(side)
    appendThreadEvent(side, { type: 'prompt', id: 'p1', text: 'push it', source: 'human' })
    appendThreadEvent(side, { type: 'turn_started', source: 'human' })
    appendThreadEvent(side, {
      type: 'ask',
      ask: { kind: 'question', id: 'ask_1', questions: [{ header: 'Remote', question: 'Push to which remote?', options: [{ label: 'origin' }, { label: 'fork' }], multiSelect: false }] },
    })
    expect(await need()).toMatchObject({ why: 'Push to which remote?', threadId: side, by: 'agent' })
    expect(await listed()).toMatchObject({ threadId: side })
  })

  it('reads an approval left open in an old log as no need', async () => {
    const side = createSessionRow(ctx, { featureId, kind: 'side', worktreePath: '/wt' }).id
    running.add(side)
    appendThreadEvent(side, { type: 'prompt', id: 'p1', text: 'push it', source: 'human' })
    appendThreadEvent(side, { type: 'turn_started', source: 'human' })
    appendThreadEvent(side, {
      type: 'ask',
      ask: { kind: 'approval', id: 'ask_1', call: { id: 'c1', kind: 'execute', title: 'git push', status: 'pending' } },
    })
    expect(await need()).toBeNull()
  })
})

describe('a dead run', () => {
  it('sets runcastle’s own line on the lead’s chat when its wake fails', async () => {
    promptFails = new Error('the runtime cannot run')
    await deliverToLead(ctx, getFeatureRow(ctx, featureId), { text: 'Round over', source: 'runcastle' })
    expect(await need()).toMatchObject({ why: 'The agent’s run failed', threadId: leadId, by: 'runcastle' })
  })
})

describe('an orchestrator chat', () => {
  it('needs the human only when its own agent calls wait_for_you, on its thread entry', async () => {
    const epic = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    appendThreadEvent(epic.id, { type: 'prompt', id: 'p1', text: 'plan the batch', source: 'human' })
    appendThreadEvent(epic.id, { type: 'turn_started', source: 'human' })
    appendThreadEvent(epic.id, { type: 'plan_shown', featureId, title: 'Coupons' } as never)
    appendThreadEvent(epic.id, { type: 'agent_text', messageId: 'm1', text: 'Start it now?' })
    appendThreadEvent(epic.id, { type: 'turn_ended', reason: 'end_turn' })
    const entry = () => listThreads(ctx, { projectId }).find((t) => t.id === epic.id)
    // A question mark after a plan card is no longer a need.
    expect(entry()?.need).toBeNull()
    expect(entry()?.state).not.toBe('waiting')
    expect((await call(epic.id, 'wait_for_you', { why: 'Start Coupons now?' })).isError).toBe(false)
    expect(entry()?.need).toMatchObject({ why: 'Start Coupons now?', threadId: epic.id, by: 'agent' })
    // It is the chat's own need: the feature it asked about does not need the human.
    expect(await need()).toBeNull()
  })
})
