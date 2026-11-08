
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp, { featureContext, toolsForAudience } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { getFeatureRow } from '../src/services/repo'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * The lead's MCP surface, called over the real `/mcp` route as a feature chat
 * calls it: declare_ready, wait_for_you, show_panel. The ticket and round tools
 * are gone (burns-become-workers); the lead delegates to workers.
 */

describe('the lead’s MCP tools', () => {
  let ctx: AppCtx
  let app: Hono
  let featureId: string
  let sessionId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repoPath = tmpRepo()
    const project = seedProject(ctx, repoPath)
    featureId = seedFeature(ctx, project.id, { slug: 'coupons' }).id
    sessionId = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath }).id
    markSessionLive(ctx, sessionId)
    setRuntimeCtx(ctx)
    app = new Hono()
    app.route('/mcp', mcpApp)
  })

  afterEach(() => clearRuntimeCtx())

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

  it('offers the lead tools to the feature chat only, and no ticket or round tool to anyone', () => {
    for (const tool of ['declare_ready', 'wait_for_you']) {
      expect(toolsForAudience('chat')).toContain(tool)
      expect(toolsForAudience('fix-drive-worker')).not.toContain(tool)
      expect(toolsForAudience('project')).not.toContain(tool)
      expect(toolsForAudience('review')).not.toContain(tool)
    }
  })

  /** The named tool's published input properties, from `tools/list`. */
  async function inputProperties(name: string): Promise<string[]> {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'X-Runcastle-Session': sessionId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    const envelope = (await res.json()) as {
      result: { tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[] }
    }
    const tool = envelope.result.tools.find((t) => t.name === name)
    return Object.keys(tool?.inputSchema.properties ?? {})
  }

  it('declare_ready takes only a scenario, needs no Go, and puts the feature under Needs you', async () => {
    expect(await inputProperties('declare_ready')).toEqual(['scenario'])
    const out = await call('declare_ready', { scenario: 'Checkout' })
    expect(out.isError).toBe(false)
    expect(JSON.parse(out.text)).toEqual({ ok: true, waitingReason: 'ready to test' })
    expect(getFeatureRow(ctx, featureId)).toMatchObject({ status: 'active', waitingReason: 'ready to test' })
    expect(featureContext(ctx, { featureId }).latestReady).toMatchObject({ scenario: 'Checkout' })
  })

  it('show_panel accepts its four views and refuses the plan and a design, naming the tools that show them', async () => {
    for (const view of ['work', 'review', 'details', 'drive']) {
      expect((await call('show_panel', { view })).isError, view).toBe(false)
    }
    for (const view of ['plan', 'design']) {
      const out = await call('show_panel', { view })
      expect(out.isError, view).toBe(true)
      expect(out.text, view).toMatch(/show_plan.*show_design/)
    }
    for (const view of ['body', 'preview']) {
      expect((await call('show_panel', { view })).isError, view).toBe(true)
    }
    expect(
      listAfter(ctx, featureId, 0)
        .filter((e) => e.type === 'panel.show')
        .map((e) => (e.data as { view: string }).view),
    ).toEqual(['work', 'review', 'details', 'drive'])
  })

  it('wait_for_you sets the waiting reason the context shows', async () => {
    const out = await call('wait_for_you', { why: 'round 2 proposed' })
    expect(JSON.parse(out.text)).toEqual({ ok: true, waitingReason: 'round 2 proposed', waitingKind: 'answer' })
    expect(getFeatureRow(ctx, featureId).waitingReason).toBe('round 2 proposed')
  })

  it('wait_for_you stores the kind of wait beside the reason, and the context shows it', async () => {
    const out = await call('wait_for_you', { why: 'start round 1?', kind: 'plan' })
    expect(JSON.parse(out.text)).toEqual({ ok: true, waitingReason: 'start round 1?', waitingKind: 'plan' })
    expect(featureContext(ctx, { featureId })).toMatchObject({ waitingReason: 'start round 1?', waitingKind: 'plan' })
    const waited = listAfter(ctx, featureId).filter((e) => e.type === 'feature.waiting').at(-1)
    expect(waited?.data).toMatchObject({ why: 'start round 1?', kind: 'plan' })

    expect((await call('wait_for_you', { why: 'x', kind: 'later' })).isError).toBe(true)
  })

})
