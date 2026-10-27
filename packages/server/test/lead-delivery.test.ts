import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature, ThreadEvent } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import hooksApp from '../src/routes/hooks'
import { listAfter } from '../src/services/events'
import { deliverToLead, leadDeliveryState } from '../src/services/lead-delivery'
import { isRuncastlePrompt, tagRuncastlePrompt } from '../src/services/lead-prompt'
import { getFeatureRow } from '../src/services/repo'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * How a message reaches a feature's lead (`the-feature-lead-runs-rounds`
 * decision 12; chat-as-web-components decision 6): a runcastle prompt into the
 * feature's main-chat thread, queued to the end of a running turn and starting
 * the chat when no process runs — and only a human-typed prompt counted as
 * human. A fake ACP agent stands behind the host.
 */

let ctx: AppCtx
let projectId: string
let n = 0
let fake: FakeAcp
let host: AgentHost

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  setRuntimeCtx(ctx)
  fake = createFakeAcp()
  host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  clearRuntimeCtx()
  vi.restoreAllMocks()
})

function feature(overrides: Partial<Feature> = {}): Feature {
  return seedFeature(ctx, projectId, { slug: `lead-${++n}`, ...overrides })
}

/** The feature's main chat, its conversation on record and no process running. */
function chat(featureId: string): string {
  const row = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  markSessionEnded(ctx, row.id)
  return row.id
}

function types(featureId: string): string[] {
  return listAfter(ctx, featureId, 0).map((e) => e.type)
}

async function logUntil(id: string, done: (events: ThreadEvent[]) => boolean): Promise<ThreadEvent[]> {
  await vi.waitFor(() => expect(done(readThreadEvents(id))).toBe(true))
  return readThreadEvents(id)
}

const turnsEnded = (count: number) => (events: ThreadEvent[]) => events.filter((e) => e.type === 'turn_ended').length === count

/** The text of each `session/prompt` the agent received, in order. */
function sentToAgent(): string[] {
  return fake.processes.flatMap((p) =>
    p.received
      .filter((r) => r.method === 'session/prompt')
      .map((r) => ((r.params as { prompt: { type: string; text?: string }[] }).prompt[0]?.text ?? '')),
  )
}

function mount(): Hono {
  const app = new Hono()
  app.route('/api/hooks', hooksApp)
  return app
}

