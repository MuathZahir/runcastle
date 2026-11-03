import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import mcpApp, { featureContext } from '../src/mcp/server'
import designsApp from '../src/routes/designs'
import { recordDesign } from '../src/services/designs'
import { listAfter } from '../src/services/events'
import { needOf } from '../src/services/feature-need'
import { getFeatureRow } from '../src/services/repo'
import { storeTickets } from '../src/services/tickets'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'

/**
 * A feature's designs and its plan (designs-and-the-plan-get-their-own-place):
 * the agent's show_design / show_plan / set_design_state over the real `/mcp`
 * route, and the human's design.* procedures, observed through the record, the
 * thread log, the timeline and what reaches the lead.
 */

let ctx: AppCtx
let repo: string
let feature: Feature
let host: AgentHost

beforeEach(async () => {
  ctx = await makeTestCtx()
  repo = tmpRepo()
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'checkout' })
  setRuntimeCtx(ctx)
  host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  clearRuntimeCtx()
})

const caller = () => createCallerFactory(appRouter)(ctx)

function session(purpose?: 'self-plan'): string {
  const id = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo, ...(purpose ? { purpose } : {}) }).id
  markSessionLive(ctx, id)
  return id
}

/** The tool's answer over the real route, with its error flag. */
async function call(sessionId: string, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> {
  const app = new Hono()
  app.route('/mcp', mcpApp)
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-Runcastle-Session': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const envelope = (await res.json()) as { result: { isError?: boolean; content: [{ text: string }] } }
  return { isError: !!envelope.result.isError, text: envelope.result.content[0].text }
}

const events = (type: string) => listAfter(ctx, feature.id, 0).filter((e) => e.type === type)
const shownIn = (sessionId: string) => readThreadEvents(sessionId).filter((e) => e.type === 'design_shown' || e.type === 'plan_shown')
const list = () => caller().design.list({ featureId: feature.id })

describe('show_design', () => {
  it('records one design per page: showing it again updates it, resets an approval, and posts another card', async () => {
    const chat = session()
    const first = await call(chat, 'show_design', { path: '/preview/cart.html', title: 'Cart', width: 390 })
    expect(JSON.parse(first.text)).toEqual({ recorded: true, state: 'waiting' })
    const [design] = (await list()).designs
    expect(design).toMatchObject({ title: 'Cart', path: '/preview/cart.html', width: 390, state: 'waiting', isNew: true })

    await call(chat, 'set_design_state', { path: '/preview/cart.html', state: 'approved' })
    await caller().design.seen({ designId: design.id })
    expect((await list()).designs[0]).toMatchObject({ state: 'approved', isNew: false })

    await call(chat, 'show_design', { path: '/preview/cart.html', title: 'Cart, with coupons' })
    const designs = (await list()).designs
    expect(designs).toHaveLength(1)
    expect(designs[0]).toMatchObject({ id: design.id, title: 'Cart, with coupons', state: 'waiting', isNew: true })
    expect(designs[0].width).toBeUndefined()
    expect(shownIn(chat)).toMatchObject([
      { type: 'design_shown', designId: design.id },
      { type: 'design_shown', designId: design.id },
    ])
    expect(events('design.shown')).toHaveLength(2)
  })

  it('opens the Design view on the design for a watched chat, and nothing for an unattended run', async () => {
    const watched = session()
    await call(watched, 'show_design', { path: '/preview/cart.html', title: 'Cart', width: 390 })
    expect(events('panel.show').map((e) => e.data)).toEqual([{ view: 'design', path: '/preview/cart.html', width: 390 }])

    const run = session('self-plan')
    await call(run, 'show_design', { path: '/preview/empty.html', title: 'Empty' })
    expect(events('panel.show')).toHaveLength(1)
    expect(shownIn(run)).toHaveLength(1)
    expect((await list()).designs.map((d) => d.title)).toEqual(['Cart', 'Empty'])
  })

  it('keeps its own copy of the picture, served by the designs route, and refuses a picture that is not one', async () => {
    const chat = session()
    writeFileSync(join(repo, 'shot.png'), 'png-bytes')
    writeFileSync(join(repo, 'notes.txt'), 'words')
    const refused = await call(chat, 'show_design', { path: '/preview/cart.html', title: 'Cart', picture: 'notes.txt' })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/not a picture/)
    expect((await list()).designs).toEqual([])

    await call(chat, 'show_design', { path: '/preview/cart.html', title: 'Cart', picture: 'shot.png' })
    const picture = (await list()).designs[0].picture
    expect(picture).toMatch(new RegExp(`^/api/designs/${feature.id}/pictures/[A-Za-z0-9_-]+\\.png$`))
    const app = new Hono()
    app.route('/api/designs', designsApp)
    const res = await app.request(picture!)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(await res.text()).toBe('png-bytes')
    expect((await app.request(`/api/designs/${feature.id}/pictures/..%2Fx.png`)).status).toBe(404)
  })
})

