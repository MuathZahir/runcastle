import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { ptyRegistry } from '../src/pty/registry'
import hooksApp from '../src/routes/hooks'
import { emit, listAfter } from '../src/services/events'
import { go } from '../src/services/features'
import {
  deliverToLead,
  leadDeliveryFor,
  leadDeliveryState,
  startLeadWaker,
  wakeLeadHeadless,
  type LeadLauncher,
} from '../src/services/lead-delivery'
import { isRuncastlePrompt, tagRuncastlePrompt } from '../src/services/lead-prompt'
import { asyncRewakeDelivery, codexQueueDelivery } from '../src/services/orchestrator-delivery'
import {
  hasOrchestratorLines,
  leadMessageKey,
  queueOrchestratorLine,
  releaseOrchestratorWaiter,
  requeueOrchestratorLines,
  takeOrchestratorLines,
  waitForOrchestratorLines,
} from '../src/services/orchestrator-messages'
import { getFeatureRow } from '../src/services/repo'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * How a message reaches a feature's lead (`the-feature-lead-runs-rounds`
 * decision 12, spec "Waking the lead"): the turn-end waiter on Claude Code,
 * `codex queue` on Codex, a headless resume when no terminal is open — never
 * typed into a terminal — and only a human-typed prompt counted as human.
 */

let ctx: AppCtx
let projectId: string
let n = 0

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  setRuntimeCtx(ctx)
})

afterEach(() => {
  clearRuntimeCtx()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function feature(overrides: Partial<Feature> = {}): Feature {
  return seedFeature(ctx, projectId, { slug: `lead-${++n}`, phase: 'building', ...overrides })
}

/** A chat session on the feature, live unless said otherwise. */
function chat(
  featureId: string,
  opts: { headless?: boolean; runtime?: 'codex'; live?: boolean; ccSessionId?: string } = {},
): string {
  const row = createSessionRow(ctx, {
    featureId,
    kind: 'chat',
    worktreePath: '/wt',
    ...(opts.headless ? { headless: true } : {}),
    ...(opts.runtime ? { model: { id: 'gpt-5.6-sol', runtime: 'codex' } } : {}),
  })
  if (opts.live !== false) markSessionLive(ctx, row.id, { ccSessionId: opts.ccSessionId ?? `cc-${row.id}` })
  return row.id
}

function types(featureId: string): string[] {
  return listAfter(ctx, featureId, 0).map((e) => e.type)
}

function mount(): Hono {
  const app = new Hono()
  app.route('/api/hooks', hooksApp)
  return app
}

async function poll(app: Hono, sessionId: string, waiter: string): Promise<unknown> {
  const res = await app.request(`/api/hooks/orchestrator-messages?sessionId=${sessionId}&waiter=${waiter}`)
  return res.json()
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

  it('knows its own line when the live waiter hands it over as Stop-hook feedback', () => {
    const rewake =
      '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\n' +
      'Stop hook blocking error from command "Stop": [runcastle] The human pressed Stop. Dispatch nothing until the human replies.\n' +
      '[runcastle] Round 2 returned\n</system-reminder>'
    expect(isRuncastlePrompt(rewake)).toBe(true)
    expect(isRuncastlePrompt('what does [runcastle] mean in the log?')).toBe(false)
    expect(isRuncastlePrompt('<task-notification>\n<summary>Background task done</summary>\n</task-notification>')).toBe(false)
  })
})

describe('the message store, for a lead', () => {
  it('keeps lines when a waiter is let go, and puts handed-back lines first', async () => {
    const key = leadMessageKey('f-store')
    queueOrchestratorLine(key, 'b')
    const held = waitForOrchestratorLines(key, 'w1', 5_000)
    releaseOrchestratorWaiter(key, 'superseded')
    expect(await held).toEqual({ status: 'superseded' })

    requeueOrchestratorLines(key, ['a'])
    expect(takeOrchestratorLines(key)).toEqual(['a', 'b'])
  })
})

describe('deliverToLead', () => {
  it('to a live Claude Code lead: queued for its waiter, never typed into the terminal', async () => {
    const f = feature()
    const id = chat(f.id)
    const write = vi.fn()
    vi.spyOn(ptyRegistry(), 'get').mockReturnValue({ sessionId: id, exited: false, pty: { write } } as never)

    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })

    expect(write).not.toHaveBeenCalled()
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect(queued?.data).toMatchObject({ sessionId: id, route: 'waiter', source: 'runcastle' })
    expect(await poll(mount(), id, 'w1')).toEqual({ status: 'lines', lines: ['[runcastle] Round 1 returned'] })
    expect(types(f.id)).toContain('lead.woke')
  })

  it('to a live Codex lead: routed to codex queue', async () => {
    const f = feature()
    const id = chat(f.id, { runtime: 'codex', live: false })

    await deliverToLead(ctx, f, { text: 'Go given', source: 'runcastle' })

    expect(getSessionRow(ctx, id)?.runtime).toBe('codex')
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect(queued?.data).toMatchObject({ sessionId: id, route: 'codex-queue' })
    // No conversation id yet: held until the session starts.
    expect(takeOrchestratorLines(leadMessageKey(f.id))).toEqual(['[runcastle] Go given'])
  })

  it('with no live terminal: pending, and a human message still stamps the mark', async () => {
    const f = feature()
    const run = chat(f.id, { headless: true })

    await deliverToLead(ctx, f, { text: 'notes', source: 'human' })

    const pending = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_pending')
    expect(pending?.data).toMatchObject({ sessionId: run, source: 'human', text: 'notes' })
    expect(getFeatureRow(ctx, f.id).lastHumanMessageAt).toBeGreaterThan(0)
    expect(hasOrchestratorLines(leadMessageKey(f.id))).toBe(true)
    takeOrchestratorLines(leadMessageKey(f.id))
  })
})

