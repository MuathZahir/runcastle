import type { Run, WorkerStatus } from '@runcastle/core'
import { workers } from '../src/db/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { reconcileStaleSessions, RESTART_CARRY_ON, wakeCutOffChats } from '../src/launcher/reconcile'
import { createSessionRow, markSessionLive } from '../src/launcher/sessions'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { appendThreadEvent, type AgentHost } from '../src/threads/types'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * A server restart cuts chats off mid-turn; each lead or orchestrator chat it
 * cut off is woken once to carry on (agents-are-woken-only-when-it-matters
 * decision 24).
 */

let ctx: AppCtx
let projectId: string
let host: AgentHost
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  restoreDataDir()
})

/** A thread whose log the restart cut off mid-turn (or idle, with `midTurn: false`). */
function thread(row: { id: string }, midTurn = true): string {
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  appendThreadEvent(row.id, { type: 'prompt', id: `p-${row.id}`, text: 'go on', source: 'human' })
  appendThreadEvent(row.id, { type: 'process', state: 'running' })
  appendThreadEvent(row.id, { type: 'turn_started' })
  if (!midTurn) appendThreadEvent(row.id, { type: 'turn_ended', reason: 'end_turn' })
  return row.id
}

const said = (id: string) => promptsOf(id).filter((p) => p.text === RESTART_CARRY_ON)

describe('after a restart', () => {
  it('tells each lead and orchestrator chat it cut off mid-turn to carry on, once', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'busy' })
    const lead = thread(createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' }))
    const orchestrator = thread(createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' }))
    const idle = thread(createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' }), false)

    const cutOff: Parameters<typeof wakeCutOffChats>[1][number][] = []
    reconcileStaleSessions(ctx, cutOff)
    expect(cutOff.map((r) => r.id).sort()).toEqual([lead, orchestrator].sort())
    await wakeCutOffChats(ctx, cutOff, [])

    expect(said(lead)).toHaveLength(1)
    expect(said(orchestrator)).toHaveLength(1)
    expect(said(idle)).toHaveLength(0)
    expect(promptsOf(lead)[1]).toMatchObject({ source: 'runcastle', display: { summary: 'A restart cut off this turn: carrying on' } })
  })

  it('skips a side chat, a worker, a self-planning run, a shipped feature and a lead whose round was cut off', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'f' })
    const roundCut = seedFeature(ctx, projectId, { slug: 'round-cut' })
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped', status: 'shipped' })
    const side = thread(createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' }))
    const planning = thread(createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt', purpose: 'self-plan' }))
    const roundLead = thread(createSessionRow(ctx, { featureId: roundCut.id, kind: 'chat', worktreePath: '/wt' }))
    const shippedLead = thread(createSessionRow(ctx, { featureId: shipped.id, kind: 'chat', worktreePath: '/wt' }))

    const cutOff: Parameters<typeof wakeCutOffChats>[1][number][] = []
    reconcileStaleSessions(ctx, cutOff)
    const stale = [{ id: 'run_1', featureId: roundCut.id, workflow: 'ticket-burner' } as Run]
    await wakeCutOffChats(ctx, cutOff, stale)

    for (const id of [side, planning, roundLead, shippedLead]) expect(said(id)).toHaveLength(0)
  })

  it('tells a worker still at work to carry on, once, and none that landed, was dropped or failed (burns-become-workers decision 10)', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'workers' })
    const worker = (status: WorkerStatus): string => {
      const row = createSessionRow(ctx, { featureId: f.id, kind: 'worker', worktreePath: '/wt' })
      const now = Date.now()
      ctx.db
        .insert(workers)
        .values({ id: row.id, featureId: f.id, label: status, purpose: 'p', kind: 'on-its-own', model: 'm', runtime: 'claude-code', startedBy: 'lead', status, engine: 'docker', featureBranch: f.branch, createdAt: now, updatedAt: now })
        .run()
      return thread(row)
    }
    const working = worker('working')
    const queued = worker('queued')
    const done = [worker('landed'), worker('dropped'), worker('failed')]

    const cutOff: Parameters<typeof wakeCutOffChats>[1][number][] = []
    reconcileStaleSessions(ctx, cutOff)
    await wakeCutOffChats(ctx, cutOff, [])

    expect(said(working)).toHaveLength(1)
    expect(said(queued)).toHaveLength(1)
    for (const id of done) expect(said(id)).toHaveLength(0)
  })
})
