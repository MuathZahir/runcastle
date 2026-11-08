import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkerStatus } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolHandBack } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { handbackStateLine, LEAD_HANDED_BACK } from '../src/services/lead-handback'
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

  it('is refused when no orchestrator holds the feature', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'alone' })
    await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(GateError)
    await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(/no orchestrator holds this feature/)
  })

  it('is refused once the feature has shipped', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'done', heldBy: orchestrator(), status: 'shipped' })
    await expect(toolHandBack(ctx, leadOf(f.id), { summary: 'done' })).rejects.toThrow(/no orchestrator holds/)
  })

  it('is no tool for a side chat or a worker', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'x', heldBy: orchestrator() })
    const side = createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' })
    await expect(toolHandBack(ctx, side, { summary: 'done' })).rejects.toThrow(GateError)
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
