import type { Feature, SessionRow } from '@runcastle/core'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionLive, setSessionTitle } from '../src/launcher/sessions'
import { toolSendToFeature } from '../src/mcp/orchestrator-run-tools'
import {
  toolAddToBrief,
  toolDrive,
  toolMergeFeature,
  toolPlanFeature,
  toolSetAutopilot,
  toolStartFeature,
  toolStopFeatureRun,
} from '../src/mcp/orchestrator-tools'
import { featureStatusView, toolCreateFeature, toolHandBack, toolSetFeatureDependencies, toolWaitForYou } from '../src/mcp/server'
import hooksApp from '../src/routes/hooks'
import {
  add,
  AUTOPILOT_CHANGED,
  autopilotOf,
  isLocked,
  mayAct,
  turnOff,
  turnOn,
} from '../src/services/autopilot'
import { listByProject, listAfter } from '../src/services/events'
import { list as listFeatures } from '../src/services/features'
import { recordDesign, setDesignState } from '../src/services/designs'
import { getFeatureRow } from '../src/services/repo'
import { setWait, waitOf } from '../src/services/waits'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { listThreads } from '../src/threads/read'
import type { AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * Epics on autopilot: the switch on the epic, which locks every open feature
 * of it (decision 14), the one check the orchestrator's acting tools go
 * through, and what the leads and the epic hear when it changes.
 */

let ctx: AppCtx
let projectId: string
let host: AgentHost

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
})

/** A live orchestrator chat named `name`. */
function epic(name: string): SessionRow {
  const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  setSessionTitle(ctx, row.id, name)
  return getSessionRow(ctx, row.id) as SessionRow
}

/** The feature's lead chat, with a conversation, so it can be told things. */
function leadOf(feature: Feature): SessionRow {
  const row = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  return getSessionRow(ctx, row.id) as SessionRow
}

const changes = () => listByProject(ctx, projectId).filter((e) => e.type === AUTOPILOT_CHANGED)
const fresh = (f: Feature) => getFeatureRow(ctx, f.id)
const epicRow = (s: SessionRow) => getSessionRow(ctx, s.id) as SessionRow
const promptTexts = (id: string) => promptsOf(id).map((p) => p.text)

