import type { WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp, { featureContext, toolsForAudience } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { go } from '../src/services/features'
import { getFeatureRow, getRunRow } from '../src/services/repo'
import { storeTickets } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The lead's MCP surface (`the-feature-lead-runs-rounds`), called over the real
 * `/mcp` route as a feature chat calls it: dispatch_round, stop_round,
 * declare_ready, wait_for_you, and the round fields of get_feature_context.
 */

const landingBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(wctx: WorkflowCtx) {
    for (const t of wctx.tickets) {
      if (t.status === 'pending') wctx.updateTicket(t.id, { status: 'done', commits: ['abc'] })
    }
    return { status: 'succeeded', summary: 'all landed' }
  },
}

function ticketInput(title: string) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] }
}

async function waitFor(fn: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('waitFor timed out')
}

describe('the lead’s MCP tools', () => {
  let ctx: AppCtx
  let app: Hono
  let featureId: string
  let sessionId: string
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repoPath = tmpRepo()
    const project = seedProject(ctx, repoPath)
    featureId = seedFeature(ctx, project.id, { slug: 'coupons', ticketsReadyLap: 1 }).id
    sessionId = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath }).id
    markSessionLive(ctx, sessionId)
    setRuntimeCtx(ctx)
    app = new Hono()
    app.route('/mcp', mcpApp)
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', landingBurner)
  })

  afterEach(() => {
    clearRuntimeCtx()
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  /** The tool's answer, unwrapped from the JSON-RPC envelope, with its error flag. */
  async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
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

  it('offers the four lead tools to the feature chat only', () => {
    for (const tool of ['dispatch_round', 'stop_round', 'declare_ready', 'wait_for_you']) {
      expect(toolsForAudience('chat')).toContain(tool)
      expect(toolsForAudience('drive-fix')).not.toContain(tool)
      expect(toolsForAudience('project')).not.toContain(tool)
      expect(toolsForAudience('run')).not.toContain(tool)
    }
  })

  it('dispatch_round refuses before Go with the reason, as a tool error', async () => {
    const [t] = storeTickets(ctx, featureId, [ticketInput('a')])
    const out = await call('dispatch_round', { seqs: [t.seq] })
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/no Go yet/)
  })

  it('dispatch_round starts a round over the named tickets, which the context then reports', async () => {
    const [a, b] = storeTickets(ctx, featureId, [ticketInput('a'), ticketInput('b')])
    await go(ctx, featureId)

    const out = await call('dispatch_round', { seqs: [a.seq] })
    expect(out.isError).toBe(false)
    const { runId } = JSON.parse(out.text) as { runId: string }
    await waitFor(() => getRunRow(ctx, runId).status !== 'running' && listAfter(ctx, featureId, 0).some((e) => e.type === 'round.gates'))

    const context = featureContext(ctx, { featureId })
    expect(context).not.toHaveProperty('autonomy')
    expect(context.driveActive).toBe(false)
    expect(context.stopped).toBe(false)
    expect(context.waitingReason).toBeNull()
    expect(context.latestReady).toBeNull()
    expect(context.rounds).toEqual([
      expect.objectContaining({ round: 1, runId, status: 'succeeded', ticketSeqs: [a.seq], landed: [a.seq], gates: null }),
    ])
    expect(context.tickets.find((row) => row.seq === b.seq)?.status).toBe('pending')
    // Tokens are recorded, never shown (decision 25) — not even to the lead.
    expect(JSON.stringify(context)).not.toMatch(/"tokens"/)
  })

  it('declare_ready moves building → review and returns the warnings', async () => {
    await go(ctx, featureId)
    const out = await call('declare_ready', { scenario: 'Checkout', whatToTest: 'Apply a coupon at checkout.' })
    expect(out.isError).toBe(false)
    expect(JSON.parse(out.text)).toEqual({ ok: true, phase: 'review', warnings: [] })
    expect(featureContext(ctx, { featureId }).latestReady).toMatchObject({ scenario: 'Checkout' })
  })

  it('wait_for_you sets the waiting reason the context shows', async () => {
    const out = await call('wait_for_you', { why: 'round 2 proposed' })
    expect(JSON.parse(out.text)).toEqual({ ok: true, waitingReason: 'round 2 proposed' })
    expect(getFeatureRow(ctx, featureId).waitingReason).toBe('round 2 proposed')
  })

  it('stop_round refuses when nothing is running', async () => {
    const out = await call('stop_round', {})
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/no round is running/)
  })
})