async function hook(app: Hono, event: string, sessionId: string, payload: Record<string, unknown>): Promise<void> {
  await app.request(`/api/hooks/${event}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, sessionId, payload }),
  })
}

describe('the prompt tag', () => {
  it('marks runcastle’s prompts once, and nothing the human typed', () => {
    expect(tagRuncastlePrompt('Go given')).toBe('[runcastle] Go given')
    expect(tagRuncastlePrompt('[runcastle] Round 1')).toBe('[runcastle] Round 1')
    expect(isRuncastlePrompt('  [runcastle] Round 1')).toBe(true)
    expect(isRuncastlePrompt('looks good, go on')).toBe(false)
  })

  it('still knows its own line in a terminal-era transcript, as Stop-hook feedback', () => {
    const rewake =
      '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\n' +
      'Stop hook blocking error from command "Stop": [runcastle] The human pressed Stop. Dispatch nothing until the human replies.\n' +
      '[runcastle] Round 2 returned\n</system-reminder>'
    expect(isRuncastlePrompt(rewake)).toBe(true)
    expect(isRuncastlePrompt('what does [runcastle] mean in the log?')).toBe(false)
    expect(isRuncastlePrompt('<task-notification>\n<summary>Background task done</summary>\n</task-notification>')).toBe(false)
  })
})

describe('deliverToLead', () => {
  it('starts an idle lead with the message as runcastle’s prompt, and says so', async () => {
    const f = feature()
    const id = chat(f.id)

    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })

    expect(promptsOf(id)).toEqual([expect.objectContaining({ text: '[runcastle] Round 1 returned', source: 'runcastle' })])
    expect(host.isRunning(id)).toBe(true)
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect(queued?.data).toMatchObject({ sessionId: id, route: 'prompt', source: 'runcastle', text: 'Round 1 returned' })
    await logUntil(id, turnsEnded(1))
  })

  it('hands a resumed lead the feature’s current state with the first prompt after its process starts, and only then', async () => {
    const f = feature()
    const id = chat(f.id)

    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })
    await logUntil(id, turnsEnded(1))
    await deliverToLead(ctx, f, { text: 'Round 2 returned', source: 'runcastle' })
    await logUntil(id, turnsEnded(2))

    const [first, second] = sentToAgent()
    expect(first.startsWith('[runcastle] Round 1 returned\n\n')).toBe(true)
    expect(first).toContain('Feature status: Talking with you;')
    expect(second).toBe('[runcastle] Round 2 returned')
    // The log shows what was said, not the header the agent was handed with it.
    expect(promptsOf(id)[0].text).toBe('[runcastle] Round 1 returned')
  })

  it('queues a message that arrives mid-turn to the turn’s end', async () => {
    let release!: () => void
    const released = new Promise<void>((r) => {
      release = r
    })
    fake.script.turn = async (t) => {
      if (t.prompt[0].type === 'text' && t.prompt[0].text.startsWith('[runcastle] first')) await released
    }
    const f = feature()
    const id = chat(f.id)

    await deliverToLead(ctx, f, { text: 'first', source: 'runcastle' })
    await logUntil(id, (e) => e.some((x) => x.type === 'turn_started'))
    await deliverToLead(ctx, f, { text: 'second', source: 'runcastle' })

    // Nothing of the second is said while the first turn runs.
    expect(promptsOf(id).map((p) => p.text)).toEqual(['[runcastle] first'])
    release()
    await logUntil(id, turnsEnded(2))
    expect(promptsOf(id).map((p) => p.text)).toEqual(['[runcastle] first', '[runcastle] second'])
  })

  it('stamps the human’s mark for a human message, still said as runcastle’s prompt', async () => {
    const f = feature()
    const id = chat(f.id)

    await deliverToLead(ctx, f, { text: 'notes', source: 'human' })

    expect(getFeatureRow(ctx, f.id).lastHumanMessageAt).toBeGreaterThan(0)
    expect(promptsOf(id)[0]).toMatchObject({ text: '[runcastle] notes', source: 'runcastle' })
    await logUntil(id, turnsEnded(1))
  })

  it('keeps a message it could not deliver, says why, and sends it first with the next one', async () => {
    // A feature with no chat thread and no checkout to open one in: the launch is refused.
    const f = feature()

    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })

    expect(types(f.id)).toContain('lead.wake_failed')
    expect(types(f.id)).not.toContain('lead.message_queued')
    const state = leadDeliveryState(f.id)
    expect(state.waitingSince).toBeGreaterThan(0)
    expect(state.lastFailure?.reason).toBeTruthy()

    const id = chat(f.id)
    await deliverToLead(ctx, f, { text: 'Round 2 returned', source: 'runcastle' })

    expect(promptsOf(id)[0].text).toBe('[runcastle] Round 1 returned\n\n[runcastle] Round 2 returned')
    expect(leadDeliveryState(f.id)).toEqual({ waitingSince: null, lastFailure: null })
    await logUntil(id, turnsEnded(1))
  })
})

describe('a lead’s turn (UserPromptSubmit)', () => {
  it('marks a typed prompt as the human’s, and runcastle’s or an unreadable one not', async () => {
    const app = mount()
    const f = feature()
    const id = chat(f.id)
    const marks = (): number => types(f.id).filter((t) => t === 'lead.human_message').length

    await hook(app, 'user-prompt', id, { prompt: '[runcastle] Round 1 returned' })
    await hook(app, 'user-prompt', id, {})
    await hook(app, 'user-prompt', id, {
      prompt:
        '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\n' +
        'Stop hook blocking error from command "Stop": [runcastle] The human pressed Stop.\n</system-reminder>',
    })
    expect(marks()).toBe(0)

    // What the composer sends, the opening appended after the human's words.
    await hook(app, 'user-prompt', id, { prompt: 'drop ticket 4 and go\n\nFeature status: Working' })
    expect(marks()).toBe(1)
    expect(getFeatureRow(ctx, f.id).lastHumanMessageAt).toBeGreaterThan(0)
  })

  it('does not mark a prompt in a side thread', async () => {
    const f = feature()
    const side = createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' }).id
    await hook(mount(), 'user-prompt', side, { prompt: 'anything' })
    expect(types(f.id)).not.toContain('lead.human_message')
  })
})
