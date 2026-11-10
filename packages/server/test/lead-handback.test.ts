import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkerStatus } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { recordFeatureAction, toolTakeFeature } from '../src/mcp/orchestrator-tools'
import { toolHandBack } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { needOf } from '../src/services/feature-need'
import { OWNER_CHANGED } from '../src/services/holding'
import { handbackStateLine, LEAD_HANDED_BACK } from '../src/services/lead-handback'
import { HANDBACK_CLEARED, markHumanMessage } from '../src/services/lead-status'
import { getFeatureRow } from '../src/services/repo'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * A lead hands back to the orchestrator that holds its feature
 * (agents-are-woken-only-when-it-matters decisions 20–22).
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

function orchestrator(): string {
  const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  markSessionEnded(ctx, row.id)
  return row.id
}

function leadOf(featureId: string) {
  return createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt' })
}

describe('hand_back from a lead', () => {
  it('wakes the holding orchestrator once with a handback card: the summary and the feature’s state', async () => {
    const holder = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'phone-fixes', title: 'Phone fixes', heldBy: holder })

    const result = await toolHandBack(ctx, leadOf(f.id), { summary: 'Review fixes are in; ready to merge.' })

    expect(result.state).toBe('Not declared ready · no workers at work')
    const [prompt] = promptsOf(holder)
    expect(prompt).toMatchObject({
      source: 'runcastle',
      display: { featureHandback: { featureId: f.id, title: 'Phone fixes', summary: 'Review fixes are in; ready to merge.', state: result.state } },
    })
    expect(prompt.held).toBeUndefined()
    expect(prompt.text).toContain('[runcastle] phone-fixes handed back:\nReview fixes are in; ready to merge.')
    expect(prompt.text).toContain('send_to_feature({ slug: "phone-fixes" })')
    expect(host.isRunning(holder)).toBe(true)
    expect(listAfter(ctx, f.id, 0).find((e) => e.type === LEAD_HANDED_BACK)?.data).toMatchObject({ holderId: holder })
  })

  it('is refused when the feature has neither an owner chat nor a chat, pointing to wait_for_you', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'alone' })
    await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(GateError)
    await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(/no orchestrator chat .*wait_for_you/)
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === LEAD_HANDED_BACK)).toBe(false)
  })

  it('is refused once the feature has shipped', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'done', heldBy: orchestrator(), status: 'shipped' })
    await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(/no orchestrator chat/)
  })

  it('goes to the owner chat, not the feature’s older chat', async () => {
    const owner = orchestrator()
    const origin = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'owned', heldBy: owner, chatId: origin, finish: 'show' })

    await toolHandBack(ctx, leadOf(f.id), { summary: 'Ready.' })

    expect(promptsOf(owner)).toHaveLength(1)
    expect(promptsOf(origin)).toHaveLength(0)
  })

  it('on a human-owned feature asks its chat: the handback mark is set, the owner stays the human', async () => {
    const chat = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'asking', chatId: chat, finish: 'show' })

    const result = await toolHandBack(ctx, leadOf(f.id), { summary: 'Does this touch the sidebar feature?' })

    expect(result.passed).toBeUndefined()
    const [prompt] = promptsOf(chat)
    expect(prompt.text).toContain('The human owns this feature')
    expect(getFeatureRow(ctx, f.id)).toMatchObject({ heldBy: undefined, chatId: chat, finish: 'show' })
    expect(getFeatureRow(ctx, f.id).handback?.summary).toBe('Does this touch the sidebar feature?')
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === OWNER_CHANGED)).toBe(false)
  })

  it('at the plan yes on a feature its chat finishes, passes the feature to the chat first, then delivers', async () => {
    const chat = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'grilled', chatId: chat, finish: 'merge' })

    const result = await toolHandBack(ctx, leadOf(f.id), { summary: 'Plan agreed.', planAgreed: true })

    expect(result.passed).toBe(true)
    expect(getFeatureRow(ctx, f.id)).toMatchObject({ heldBy: chat, finish: 'merge', handback: { summary: 'Plan agreed.' } })
    const types = listAfter(ctx, f.id, 0).map((e) => e.type)
    expect(types.indexOf(OWNER_CHANGED)).toBeLessThan(types.indexOf(LEAD_HANDED_BACK))
    expect(promptsOf(chat)[0]?.text).toContain('you own it now')
  })

  it('a plan yes on a feature the human finishes changes no owner', async () => {
    const chat = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'mine', chatId: chat, finish: 'you' })
    await toolHandBack(ctx, leadOf(f.id), { summary: 'Plan agreed.', planAgreed: true })
    expect(getFeatureRow(ctx, f.id).heldBy).toBeUndefined()
  })

  it('is no tool for a side chat or a worker', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'x', heldBy: orchestrator() })
    const side = createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' })
    await expect(toolHandBack(ctx, side, { summary: 'done' })).rejects.toThrow(GateError)
  })
})

