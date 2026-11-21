import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerStatus } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { workers } from '../src/db/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { planningCarryOn, reconcileStaleSessions, RESTART_CARRY_ON, RESTART_CARRY_ON_PLANNING, wakeCutOffChats } from '../src/launcher/reconcile'
import { createSessionRow, getSessionRow, markSessionLive } from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { setWait } from '../src/services/waits'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
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
    await wakeCutOffChats(ctx, cutOff)

    expect(said(lead)).toHaveLength(1)
    expect(said(orchestrator)).toHaveLength(1)
    expect(said(idle)).toHaveLength(0)
    expect(promptsOf(lead)[1]).toMatchObject({ source: 'runcastle', display: { summary: 'A restart cut off this turn: carrying on' } })
  })

  it('skips a side chat and a shipped feature', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'f' })
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped', status: 'shipped' })
    const side = thread(createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' }))
    const shippedLead = thread(createSessionRow(ctx, { featureId: shipped.id, kind: 'chat', worktreePath: '/wt' }))

    const cutOff: Parameters<typeof wakeCutOffChats>[1][number][] = []
    reconcileStaleSessions(ctx, cutOff)
    await wakeCutOffChats(ctx, cutOff)

    for (const id of [side, shippedLead]) expect(said(id)).toHaveLength(0)
  })

  it('tells a worker still at work to carry on, once, and none that landed, was dropped or failed (burns-become-workers decision 10)', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'workers' })
    const worker = (status: WorkerStatus): string => {
      const row = createSessionRow(ctx, { featureId: f.id, kind: 'worker', worktreePath: '/wt' })
      const now = Date.now()
      ctx.db
        .insert(workers)
        .values({ id: row.id, featureId: f.id, projectId, label: status, purpose: 'p', kind: 'on-its-own', model: 'm', runtime: 'claude-code', startedBy: 'lead', status, engine: 'docker', featureBranch: f.branch, createdAt: now, updatedAt: now })
        .run()
      return thread(row)
    }
    const working = worker('working')
    const queued = worker('queued')
    const done = [worker('landed'), worker('dropped'), worker('failed')]

    const cutOff: Parameters<typeof wakeCutOffChats>[1][number][] = []
    reconcileStaleSessions(ctx, cutOff)
    await wakeCutOffChats(ctx, cutOff)

    expect(said(working)).toHaveLength(1)
    expect(said(queued)).toHaveLength(1)
    for (const id of done) expect(said(id)).toHaveLength(0)
  })
})

/** A restart cuts off a planning run too; it is woken to carry on (a-restart-resumes-planning-runs). */
describe('after a restart, a planning run', () => {
  let repo: string

  beforeEach(async () => {
    // The lifecycle closes the woken run at its turn's end, as an uninterrupted one.
    await host.stopAll('shutdown')
    host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })
    setAgentHostForTests(host)
    repo = mkdtempSync(join(tmpdir(), 'rc-planning-wt-'))
    await simpleGit(repo).init()
  })

  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  const planningRun = (featureId: string, worktreePath = repo) =>
    thread(createSessionRow(ctx, { featureId, kind: 'chat', worktreePath, purpose: 'self-plan' }))
  const wakes = (id: string) => promptsOf(id).filter((p) => p.text.startsWith(RESTART_CARRY_ON_PLANNING))
  const ended = (featureId: string) => listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.self_plan_ended')

  async function restart(): Promise<void> {
    const cutOff: Parameters<typeof wakeCutOffChats>[1][number][] = []
    reconcileStaleSessions(ctx, cutOff)
    await wakeCutOffChats(ctx, cutOff)
  }

  it('is woken once, as runcastle, with no file list when nothing is uncommitted', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'planning' })
    const id = planningRun(f.id)

    await restart()

    expect(wakes(id)).toHaveLength(1)
    expect(wakes(id)[0]).toMatchObject({ text: RESTART_CARRY_ON_PLANNING, source: 'runcastle', display: { summary: 'A restart cut off planning: carrying on' } })
    expect(said(id)).toHaveLength(0)
    expect(listAfter(ctx, f.id, 0).filter((e) => e.type === 'session.restart_carry_on')).toHaveLength(1)
  })

  it('is told the files it left uncommitted in its folder', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'half-written' })
    writeFileSync(join(repo, 'decisions.md'), '# half')
    writeFileSync(join(repo, 'spec.md'), '# half')
    const id = planningRun(f.id)

    await restart()

    expect(wakes(id).map((p) => p.text)).toEqual([planningCarryOn(['decisions.md', 'spec.md'])])
    expect(wakes(id)[0]?.text).toContain('Uncommitted in your folder: decisions.md, spec.md')
  })

  it('is still woken when its folder cannot be read', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'no-folder' })
    const id = planningRun(f.id, join(repo, 'gone'))

    await restart()

    expect(wakes(id).map((p) => p.text)).toEqual([RESTART_CARRY_ON_PLANNING])
  })

  it('ends as an uninterrupted run does when its woken turn ends', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'finishes' })
    const id = planningRun(f.id)
    setWait(ctx, id, 'Start the work?')

    await restart()

    await vi.waitFor(() => expect(ended(f.id)).toHaveLength(1))
    expect(ended(f.id)[0]?.data).toEqual({ sessionId: id, complete: true })
    expect(getSessionRow(ctx, id)?.purpose).toBeUndefined()
  })

  it('that is not woken is closed as stopped short, so its chat stops declining questions', async () => {
    const shipped = seedFeature(ctx, projectId, { slug: 'shipped-planning', status: 'shipped' })
    const id = planningRun(shipped.id)

    await restart()

    expect(wakes(id)).toHaveLength(0)
    expect(ended(shipped.id).map((e) => e.data)).toEqual([{ sessionId: id, complete: false }])
    expect(getSessionRow(ctx, id)?.purpose).toBeUndefined()
  })

  it('that finished before the restart is left alone', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'done-before' })
    const id = thread(createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: repo, purpose: 'self-plan' }), false)

    await restart()

    expect(wakes(id)).toHaveLength(0)
    expect(ended(f.id)).toHaveLength(0)
  })
})
