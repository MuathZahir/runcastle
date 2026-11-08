import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId } from '@runcastle/core'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runs } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp from '../src/mcp/server'
import { resetSentMemoryForTests } from '../src/mcp/sent-memory'
import hooksApp from '../src/routes/hooks'
import { storeTickets, updateTicket } from './helpers/tickets'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

/**
 * Repeat reads send only what the conversation does not already hold
 * (`tools-and-skills-say-less` decisions 1, 2, 16), called over the real `/mcp`
 * and `/api/hooks` routes as a session calls them.
 */

type Doc = { relPath: string; content?: string; absPath?: string; sha?: string; unchanged?: true; note?: string }

describe('repeat feature reads', () => {
  let ctx: AppCtx
  let app: Hono
  let repoPath: string
  let projectId: string
  let featureId: string
  let chatId: string
  let docsDir: string

  beforeEach(async () => {
    resetSentMemoryForTests()
    ctx = await makeTestCtx()
    repoPath = tmpRepo()
    projectId = seedProject(ctx, repoPath).id
    featureId = seedFeature(ctx, projectId, { slug: 'coupons' }).id
    chatId = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: repoPath }).id
    markSessionLive(ctx, chatId)
    docsDir = join(repoPath, 'docs', 'features', 'coupons')
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# Brief\n\ncoupons expire', 'utf8')
    writeFileSync(join(docsDir, 'decisions.md'), '# Decisions\n\n1. hourly', 'utf8')
    writeFileSync(join(docsDir, 'outcome.md'), '# Outcome\n\nnot canonical', 'utf8')
    setRuntimeCtx(ctx)
    app = new Hono()
    app.route('/mcp', mcpApp)
    app.route('/api/hooks', hooksApp)
  })

  afterEach(() => {
    clearRuntimeCtx()
    rmTemp(repoPath)
  })

  async function call(
    headers: Record<string, string>,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    const envelope = (await res.json()) as { result: { isError?: boolean; content: [{ text: string }] } }
    expect(envelope.result.isError, envelope.result.content[0].text).toBeFalsy()
    return JSON.parse(envelope.result.content[0].text) as Record<string, unknown>
  }

  const asChat = () => ({ 'X-Runcastle-Session': chatId })
  const docsOf = async (headers: Record<string, string>, args: Record<string, unknown> = {}) =>
    (await call(headers, 'get_feature_context', args)).docs as Doc[]

  async function sessionStart(sessionId: string, source: string): Promise<void> {
    const res = await app.request('/api/hooks/session-start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, payload: { session_id: `cc-${source}`, hook_event_name: 'SessionStart', source } }),
    })
    expect(res.status).toBe(200)
  }

  it('sends an unchanged doc as a stub on a repeat, a changed one whole, and everything with full', async () => {
    const first = await docsOf(asChat())
    expect(first).toEqual([
      { relPath: 'brief.md', content: '# Brief\n\ncoupons expire' },
      { relPath: 'decisions.md', content: '# Decisions\n\n1. hourly' },
    ])

    writeFileSync(join(docsDir, 'decisions.md'), '# Decisions\n\n1. daily', 'utf8')
    const repeat = await docsOf(asChat())
    expect(repeat[0]).toEqual({
      relPath: 'brief.md',
      absPath: join(docsDir, 'brief.md'),
      sha: expect.stringMatching(/^[0-9a-f]{64}$/),
      unchanged: true,
      note: 'unchanged since this session last received it; read it at absPath or with read_feature_doc if it is not in view',
    })
    expect(repeat[1]).toEqual({ relPath: 'decisions.md', content: '# Decisions\n\n1. daily' })

    expect(await docsOf(asChat(), { full: true })).toEqual([
      { relPath: 'brief.md', content: '# Brief\n\ncoupons expire' },
      { relPath: 'decisions.md', content: '# Decisions\n\n1. daily' },
    ])
  })

  it('forgets what it sent when the conversation loses its context, but not on a resume', async () => {
    await docsOf(asChat())
    await sessionStart(chatId, 'resume')
    expect((await docsOf(asChat())).every((doc) => doc.unchanged)).toBe(true)

    for (const source of ['compact', 'clear', 'startup']) {
      await sessionStart(chatId, source)
      expect((await docsOf(asChat())).every((doc) => doc.content !== undefined), source).toBe(true)
    }
  })

  it('always sends a run caller every doc whole', async () => {
    const runId = newId('run')
    ctx.db.insert(runs).values({ id: runId, featureId, workflow: 'ticket-burner', status: 'running', startedAt: 1 }).run()
    for (let i = 0; i < 2; i++) {
      expect((await docsOf({ 'X-Runcastle-Run': runId })).every((doc) => doc.content !== undefined)).toBe(true)
    }
  })

  it('gives the orchestrator a status view by default and the whole bundle with full', async () => {
    const [done, , failed] = storeTickets(ctx, featureId, [
      { title: 'a', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
      { title: 'b', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
      { title: 'c', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
    ])
    updateTicket(ctx, done.id, { status: 'done' })
    updateTicket(ctx, failed.id, { status: 'failed' })
    const orchestrator = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: repoPath })
    markSessionLive(ctx, orchestrator.id)
    const asOrchestrator = { 'X-Runcastle-Session': orchestrator.id }

    const view = await call(asOrchestrator, 'get_feature_context', { slug: 'coupons' })
    expect(Object.keys(view)).toEqual([
      'slug',
      'title',
      'status',
      'waitingReason',
      'waitingKind',
      'heldBy',
      'humanTypedAt',
      'roundRunning',
      'ticketCounts',
      'latestReady',
      'reviewVerdict',
      'reviewVerdictReason',
      'openFindings',
      'designs',
      'baseBranch',
      'dependsOn',
      'docs',
    ])
    expect(view).toMatchObject({
      slug: 'coupons',
      roundRunning: false,
      ticketCounts: { pending: 1, burning: 0, done: 1, failed: 1, cancelled: 0 },
      reviewVerdict: null,
      openFindings: 0,
      designs: [],
      docs: [
        { relPath: 'brief.md', bytes: 23 },
        { relPath: 'decisions.md', bytes: 22 },
        { relPath: 'outcome.md', bytes: 24 },
      ],
    })
    expect(JSON.stringify(view)).not.toContain('coupons expire')

    const full = await call(asOrchestrator, 'get_feature_context', { slug: 'coupons', full: true })
    expect(full.tickets).toHaveLength(3)
    expect(full.docs).toEqual([
      { relPath: 'brief.md', content: '# Brief\n\ncoupons expire' },
      { relPath: 'decisions.md', content: '# Decisions\n\n1. hourly' },
    ])
  })
})