describe('show_plan', () => {
  it('refuses on a feature with no plan, and leaves nothing behind', async () => {
    const chat = session()
    const out = await call(chat, 'show_plan')
    expect(out.isError).toBe(true)
    expect(out.text).toMatch(/no plan yet/)
    expect(shownIn(chat)).toEqual([])
    expect((await list()).plan.isNew).toBe(false)
  })

  it('posts a plan card, makes the plan new to the human until they open it, and opens the Plan view', async () => {
    const docs = join(repo, 'docs', 'features', 'checkout')
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, 'decisions.md'), '# Decisions\n')
    const chat = session()

    expect((await call(chat, 'show_plan')).isError).toBe(false)
    expect(shownIn(chat)).toMatchObject([{ type: 'plan_shown' }])
    expect(events('panel.show').map((e) => e.data)).toEqual([{ view: 'plan' }])
    expect((await list()).plan.isNew).toBe(true)

    await caller().design.planSeen({ featureId: feature.id })
    expect((await list()).plan.isNew).toBe(false)

    await call(session('self-plan'), 'show_plan')
    expect((await list()).plan.isNew).toBe(true)
    expect(events('panel.show')).toHaveLength(1)
  })
})

describe('design.planFigures', () => {
  const ticket = (title: string) => ({ title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] })

  it('counts the numbered decisions, the Check first line, the implementation tickets and the recorded designs', async () => {
    const docs = join(repo, 'docs', 'features', 'checkout')
    mkdirSync(docs, { recursive: true })
    writeFileSync(
      join(docs, 'decisions.md'),
      '# Decisions\n\nCheck first: 17, 6, 3\n\n## 1. One\ntext\n## 2. Two\n## Notes\n## 3. Three\n',
    )
    storeTickets(ctx, feature.id, [ticket('First'), ticket('Second')])
    await call(session(), 'show_design', { path: '/preview/a.html', title: 'A' })

    expect(await caller().design.planFigures({ featureId: feature.id })).toEqual({ decisions: 3, checkFirst: 3, tickets: 2, designs: 1 })
  })

  it('leaves "to check first" at 0 without the line, and tickets null when the agent builds it alone', async () => {
    const docs = join(repo, 'docs', 'features', 'checkout')
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, 'decisions.md'), '# Decisions\n\n## 1. One\n')
    expect(await caller().design.planFigures({ featureId: feature.id })).toEqual({ decisions: 1, checkFirst: 0, tickets: null, designs: 0 })
  })
})

describe('the design need', () => {
  it('shows "Design to approve" from the record while a design waits, and clears once none does', async () => {
    const chat = session()
    expect(needOf(ctx, getFeatureRow(ctx, feature.id))).toBeNull()
    await call(chat, 'show_design', { path: '/preview/a.html', title: 'A' })
    expect(needOf(ctx, getFeatureRow(ctx, feature.id))).toMatchObject({ kind: 'design', words: 'Design to approve' })
    await call(chat, 'set_design_state', { path: '/preview/a.html', state: 'dropped' })
    expect(needOf(ctx, getFeatureRow(ctx, feature.id))).toBeNull()
  })
})

