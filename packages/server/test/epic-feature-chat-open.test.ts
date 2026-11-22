import type { Feature, SessionRow } from '@runcastle/core'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import hooksApp from '../src/routes/hooks'
import { AUTOPILOT_RETIRED } from '../src/services/autopilot-upgrade'
import { emit } from '../src/services/events'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * `autopilot-retires` decision 1: no chat is locked. The human writes to any
 * feature's lead and workers, an epic's feature at "Nothing" and one that was
 * on autopilot included, from the app and by typing in the terminal.
 */

let ctx: AppCtx
let host: AgentHost
let restoreDataDir: () => void
let feature: Feature
let lead: SessionRow

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
  setAgentHostForTests(host)
  setRuntimeCtx(ctx)
  const projectId = seedProject(ctx).id
  const epic = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
  markSessionLive(ctx, epic.id, { ccSessionId: `cc-${epic.id}` })
  feature = seedFeature(ctx, projectId, { slug: 'cart', chatId: epic.id, involvement: 'nothing' })
  emit(ctx, feature.id, { type: AUTOPILOT_RETIRED, message: 'was on autopilot', data: { epicId: epic.id } })
  const row = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  lead = getSessionRow(ctx, row.id) as SessionRow
})

afterEach(async () => {
  clearRuntimeCtx()
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  restoreDataDir()
})

describe('an epic’s feature takes the human’s messages', () => {
  it('thread.send reaches its lead and its workers', async () => {
    const worker = createSessionRow(ctx, { featureId: feature.id, kind: 'worker', worktreePath: '/wt' })
    const caller = createCallerFactory(appRouter)(ctx)
    for (const id of [lead.id, worker.id]) {
      await caller.thread.send({ threadId: id, text: 'hello' })
      expect(promptsOf(id).map((p) => p.text).at(-1)).toContain('hello')
    }
  })

  it('the prompt hook lets typing in the lead’s terminal through', async () => {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const res = await app.request('/api/hooks/user-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: lead.id, payload: { hook_event_name: 'UserPromptSubmit', prompt: 'let me do it' } }),
    })
    expect(await res.json()).not.toHaveProperty('decision')
  })
})