describe('Go, to a chat that planned live', () => {
  // The chat opened on ideate/revisit and never saw the lead brief, so Go's wake
  // is the only thing that can tell it to load the lead skill.
  it('tells a live Claude Code chat to invoke /runcastle:lead', async () => {
    const f = feature({ phase: 'planning' })
    chat(f.id)

    await go(ctx, f.id)

    expect(takeOrchestratorLines(leadMessageKey(f.id))).toEqual([
      expect.stringMatching(/^\[runcastle\] Go given.*invoke \/runcastle:lead first/),
    ])
  })

  it('spells it $lead for a live Codex chat', async () => {
    const f = feature({ phase: 'planning' })
    chat(f.id, { runtime: 'codex', live: false })

    await go(ctx, f.id)

    expect(takeOrchestratorLines(leadMessageKey(f.id))).toEqual([expect.stringMatching(/invoke \$lead first/)])
  })
})

describe('the live delivery per runtime', () => {
  it('is the waiter on Claude Code and codex queue on Codex', () => {
    expect(leadDeliveryFor({ runtime: 'claude-code' })).toBe(asyncRewakeDelivery)
    expect(leadDeliveryFor({})).toBe(asyncRewakeDelivery)
    expect(leadDeliveryFor({ runtime: 'codex' })).not.toBe(asyncRewakeDelivery)
  })

  it('a failed codex queue can hold its lines for the headless fallback', async () => {
    vi.useFakeTimers()
    const key = leadMessageKey('f-codex-fail')
    const delivery = codexQueueDelivery(async () => 1, 10, (k, lines) => {
      requeueOrchestratorLines(k, lines)
      return false
    })
    queueOrchestratorLine(key, 'one')
    delivery.kick({ id: 's', runtime: 'codex', ccSessionId: 'conv' } as never, key)
    await vi.advanceTimersByTimeAsync(20)

    expect(takeOrchestratorLines(key)).toEqual(['one'])
  })
})

describe('the waiter route, for a lead', () => {
  it('waits on the feature’s messages, and refuses a headless chat', async () => {
    const f = feature()
    const live = chat(f.id)
    queueOrchestratorLine(leadMessageKey(f.id), 'one')
    expect(await poll(mount(), live, 'w1')).toEqual({ status: 'lines', lines: ['one'] })

    const g = feature()
    expect(await poll(mount(), chat(g.id, { headless: true }), 'w2')).toEqual({ status: 'ended' })
  })

  it('a session ending answers ended but keeps its feature’s messages', async () => {
    const f = feature()
    const id = chat(f.id)
    const held = poll(mount(), id, 'w1')
    await new Promise((r) => setTimeout(r, 20))

    markSessionEnded(ctx, id)
    queueOrchestratorLine(leadMessageKey(f.id), 'late')

    expect(await held).toEqual({ status: 'ended' })
    expect(takeOrchestratorLines(leadMessageKey(f.id))).toEqual(['late'])
  })
})