describe('the switch', () => {
  it('is off for every epic at first, and no feature is locked', () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    expect(epicRow(e).autopilot).toBeFalsy()
    expect(isLocked(ctx, f)).toBe(false)
  })

  it('turning on locks every open feature of the epic, and none shipped, archived or another epic’s, with one event', async () => {
    const e = epic('Checkout')
    const other = epic('Search')
    const a = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const grill = seedFeature(ctx, projectId, { slug: 'billing', chatId: e.id, status: 'draft', baseBranch: null })
    const shipped = seedFeature(ctx, projectId, { slug: 'done', chatId: e.id, status: 'shipped' })
    const archived = seedFeature(ctx, projectId, { slug: 'gone', chatId: e.id, status: 'archived' })
    const theirs = seedFeature(ctx, projectId, { slug: 'theirs', chatId: other.id })
    const loose = seedFeature(ctx, projectId, { slug: 'loose' })

    const result = await turnOn(ctx, e.id)

    expect(result).toMatchObject({ epic: 'Checkout', autopilot: true, changed: ['cart', 'billing'], locked: ['cart', 'billing'] })
    expect(epicRow(e).autopilot).toBe(true)
    expect(isLocked(ctx, fresh(a))).toBe(true)
    expect(isLocked(ctx, fresh(grill))).toBe(true)
    for (const f of [shipped, archived, theirs, loose]) expect(isLocked(ctx, fresh(f)), f.slug).toBe(false)
    expect(autopilotOf(ctx, fresh(a))).toEqual({ epicId: e.id, epicName: 'Checkout' })
    expect(changes().map((c) => c.data)).toEqual([
      expect.objectContaining({ epicId: e.id, change: 'on', autopilot: true, featureIds: [a.id, grill.id] }),
    ])
  })

  it('a feature that ships or is archived unlocks by itself', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    await turnOn(ctx, e.id)
    expect(isLocked(ctx, fresh(f))).toBe(true)
    expect(isLocked(ctx, { ...fresh(f), status: 'shipped' })).toBe(false)
    expect(isLocked(ctx, { ...fresh(f), status: 'archived' })).toBe(false)
  })

  it('refuses turning on twice, changing nothing', async () => {
    const e = epic('Checkout')
    seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    await turnOn(ctx, e.id)
    await expect(turnOn(ctx, e.id)).rejects.toThrow(/already on autopilot/)
    expect(changes()).toHaveLength(1)
  })

  it('closes every open wait in the epic’s features and tells each lead to re-ask through the epic (decision 24)', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const g = seedFeature(ctx, projectId, { slug: 'pay', chatId: e.id })
    const lead = leadOf(f)
    const quiet = leadOf(g)
    const worker = createSessionRow(ctx, { featureId: f.id, kind: 'worker', worktreePath: '/wt' })
    setWait(ctx, lead.id, 'which currency?', 'agent')
    setWait(ctx, worker.id, 'grey or white?', 'agent')

    await turnOn(ctx, e.id)

    expect(waitOf(ctx, lead.id)).toBeNull()
    expect(waitOf(ctx, worker.id)).toBeNull()
    const said = promptTexts(lead.id)
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('on autopilot now, in the epic "Checkout"')
    expect(said[0]).toContain('"which currency?"; "grey or white?"')
    expect(said[0]).toContain('re-ask it through the epic with hand_back')
    const told = promptTexts(quiet.id)
    expect(told).toHaveLength(1)
    expect(told[0]).toContain('on autopilot now, in the epic "Checkout"')
    expect(told[0]).not.toContain('re-ask')
  })

  it('add moves a feature from another epic (or none) here by its epic link, refused while it is locked there', async () => {
    const e = epic('Checkout')
    const other = epic('Search')
    seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const loose = seedFeature(ctx, projectId, { slug: 'loose' })
    const theirs = seedFeature(ctx, projectId, { slug: 'theirs', chatId: other.id })
    await turnOn(ctx, other.id)
    await turnOn(ctx, e.id)

    await expect(add(ctx, e.id, ['theirs'])).rejects.toThrow(/on autopilot in the epic "Search"/)
    expect(fresh(theirs).chatId).toBe(other.id)

    const added = await add(ctx, e.id, ['loose'])
    expect(added).toMatchObject({ movedFrom: [{ slug: 'loose', from: null }], changed: ['loose'], locked: ['cart', 'loose'] })
    expect(fresh(loose).chatId).toBe(e.id)
    expect(isLocked(ctx, fresh(loose))).toBe(true)
    expect(changes().at(-1)?.data).toMatchObject({ change: 'add', featureIds: [loose.id], autopilot: true })

    await turnOff(ctx, other.id)
    expect(await add(ctx, e.id, ['theirs'])).toMatchObject({ movedFrom: [{ slug: 'theirs', from: 'Search' }] })
    expect(fresh(theirs).chatId).toBe(e.id)
    expect(isLocked(ctx, fresh(theirs))).toBe(true)
  })

  it('a feature added on autopilot has its waits closed and its lead told, as turning on does', async () => {
    const e = epic('Checkout')
    seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const loose = seedFeature(ctx, projectId, { slug: 'loose' })
    const lead = leadOf(loose)
    setWait(ctx, lead.id, 'which currency?', 'agent')
    await turnOn(ctx, e.id)

    await add(ctx, e.id, ['loose'])

    expect(waitOf(ctx, lead.id)).toBeNull()
    expect(promptTexts(lead.id)).toEqual([expect.stringContaining('"which currency?"')])
  })

  it('add off autopilot only moves the feature: nothing locks and its lead hears nothing', async () => {
    const e = epic('Checkout')
    const loose = seedFeature(ctx, projectId, { slug: 'loose' })
    const lead = leadOf(loose)
    setWait(ctx, lead.id, 'which currency?', 'agent')

    expect(await add(ctx, e.id, ['loose'])).toMatchObject({ autopilot: false, locked: [], changed: ['loose'] })

    expect(fresh(loose).chatId).toBe(e.id)
    expect(isLocked(ctx, fresh(loose))).toBe(false)
    expect(waitOf(ctx, lead.id)?.why).toBe('which currency?')
    expect(promptTexts(lead.id)).toHaveLength(0)
  })

  it('add refuses a shipped or archived feature, an unknown slug and an empty list; a feature already here is no change', async () => {
    const e = epic('Checkout')
    seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    seedFeature(ctx, projectId, { slug: 'done', status: 'shipped' })
    seedFeature(ctx, projectId, { slug: 'gone', status: 'archived' })
    await expect(add(ctx, e.id, ['done'])).rejects.toThrow(/is shipped/)
    await expect(add(ctx, e.id, ['gone'])).rejects.toThrow(/is archived/)
    await expect(add(ctx, e.id, ['nope'])).rejects.toThrow(/no feature `nope`/)
    await expect(add(ctx, e.id, [])).rejects.toThrow(/empty/)
    expect(await add(ctx, e.id, ['cart'])).toMatchObject({ changed: [], movedFrom: [] })
    expect(changes()).toHaveLength(0)
  })

  it('turning off clears the switch, one event, each formerly locked lead told once, the epic not told', async () => {
    const e = epic('Checkout')
    const a = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const b = seedFeature(ctx, projectId, { slug: 'pay', chatId: e.id })
    const done = seedFeature(ctx, projectId, { slug: 'done', chatId: e.id, status: 'shipped' })
    const leadA = leadOf(a)
    const leadB = leadOf(b)
    const leadDone = leadOf(done)
    await turnOn(ctx, e.id)
    const before = changes().length

    expect(await turnOff(ctx, e.id)).toMatchObject({ autopilot: false, locked: [], changed: ['cart', 'pay'] })

    expect(epicRow(e).autopilot).toBeFalsy()
    expect(isLocked(ctx, fresh(a))).toBe(false)
    expect(isLocked(ctx, fresh(b))).toBe(false)
    expect(changes()).toHaveLength(before + 1)
    expect(changes().at(-1)?.data).toMatchObject({ change: 'off', autopilot: false, by: 'epic', featureIds: [a.id, b.id] })
    for (const lead of [leadA, leadB]) {
      const told = promptTexts(lead.id).filter((t) => t.includes("the human's again"))
      expect(told).toHaveLength(1)
      expect(told[0]).toContain('wait_for_you')
    }
    expect(promptTexts(leadDone.id)).toHaveLength(0)
    expect(promptsOf(e.id)).toHaveLength(0)
  })

  it('turning off an epic that is off changes nothing and tells nobody', async () => {
    const e = epic('Checkout')
    const lead = leadOf(seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id }))
    expect(await turnOff(ctx, e.id)).toMatchObject({ autopilot: false, changed: [] })
    expect(changes()).toHaveLength(0)
    expect(promptTexts(lead.id)).toHaveLength(0)
  })

  it('a feature an epic creates while on autopilot is locked at once; off autopilot it is not', async () => {
    const e = epic('Checkout')
    const off = await toolCreateFeature(ctx, e, { title: 'Before', oneLiner: 'x', draft: true })
    expect(isLocked(ctx, fresh(off))).toBe(false)
    await turnOn(ctx, e.id)
    const on = await toolCreateFeature(ctx, e, { title: 'After', oneLiner: 'x', draft: true })
    expect(isLocked(ctx, fresh(off))).toBe(true)
    expect(isLocked(ctx, fresh(on))).toBe(true)
  })
})