describe('set_design_state', () => {
  it('records a yes in words as the lead’s approval, and a rejection as dropped, which the lead’s context shows', async () => {
    const chat = session()
    await call(chat, 'show_design', { path: '/preview/a.html', title: 'A' })
    await call(chat, 'show_design', { path: 'preview/b.html', title: 'B' })
    await call(chat, 'set_design_state', { path: '/preview/a.html', state: 'approved' })
    await call(chat, 'set_design_state', { path: '/preview/b.html', state: 'dropped' })
    const missing = await call(chat, 'set_design_state', { path: '/preview/c.html', state: 'approved' })
    expect(missing.isError).toBe(true)
    expect(missing.text).toMatch(/no design is recorded at \/preview\/c\.html/)

    expect(featureContext(ctx, { featureId: feature.id }).designs).toEqual([
      { title: 'A', path: '/preview/a.html', state: 'approved', approvedBy: 'lead', opened: false },
      { title: 'B', path: '/preview/b.html', state: 'dropped', approvedBy: null, opened: false },
    ])
  })
})

describe('design.approve', () => {
  /** The feature's main chat, its conversation on record and no process running. */
  function leadChat(): void {
    const row = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo })
    markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
    markSessionEnded(ctx, row.id)
  }
  const delivered = () => events('lead.message_queued').map((e) => (e.data as { text: string }).text)

  it('is quiet while others wait, and tells the lead once, naming every approved design, when the last waiting one is approved', async () => {
    leadChat()
    const a = recordDesign(ctx, feature.id, { path: '/preview/a.html', title: 'Export dialog' })
    const b = recordDesign(ctx, feature.id, { path: '/preview/b.html', title: 'Empty state' })
    const c = recordDesign(ctx, feature.id, { path: '/preview/c.html', title: 'Old idea' })
    await call(session(), 'set_design_state', { path: '/preview/c.html', state: 'dropped' })

    expect(await caller().design.approve({ designId: a.id })).toEqual({ approved: true })
    expect(events('design.approved')).toHaveLength(1)
    expect(delivered()).toEqual([])

    expect(await caller().design.approve({ designId: b.id })).toEqual({ approved: true })
    expect(delivered()).toHaveLength(1)
    expect(delivered()[0]).toMatch(/approved all 2 designs/)
    expect(delivered()[0]).toContain('“Export dialog” (/preview/a.html)')
    expect(delivered()[0]).toContain('“Empty state” (/preview/b.html)')
    expect(delivered()[0]).not.toContain('Old idea')

    // A double click, or a dropped design, sends nothing more.
    expect(await caller().design.approve({ designId: b.id })).toEqual({ approved: false })
    expect(await caller().design.approve({ designId: c.id })).toEqual({ approved: false })
    expect(delivered()).toHaveLength(1)
    expect(events('design.approved')).toHaveLength(2)
    expect(featureContext(ctx, { featureId: feature.id }).designs.map((d) => d.approvedBy)).toEqual(['human', 'human', null])
  })

  it('is cleared by design.seen in the list and in the lead’s context, until the design is shown again', async () => {
    const a = recordDesign(ctx, feature.id, { path: '/preview/a.html', title: 'A' })
    await caller().design.seen({ designId: a.id })
    expect((await list()).designs[0].isNew).toBe(false)
    expect(featureContext(ctx, { featureId: feature.id }).designs[0].opened).toBe(true)
    recordDesign(ctx, feature.id, { path: '/preview/a.html', title: 'A' })
    expect((await list()).designs[0].isNew).toBe(true)
  })
})
