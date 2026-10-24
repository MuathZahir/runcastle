import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import { events, features, sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import mcpApp from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { commitDocs } from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject, tmpRepo } from './helpers/fixtures'

// The git process is the boundary: its commit is what stalls in the field.
vi.mock('../src/services/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/git')>()),
  commitDocs: vi.fn(),
}))

/**
 * A pipeline write answers once it is recorded, never after the docs checkpoint
 * behind it. Seen on a headless self-planning run: a planning write
 * timed out on the caller's side while its milestone was already on the
 * timeline, because the handler awaited a git commit before replying.
 */
const ONE_TICKET = { title: 't', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] }

describe('docs checkpoint behind a pipeline write', () => {
  let ctx: AppCtx
  let feature: Feature
  let sessionId: string
  let app: Hono
  let failCommit: (e: Error) => void

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx, tmpRepo())
    feature = seedFeature(ctx, project.id, { slug: 'slow-disk' })
    sessionId = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: project.repoPath,
    }).id
    markSessionLive(ctx, sessionId)
    setRuntimeCtx(ctx)
    app = new Hono()
    app.route('/mcp', mcpApp)
    // A commit that hangs until the test lets it fail.
    vi.mocked(commitDocs).mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          failCommit = reject
        }),
    )
  })

  afterEach(() => {
    clearRuntimeCtx()
    vi.mocked(commitDocs).mockReset()
  })

  /** The tool's own answer, unwrapped from the JSON-RPC envelope. */
  async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'X-Runcastle-Session': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    expect(res.status).toBe(200)
    const envelope = (await res.json()) as { result: { content: [{ text: string }] } }
    return JSON.parse(envelope.result.content[0].text)
  }

  function commitPending(): string[] {
    return listAfter(ctx, feature.id, 0)
      .filter((e) => e.type === 'git.commit_pending')
      .map((e) => e.message)
  }

  it('a checkpoint that fails after the answer still reports itself on the timeline', async () => {
    await call('emit_tickets', { tickets: [ONE_TICKET] })
    expect(commitPending()).toEqual([])

    failCommit(new Error('index.lock exists'))
    await vi.waitFor(() =>
      expect(commitPending()).toEqual(['docs checkpoint failed: index.lock exists']),
    )
  })

  it('a checkpoint that fails after its feature is deleted fails alone, not the server', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      await call('emit_tickets', { tickets: [ONE_TICKET] })
      // deleteFeature's last step: the rows go while the checkpoint is running.
      ctx.db.delete(sessions).where(eq(sessions.featureId, feature.id)).run()
      ctx.db.delete(events).where(eq(events.featureId, feature.id)).run()
      ctx.db.delete(features).where(eq(features.id, feature.id)).run()

      failCommit(new Error('index.lock exists'))
      await new Promise((r) => setTimeout(r, 20))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('emit_tickets answers while the checkpoint commit is still running', async () => {
    const out = await call('emit_tickets', {
      tickets: [{ title: 't', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] }],
    })

    expect(out.stored).toBe(1)
    expect(commitDocs).toHaveBeenCalledTimes(1)
  })
})