describe('may this epic act on this feature', () => {
  it('own features: create, start, plan, read, brief and dependencies pass; message, stop, drive and merge only on autopilot', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id, status: 'draft' })
    for (const action of ['create', 'start', 'plan', 'read', 'brief', 'dependencies'] as const) {
      expect(mayAct(ctx, e.id, f, action), action).toEqual({ ok: true })
    }
    for (const action of ['message', 'stop', 'drive', 'merge'] as const) {
      const verdict = mayAct(ctx, e.id, f, action)
      expect(verdict.ok, action).toBe(false)
      expect(!verdict.ok && verdict.reason).toMatch(/is the human's: autopilot is off.*Link them to its chat: \[Demo feature\]\(\/p\/.*\/f\/cart\/chat\)/)
    }
    await turnOn(ctx, e.id)
    for (const action of ['message', 'stop', 'drive', 'merge', 'start'] as const) {
      expect(mayAct(ctx, e.id, fresh(f), action), action).toEqual({ ok: true })
    }
  })

  it('another epic’s feature, or one with none, is refused, saying whose it is', async () => {
    const e = epic('Checkout')
    const other = epic('Search')
    const theirs = seedFeature(ctx, projectId, { slug: 'theirs', chatId: other.id })
    const loose = seedFeature(ctx, projectId, { slug: 'loose' })
    const start = mayAct(ctx, e.id, theirs, 'start')
    expect(!start.ok && start.reason).toMatch(/belongs to the epic "Search"/)
    const plan = mayAct(ctx, e.id, loose, 'plan')
    expect(!plan.ok && plan.reason).toMatch(/no epic/)
    await turnOn(ctx, other.id)
    const merge = mayAct(ctx, e.id, fresh(theirs), 'merge')
    expect(!merge.ok && merge.reason).toMatch(/on autopilot in the epic "Search", so only that epic acts on it/)
  })

  it('a started feature’s brief is the human’s off autopilot', () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    expect(mayAct(ctx, e.id, f, 'brief').ok).toBe(false)
  })

  it('every acting tool refuses a feature off autopilot, doing nothing', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const calls: [string, () => unknown][] = [
      ['send_to_feature', () => toolSendToFeature(ctx, e, { slug: 'cart', message: 'hi' })],
      ['stop_feature_run', () => toolStopFeatureRun(ctx, e, { slug: 'cart' })],
      ['drive', () => toolDrive(ctx, e, { slug: 'cart', action: 'start' })],
      ['merge_feature', () => toolMergeFeature(ctx, e, { slug: 'cart' })],
      ['add_to_brief', () => toolAddToBrief(ctx, e, { slug: 'cart', text: 'x' })],
    ]
    for (const [name, call] of calls) {
      await expect((async () => call())(), name).rejects.toThrow(/the human's/)
    }
    expect(listAfter(ctx, f.id, 0)).toEqual([])
  })

  it('start, plan and dependencies are refused on another epic’s feature', async () => {
    const e = epic('Checkout')
    const other = epic('Search')
    seedFeature(ctx, projectId, { slug: 'theirs', chatId: other.id, status: 'draft', baseBranch: null })
    await expect(toolStartFeature(ctx, e, { slug: 'theirs' })).rejects.toThrow(/belongs to the epic "Search"/)
    await expect(toolPlanFeature(ctx, e, { slug: 'theirs' })).rejects.toThrow(/belongs to the epic "Search"/)
    expect(() => toolSetFeatureDependencies(ctx, e, { slug: 'theirs', dependsOn: [] })).toThrow(/belongs to the epic "Search"/)
  })
})

