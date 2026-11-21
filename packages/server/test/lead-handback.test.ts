import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, markSessionEnded, markSessionLive, setSessionTitle } from '../src/launcher/sessions'
import { toolHandBack, toolWaitForYou } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { handbackStateLine, LEAD_HANDED_BACK } from '../src/services/lead-handback'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * A lead on autopilot hands back to its epic (agents-are-woken-only-when-it-matters
 * decisions 20–22; epics-on-autopilot decision 17). Off autopilot there is no
 * epic to hand back to: the feature is the human's.
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

function orchestrator(name = 'Payments'): string {
  const row = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  markSessionEnded(ctx, row.id)
  setSessionTitle(ctx, row.id, name)
  return row.id
}

function leadOf(featureId: string) {
  return createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt' })
}

describe('hand_back from a lead', () => {
  it('wakes the epic once with a handback card: the summary and the feature’s state', async () => {
    const epic = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'phone-fixes', title: 'Phone fixes', lockedTo: epic })

    const result = await toolHandBack(ctx, leadOf(f.id), { summary: 'Review fixes are in; ready to merge.' })

    expect(result).toEqual({ deliveredTo: 'Payments', state: 'Not declared ready · no workers at work' })
    const [prompt] = promptsOf(epic)
    expect(prompt).toMatchObject({
      source: 'runcastle',
      display: { featureHandback: { featureId: f.id, title: 'Phone fixes', summary: 'Review fixes are in; ready to merge.', state: result.state } },
    })
    expect(prompt.held).toBeUndefined()
    expect(prompt.text).toContain('[runcastle] phone-fixes handed back:\nReview fixes are in; ready to merge.')
    expect(prompt.text).toContain('send_to_feature({ slug: "phone-fixes" })')
    expect(host.isRunning(epic)).toBe(true)
    expect(listAfter(ctx, f.id, 0).find((e) => e.type === LEAD_HANDED_BACK)?.data).toMatchObject({ holderId: epic })
  })

  it('is refused off autopilot, even with an epic, pointing to wait_for_you', async () => {
    const epic = orchestrator()
    const mine = seedFeature(ctx, projectId, { slug: 'mine', chatId: epic })
    const alone = seedFeature(ctx, projectId, { slug: 'alone' })
    for (const f of [mine, alone]) {
      await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(GateError)
      await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(/not on autopilot.*wait_for_you/)
      expect(listAfter(ctx, f.id, 0).some((e) => e.type === LEAD_HANDED_BACK)).toBe(false)
    }
    expect(promptsOf(epic)).toHaveLength(0)
  })

  it('is refused once the feature has shipped', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'done', lockedTo: orchestrator(), status: 'shipped' })
    await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(/not on autopilot/)
  })

  it('is no tool for a side chat or a worker', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'x', lockedTo: orchestrator() })
    const side = createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' })
    await expect(toolHandBack(ctx, side, { summary: 'done' })).rejects.toThrow(GateError)
  })
})

describe('wait_for_you from a lead on autopilot', () => {
  it('goes to the epic as a handback card, marked as asking, and sets no need', async () => {
    const epic = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'fx-rates', title: 'FX rates', lockedTo: epic })
    const lead = leadOf(f.id)

    const result = await toolWaitForYou(ctx, lead, { why: 'which currency for mixed teams?' })

    expect(result).toEqual({ ok: true, need: null, toEpic: 'Payments' })
    const [prompt] = promptsOf(epic)
    expect(prompt.text).toContain('fx-rates asks for the human')
    expect(prompt.text).toContain('which currency for mixed teams?')
    expect(listAfter(ctx, f.id, 0).find((e) => e.type === LEAD_HANDED_BACK)?.data).toMatchObject({ asks: true })
  })

  it('off autopilot only records the wait: no wake', async () => {
    const epic = orchestrator()
    const f = seedFeature(ctx, projectId, { slug: 'mine', chatId: epic })
    const result = await toolWaitForYou(ctx, leadOf(f.id), { why: 'pick a theme' })
    expect(result).not.toHaveProperty('toEpic')
    expect(result.need?.why).toBe('pick a theme')
    expect(promptsOf(epic)).toHaveLength(0)
  })
})

describe('the state line runcastle adds', () => {
  it('says ready, what it waits on, and how many workers are at work', () => {
    expect(handbackStateLine({ why: 'Ready to test · Checkout' }, ['landed', 'handed-back'])).toBe('Ready to test · no workers at work')
    expect(handbackStateLine({ why: 'pick a theme' }, ['working'])).toBe('Not declared ready · waits on the human: pick a theme · 1 worker at work')
    expect(handbackStateLine(null, ['working', 'queued', 'failed'])).toBe('Not declared ready · 2 workers at work')
    // As shown: a worker with no turn running is not at work, and a stalled one is named.
    expect(handbackStateLine(null, ['idle', 'stalled'])).toBe('Not declared ready · no workers at work · 1 stalled')
  })
})