describe('a lead’s turn (UserPromptSubmit)', () => {
  it('lets the waiter go so a message waits for the turn’s end', async () => {
    const app = mount()
    const f = feature()
    const id = chat(f.id)
    const held = poll(app, id, 'w1')
    await new Promise((r) => setTimeout(r, 20))

    await hook(app, 'user-prompt', id, { prompt: 'try the other layout' })
    await deliverToLead(ctx, f, { text: 'Round 2 returned', source: 'runcastle' })

    expect(await held).toEqual({ status: 'superseded' })
    // The Stop hook's next waiter takes it.
    await hook(app, 'stop', id, {})
    expect(await poll(app, id, 'w2')).toEqual({ status: 'lines', lines: ['[runcastle] Round 2 returned'] })
  })

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

    await hook(app, 'user-prompt', id, { prompt: 'drop ticket 4 and go' })
    expect(marks()).toBe(1)
    expect(getFeatureRow(ctx, f.id).lastHumanMessageAt).toBeGreaterThan(0)
  })

  it('does not mark a prompt in a headless run', async () => {
    const f = feature()
    await hook(mount(), 'user-prompt', chat(f.id, { headless: true }), { prompt: 'anything' })
    expect(types(f.id)).not.toContain('lead.human_message')
  })
})

describe('the lead waker — a headless resume when nothing is open', () => {
  function recordingLauncher(): { launch: LeadLauncher; inputs: Array<Parameters<LeadLauncher>[1]> } {
    const inputs: Array<Parameters<LeadLauncher>[1]> = []
    return {
      inputs,
      launch: async (_ctx, input) => {
        inputs.push(input)
        return { sessionId: `sess-wake-${inputs.length}` }
      },
    }
  }

  it('resumes the chat headless with every pending message as one prompt', async () => {
    const f = feature()
    const { launch, inputs } = recordingLauncher()
    const stop = startLeadWaker(ctx, launch)
    try {
      await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })
      await vi.waitFor(() => expect(inputs).toHaveLength(1))
    } finally {
      stop()
    }
    expect(inputs[0]).toEqual({
      featureId: f.id,
      kind: 'chat',
      purpose: 'lead-wake',
      message: '[runcastle] Round 1 returned',
    })
    expect(hasOrchestratorLines(leadMessageKey(f.id))).toBe(false)
  })

  it('holds messages while a headless run is going, and resumes with them when it exits', async () => {
    const f = feature()
    const run = chat(f.id, { headless: true })
    const { launch, inputs } = recordingLauncher()
    const stop = startLeadWaker(ctx, launch)
    try {
      await deliverToLead(ctx, f, { text: 'A', source: 'runcastle' })
      await deliverToLead(ctx, f, { text: 'B', source: 'human' })
      await new Promise((r) => setTimeout(r, 10))
      expect(inputs).toHaveLength(0)

      markSessionEnded(ctx, run)
      emit(ctx, f.id, { type: 'session.pty_exited', message: 'exited', data: { sessionId: run } })
      await vi.waitFor(() => expect(inputs).toHaveLength(1))
    } finally {
      stop()
    }
    expect(inputs[0]?.message).toBe('[runcastle] A\n\n[runcastle] B')
  })

  it('retries the resume when a drive stops, for messages left waiting on it', async () => {
    const f = feature()
    queueOrchestratorLine(leadMessageKey(f.id), '[runcastle] my drive notes')
    const { launch, inputs } = recordingLauncher()
    const stop = startLeadWaker(ctx, launch)
    try {
      emit(ctx, f.id, { type: 'testdrive.stopped', message: 'test drive stopped — back on main' })
      await vi.waitFor(() => expect(inputs).toHaveLength(1))
    } finally {
      stop()
    }
    expect(inputs[0]?.message).toBe('[runcastle] my drive notes')
  })

  it('leaves a live lead’s messages to its own channel', async () => {
    const f = feature()
    chat(f.id)
    queueOrchestratorLine(leadMessageKey(f.id), 'x')
    const { launch, inputs } = recordingLauncher()
    expect(await wakeLeadHeadless(ctx, f.id, launch)).toBeNull()
    expect(inputs).toHaveLength(0)
    takeOrchestratorLines(leadMessageKey(f.id))
  })

  describe('holding the messages until the agent checks in (decision 28)', () => {
    /** A launcher that opens a real (process-less) headless chat row per wake. */
    function rowLauncher(): { launch: LeadLauncher; inputs: Array<Parameters<LeadLauncher>[1]>; ids: string[] } {
      const inputs: Array<Parameters<LeadLauncher>[1]> = []
      const ids: string[] = []
      return {
        inputs,
        ids,
        launch: async (c, input) => {
          inputs.push(input)
          const row = createSessionRow(c, {
            featureId: input.featureId,
            kind: 'chat',
            purpose: 'lead-wake',
            worktreePath: '/wt',
            headless: true,
          })
          ids.push(row.id)
          return { sessionId: row.id, resumed: !input.fresh }
        },
      }
    }

    const exited = (featureId: string, sessionId: string, exitCode: number, tail?: string): void => {
      markSessionEnded(ctx, sessionId)
      emit(ctx, featureId, {
        type: 'session.pty_exited',
        message: 'exited',
        data: { sessionId, exitCode, ...(tail ? { tail } : {}) },
      })
    }

    it('releases them once the agent checks in, so its later exit puts nothing back', async () => {
      const f = feature()
      const { launch, ids } = rowLauncher()
      const stop = startLeadWaker(ctx, launch)
      try {
        await deliverToLead(ctx, f, { text: 'notes', source: 'human' })
        await vi.waitFor(() => expect(ids).toHaveLength(1))
        expect(leadDeliveryState(f.id).waitingSince).not.toBeNull()

        markSessionLive(ctx, ids[0] as string, { ccSessionId: 'cc-1' })
        emit(ctx, f.id, { type: 'session.started', message: 'live', data: { sessionId: ids[0] } })
        expect(leadDeliveryState(f.id)).toEqual({ waitingSince: null, lastFailure: null })

        exited(f.id, ids[0] as string, 0)
        await new Promise((r) => setTimeout(r, 10))
      } finally {
        stop()
      }
      expect(ids).toHaveLength(1)
      expect(hasOrchestratorLines(leadMessageKey(f.id))).toBe(false)
      expect(types(f.id)).not.toContain('lead.wake_failed')
    })

    it('says why when the checked-in agent exits non-zero in its turn, without retrying', async () => {
      const f = feature()
      const { launch, ids } = rowLauncher()
      const stop = startLeadWaker(ctx, launch)
      try {
        await deliverToLead(ctx, f, { text: 'Go given', source: 'runcastle' })
        await vi.waitFor(() => expect(ids).toHaveLength(1))
        markSessionLive(ctx, ids[0] as string, { ccSessionId: 'cc-1' })
        emit(ctx, f.id, { type: 'session.started', message: 'live', data: { sessionId: ids[0] } })

        exited(f.id, ids[0] as string, 1, 'Loaded skill runcastle:lead\nAPI Error: overloaded')
        await new Promise((r) => setTimeout(r, 10))
      } finally {
        stop()
      }
      expect(ids).toHaveLength(1)
      expect(hasOrchestratorLines(leadMessageKey(f.id))).toBe(false)
      const failed = listAfter(ctx, f.id, 0).filter((e) => e.type === 'lead.wake_failed')
      expect(failed).toHaveLength(1)
      expect(failed[0]?.data).toEqual({
        sessionId: ids[0],
        exitCode: 1,
        tail: 'Loaded skill runcastle:lead\nAPI Error: overloaded',
        messages: 1,
      })
      expect(failed[0]?.message).toBe(
        "the agent's headless wake exited (code 1) during its turn — it had 1 message(s); open the chat to see " +
          'where it stopped — last output: API Error: overloaded',
      )
    })

    it('puts them back on an early death, retries once fresh, then waits for a real trigger', async () => {
      const f = feature()
      const { launch, inputs, ids } = rowLauncher()
      const stop = startLeadWaker(ctx, launch)
      try {
        await deliverToLead(ctx, f, { text: 'notes', source: 'human' })
        await vi.waitFor(() => expect(ids).toHaveLength(1))

        exited(f.id, ids[0] as string, 1)
        await vi.waitFor(() => expect(ids).toHaveLength(2))
        expect(inputs[1]).toMatchObject({ fresh: true, message: '[runcastle] notes' })
        expect(leadDeliveryState(f.id).lastFailure?.reason).toBe('exited (code 1)')

        exited(f.id, ids[1] as string, 1)
        await new Promise((r) => setTimeout(r, 20))
        expect(ids).toHaveLength(2)
        expect(takeOrchestratorLines(leadMessageKey(f.id))).toEqual(['[runcastle] notes'])
        queueOrchestratorLine(leadMessageKey(f.id), '[runcastle] notes')

        await deliverToLead(ctx, f, { text: 'more', source: 'human' })
        await vi.waitFor(() => expect(ids).toHaveLength(3))
        expect(inputs[2]?.message).toBe('[runcastle] notes\n\n[runcastle] more')
      } finally {
        stop()
      }
      const failed = listAfter(ctx, f.id, 0).filter((e) => e.type === 'lead.wake_failed')
      expect(failed.map((e) => e.data?.failures)).toEqual([1, 2])
      expect(failed[0]?.data).toMatchObject({ sessionId: ids[0], exitCode: 1, tail: '', messages: 1 })
    })

    it('counts a clean exit as delivered even when no hook said so', async () => {
      const f = feature()
      const { launch, ids } = rowLauncher()
      const stop = startLeadWaker(ctx, launch)
      try {
        await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })
        await vi.waitFor(() => expect(ids).toHaveLength(1))
        exited(f.id, ids[0] as string, 0)
        await new Promise((r) => setTimeout(r, 10))
      } finally {
        stop()
      }
      expect(ids).toHaveLength(1)
      expect(hasOrchestratorLines(leadMessageKey(f.id))).toBe(false)
      expect(leadDeliveryState(f.id).waitingSince).toBeNull()
    })

    it('puts them back when the spawn failed inside the launch', async () => {
      const f = feature()
      queueOrchestratorLine(leadMessageKey(f.id), 'x')
      const ids: string[] = []
      const dies: LeadLauncher = async (c, input) => {
        const row = createSessionRow(c, { featureId: input.featureId, kind: 'chat', worktreePath: '/wt', headless: true })
        markSessionEnded(c, row.id)
        ids.push(row.id)
        return { sessionId: row.id }
      }
      await wakeLeadHeadless(ctx, f.id, dies)
      // One immediate retry, fresh; it dies too and the feature waits.
      await vi.waitFor(() => expect(ids).toHaveLength(2))
      await new Promise((r) => setTimeout(r, 10))
      expect(ids).toHaveLength(2)
      expect(takeOrchestratorLines(leadMessageKey(f.id))).toEqual(['x'])
      expect(types(f.id).filter((t) => t === 'lead.wake_failed')).toHaveLength(2)
    })

    it('says a message to a live lead is with the agent', async () => {
      const f = feature()
      chat(f.id)
      await deliverToLead(ctx, f, { text: 'notes', source: 'human' })
      expect(leadDeliveryState(f.id).waitingSince).toBeNull()
      takeOrchestratorLines(leadMessageKey(f.id))
    })
  })

  it('puts the messages back and says why when the resume is refused', async () => {
    const f = feature()
    queueOrchestratorLine(leadMessageKey(f.id), 'x')
    const refused: LeadLauncher = async () => {
      throw new Error('another terminal is open')
    }
    expect(await wakeLeadHeadless(ctx, f.id, refused)).toBeNull()
    expect(takeOrchestratorLines(leadMessageKey(f.id))).toEqual(['x'])
    const failed = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.wake_failed')
    expect(failed?.message).toContain('another terminal is open')
    expect(failed?.data).toEqual({ exitCode: null, tail: 'another terminal is open', messages: 1 })
  })
})