describe('the set_autopilot tool', () => {
  it('turns on, adds and turns off, recording each feature on the chat’s card', async () => {
    const e = epic('Checkout')
    seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    seedFeature(ctx, projectId, { slug: 'pay' })
    expect(await toolSetAutopilot(ctx, e, { action: 'on' })).toMatchObject({ autopilot: true, locked: ['cart'] })
    expect(await toolSetAutopilot(ctx, e, { action: 'add', features: ['pay'] })).toMatchObject({ locked: ['cart', 'pay'] })
    expect(await toolSetAutopilot(ctx, e, { action: 'off' })).toMatchObject({ autopilot: false, locked: [], changed: ['cart', 'pay'] })
    await expect(toolSetAutopilot(ctx, e, { action: 'add' })).rejects.toThrow(/needs `features`/)
  })

  it('has no remove action', async () => {
    const e = epic('Checkout')
    seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    await toolSetAutopilot(ctx, e, { action: 'on' })
    // @ts-expect-error -- `remove` is gone: to work on one feature, the human ends autopilot (decision 14).
    await expect(toolSetAutopilot(ctx, e, { action: 'remove', features: ['cart'] })).rejects.toThrow(/`on`, `add` or `off`/)
    expect(epicRow(e).autopilot).toBe(true)
  })

  it('is the orchestrator’s alone', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    await expect(toolSetAutopilot(ctx, leadOf(f), { action: 'off' })).rejects.toThrow(/only the orchestrator/)
  })
})