/**
 * The handback is recorded on the feature until something answers it
 * (the-status-tells-the-truth-about-who-and-what decisions 5, 7).
 */
describe('the handback mark', () => {
  const cleared = (featureId: string) => listAfter(ctx, featureId, 0).filter((e) => e.type === HANDBACK_CLEARED)

  it('is written by hand_back, reads With <its chat>, and a second handback replaces it', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'marked', heldBy: orchestrator() })
    const before = Date.now()
    await toolHandBack(ctx, leadOf(f.id), { summary: 'Blocked on a conflict in api.ts. Details follow.' })

    const first = getFeatureRow(ctx, f.id).handback
    expect(first).toEqual({ at: expect.any(Number), summary: 'Blocked on a conflict in api.ts. Details follow.' })
    expect(first!.at).toBeGreaterThanOrEqual(before)
    expect(needOf(ctx, getFeatureRow(ctx, f.id))).toMatchObject({
      kind: 'handback',
      held: true,
      words: 'With Working by itself · Blocked on a conflict in api.ts',
    })

    await toolHandBack(ctx, leadOf(f.id), { summary: 'Ready to merge.' })
    expect(getFeatureRow(ctx, f.id).handback?.summary).toBe('Ready to merge.')
    expect(listAfter(ctx, f.id, 0).filter((e) => e.type === LEAD_HANDED_BACK)).toHaveLength(2)
    expect(cleared(f.id)).toHaveLength(0)
  })

  it('is cleared by a human message to the lead, with an event', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'human', heldBy: orchestrator() })
    await toolHandBack(ctx, leadOf(f.id), { summary: 'Ready.' })
    markHumanMessage(ctx, f.id, { typed: true })
    expect(getFeatureRow(ctx, f.id).handback).toBeNull()
    expect(cleared(f.id).map((e) => e.data)).toEqual([expect.objectContaining({ cause: 'message' })])
    // Nothing stands any more: a second message emits nothing.
    markHumanMessage(ctx, f.id)
    expect(cleared(f.id)).toHaveLength(1)
  })

  it('is cleared when another thread takes the feature, with an event', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'taken', heldBy: orchestrator() })
    await toolHandBack(ctx, leadOf(f.id), { summary: 'Ready.' })
    const live = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    markSessionLive(ctx, live.id, { ccSessionId: `cc-${live.id}` })
    const other = getSessionRow(ctx, live.id)!
    toolTakeFeature(ctx, other, { slug: 'taken' })
    expect(getFeatureRow(ctx, f.id).heldBy).toBe(other.id)
    expect(getFeatureRow(ctx, f.id).handback).toBeNull()
    expect(cleared(f.id).map((e) => e.data)).toEqual([expect.objectContaining({ cause: 'hold' })])
  })

  it('is cleared by an orchestrator action recorded on the feature, with an event', async () => {
    const holder = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'acted', heldBy: holder })
    await toolHandBack(ctx, leadOf(f.id), { summary: 'Ready.' })
    recordFeatureAction(ctx, getSessionRow(ctx, holder)!, f.id, 'brief')
    expect(getFeatureRow(ctx, f.id).handback).toBeNull()
    expect(cleared(f.id).map((e) => e.data)).toEqual([expect.objectContaining({ cause: 'orchestrator' })])
  })
})

describe('the state line runcastle adds', () => {
  it('says ready, what it waits on, and how many workers are at work', () => {
    const w = (status: WorkerStatus) => ({ status })
    expect(handbackStateLine({ waitingReason: 'ready to test' }, [w('landed'), w('handed-back')])).toBe('Ready to test · no workers at work')
    expect(handbackStateLine({ waitingReason: 'pick a theme' }, [w('working')])).toBe('Not declared ready · waits on the human: pick a theme · 1 worker at work')
    expect(handbackStateLine({ waitingReason: null }, [w('working'), w('queued'), w('failed')])).toBe('Not declared ready · 2 workers at work')
  })
})