describe('talking to a locked lead', () => {
  it('send_to_feature opens with the epic’s name; the human’s own words are relayed marked as theirs', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const lead = leadOf(f)
    await turnOn(ctx, e.id)

    await toolSendToFeature(ctx, e, { slug: 'cart', message: 'Use the blue button.' })
    await toolSendToFeature(ctx, e, { slug: 'cart', humanWords: 'Yes, ship the plan.' })

    const said = promptTexts(lead.id).slice(-2)
    expect(said[0]).toContain('From Checkout, the project\'s orchestrator, not the human:\n\nUse the blue button.')
    expect(said[1]).toContain("From Checkout, the project's orchestrator, relaying the human's own words")
    expect(said[1]).toContain('> Yes, ship the plan.')
  })
})

describe('a locked lead reports to its epic', () => {
  it('get_feature_context-style reads say which epic runs it', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    expect(featureStatusView(ctx, { featureId: f.id }).autopilot).toBeNull()
    await turnOn(ctx, e.id)
    expect(featureStatusView(ctx, { featureId: f.id }).autopilot).toEqual({ epic: 'Checkout', chatId: e.id })
  })

  it('hand_back goes to the epic on autopilot, and is refused off it with a pointer to wait_for_you', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const lead = leadOf(f)
    await expect(toolHandBack(ctx, lead, { summary: 'done' })).rejects.toThrow(/not on autopilot.*wait_for_you/)
    await turnOn(ctx, e.id)
    const result = await toolHandBack(ctx, lead, { summary: 'Plan ready for a yes.' })
    expect(result.deliveredTo).toBe('Checkout')
    expect(promptTexts(e.id).at(-1)).toContain('[runcastle] cart handed back:\nPlan ready for a yes.')
  })

  it('wait_for_you on autopilot goes to the epic and sets no need; off autopilot it sets the need', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const lead = leadOf(f)
    await turnOn(ctx, e.id)

    const on = await toolWaitForYou(ctx, lead, { why: 'which currency?' })
    expect(on).toMatchObject({ ok: true, need: null, toEpic: 'Checkout' })
    expect(waitOf(ctx, lead.id)).toBeNull()
    expect(promptTexts(e.id).at(-1)).toContain('cart asks for the human')

    await turnOff(ctx, e.id)
    const off = await toolWaitForYou(ctx, lead, { why: 'which currency?' })
    expect(off.need?.why).toBe('which currency?')
    expect(off).not.toHaveProperty('toEpic')
  })

  it('a worker’s wait_for_you on a locked feature goes to the epic too, setting no need on the worker', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    leadOf(f)
    const worker = createSessionRow(ctx, { featureId: f.id, kind: 'worker', worktreePath: '/wt' })
    await turnOn(ctx, e.id)

    const answer = await toolWaitForYou(ctx, worker, { why: 'grey or white?' })
    expect(answer).toMatchObject({ ok: true, need: null, toEpic: 'Checkout' })
    expect(waitOf(ctx, worker.id)).toBeNull()
    const told = promptTexts(e.id).at(-1)
    expect(told).toContain('cart asks for the human (its worker')
    expect(told).toContain('grey or white?')
    expect(listAfter(ctx, f.id, 0).at(-1)).toMatchObject({ type: 'lead.handed_back', data: { asks: true } })

    await turnOff(ctx, e.id)
    const off = await toolWaitForYou(ctx, worker, { why: 'grey or white?' })
    expect(off.need?.why).toBe('grey or white?')
    expect(waitOf(ctx, worker.id)?.why).toBe('grey or white?')
  })
})

describe('the human side', () => {
  const caller = () => createCallerFactory(appRouter)(ctx)

  it('the feature list and get carry the lock; the epic carries its switch', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const epicEntry = () => listThreads(ctx, { projectId }).find((t) => t.id === e.id)
    expect(listFeatures(ctx, projectId)[0]?.autopilot).toBeNull()
    expect(epicEntry()?.autopilot).toBe(false)

    await turnOn(ctx, e.id)

    expect(listFeatures(ctx, projectId)[0]?.autopilot).toEqual({ epicId: e.id, epicName: 'Checkout' })
    expect((await caller().feature.get({ id: f.id })).autopilot).toEqual({ epicId: e.id, epicName: 'Checkout' })
    expect(epicEntry()?.autopilot).toBe(true)
  })

  it('endAutopilot ends it with no orchestrator turn, and tells the orchestrator', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    await turnOn(ctx, e.id)

    const result = await caller().feature.endAutopilot({ epicId: e.id })

    expect(result).toMatchObject({ autopilot: false, changed: ['cart'] })
    expect(isLocked(ctx, fresh(f))).toBe(false)
    expect(changes().at(-1)?.data).toMatchObject({ change: 'off', by: 'human' })
    expect(promptTexts(e.id).at(-1)).toContain('The human ended autopilot for this epic')
  })

  it('a message from the human to a locked lead or one of its workers is refused', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    const lead = leadOf(f)
    const worker = createSessionRow(ctx, { featureId: f.id, kind: 'worker', worktreePath: '/wt' })
    await turnOn(ctx, e.id)
    for (const id of [lead.id, worker.id]) {
      await expect(caller().thread.send({ threadId: id, text: 'hello' })).rejects.toThrow(/on autopilot in the epic "Checkout"/)
    }
  })

  describe('typing in a locked lead’s chat', () => {
    beforeEach(() => setRuntimeCtx(ctx))
    afterEach(() => clearRuntimeCtx())

    async function prompt(session: SessionRow, text: string): Promise<unknown> {
      const app = new Hono()
      app.route('/api/hooks', hooksApp)
      const res = await app.request('/api/hooks/user-prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, payload: { hook_event_name: 'UserPromptSubmit', prompt: text } }),
      })
      return res.json()
    }

    it('is blocked, saying where to talk; nothing changes owner', async () => {
      const e = epic('Checkout')
      const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
      const lead = leadOf(f)
      await turnOn(ctx, e.id)

      expect(await prompt(lead, 'let me do it')).toMatchObject({ decision: 'block', reason: expect.stringContaining('talk to the epic') })
      expect(isLocked(ctx, fresh(f))).toBe(true)
    })

    it('passes off autopilot', async () => {
      const e = epic('Checkout')
      const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
      expect(await prompt(leadOf(f), 'hello')).not.toHaveProperty('decision')
    })
  })
})

describe('designs approved on autopilot', () => {
  it('a lead\'s approval on a locked feature is recorded as autopilot\'s; off autopilot it is the lead\'s', async () => {
    const e = epic('Checkout')
    const f = seedFeature(ctx, projectId, { slug: 'cart', chatId: e.id })
    recordDesign(ctx, f.id, { path: '/preview/a.html', title: 'A' })
    recordDesign(ctx, f.id, { path: '/preview/b.html', title: 'B' })
    setDesignState(ctx, f.id, { path: '/preview/a.html', state: 'approved' })
    await turnOn(ctx, e.id)
    const b = setDesignState(ctx, f.id, { path: '/preview/b.html', state: 'approved' })
    expect(b.approvedBy).toBe('autopilot')
    await turnOff(ctx, e.id)
    const a = setDesignState(ctx, f.id, { path: '/preview/a.html', state: 'approved' })
    expect(a.approvedBy).toBe('lead')
  })
})
