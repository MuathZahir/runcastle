import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { projects } from '../src/db/schema'
import { createSessionRow } from '../src/launcher/sessions'
import { emit } from '../src/services/events'
import { declareReady, markHumanMessage, setWaiting } from '../src/services/features'
import { setHandback } from '../src/services/lead-status'
import { setAgentHostForTests } from '../src/threads/host'
import { appendThreadEvent, type AgentHost } from '../src/threads/types'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * you-always-know-what-s-waiting ticket 1: every feature carries its one
 * `need`, worked out on the server, through `feature.list` and `feature.get`.
 */

let ctx: AppCtx
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
let projectId: string
/** Threads whose process the stand-in host says runs. */
const running = new Set<string>()

beforeEach(async () => {
  ctx = await makeTestCtx()
  caller = createCallerFactory(appRouter)(ctx)
  projectId = seedProject(ctx).id
  ctx.db.update(projects).set({ devCommand: 'bun run dev' }).run()
  running.clear()
  // Only `isRunning` is read on these paths; the rest of the host is never reached.
  setAgentHostForTests({ isRunning: (id: string) => running.has(id) } as unknown as AgentHost)
})

afterEach(() => {
  setAgentHostForTests(undefined)
  vi.useRealTimers()
})

async function needs(): Promise<Map<string, unknown>> {
  return new Map((await caller.feature.list({ projectId })).map((f) => [f.slug, f.need]))
}

describe('feature.list and feature.get carry the need', () => {
  it('is null for a feature that waits on nobody, and for a draft', async () => {
    seedFeature(ctx, projectId, { slug: 'quiet' })
    const draft = seedFeature(ctx, projectId, { slug: 'parked', status: 'draft', baseBranch: null })
    setWaiting(ctx, draft.id, 'which model?')
    const all = await needs()
    expect(all.get('quiet')).toBeNull()
    expect(all.get('parked')).toBeNull()
  })

  it('reads the waiting reason and its kind, the same on the list and the feature', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'plan' })
    setWaiting(ctx, f.id, 'start round 1?', 'plan')
    expect((await needs()).get('plan')).toMatchObject({ kind: 'plan', words: 'Plan to approve', held: false })
    expect((await caller.feature.get({ id: f.id })).need).toMatchObject({ kind: 'plan', words: 'Plan to approve' })
  })

  it('reads an open approval ask in a side thread as a permission need', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'asks' })
    setWaiting(ctx, f.id, 'which model?')
    const side = createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' }).id
    running.add(side)
    appendThreadEvent(side, { type: 'prompt', id: 'p1', text: 'push it', source: 'human' })
    appendThreadEvent(side, { type: 'turn_started', source: 'human' })
    appendThreadEvent(side, {
      type: 'ask',
      ask: { kind: 'approval', id: 'ask_1', call: { id: 'c1', kind: 'execute', title: 'git push', status: 'pending' } },
    })
    expect((await caller.feature.get({ id: f.id })).need).toMatchObject({
      kind: 'permission', words: 'Needs permission · git push', threadId: side,
    })
    expect((await needs()).get('asks')).toMatchObject({ kind: 'permission' })

    // An ask whose process is gone holds nothing open.
    running.delete(side)
    expect((await needs()).get('asks')).toMatchObject({ kind: 'answer', words: 'Needs your answer · which model?' })
  })

  it('reads a merge conflict until a landing clears it', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'conflicted' })
    emit(ctx, f.id, { type: 'merge.conflict', message: 'conflict', data: { base: 'main', files: ['a.ts'] } })
    expect((await needs()).get('conflicted')).toMatchObject({ kind: 'conflict', words: 'Merge conflict' })
    emit(ctx, f.id, { type: 'merge.resolved', message: 'resolved' })
    expect((await needs()).get('conflicted')).toBeNull()
  })

  it('reads a declared-ready feature as Ready to test, then Ready to merge once the human drove it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const f = seedFeature(ctx, projectId, { slug: 'ready' })
    declareReady(ctx, f.id, { scenario: 'checkout' })
    expect((await needs()).get('ready')).toMatchObject({ kind: 'test', words: 'Ready to test · checkout' })

    vi.setSystemTime(1_001_000)
    emit(ctx, f.id, { type: 'testdrive.stopped', message: 'review drive stopped', data: { purpose: 'review' } })
    expect((await needs()).get('ready')).toMatchObject({ kind: 'test' })

    vi.setSystemTime(1_002_000)
    emit(ctx, f.id, { type: 'testdrive.stopped', message: 'test drive stopped', data: { purpose: 'human' } })
    expect((await needs()).get('ready')).toMatchObject({ kind: 'merge', words: 'Ready to merge' })
    expect((await caller.feature.get({ id: f.id })).need).toMatchObject({ kind: 'merge' })

    vi.setSystemTime(1_003_000)
    markHumanMessage(ctx, f.id)
    expect((await needs()).get('ready')).toMatchObject({ kind: 'test' })
  })

  it('goes straight to Ready to merge in a project with no drive set up', async () => {
    ctx.db.update(projects).set({ devCommand: null }).run()
    const f = seedFeature(ctx, projectId, { slug: 'nodrive' })
    declareReady(ctx, f.id, { scenario: 'checkout' })
    expect((await needs()).get('nodrive')).toMatchObject({ kind: 'merge' })
  })

  it('holds only an outstanding handback for the orchestrator holding the feature (the-status-tells-the-truth decisions 1, 5)', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'held', heldBy: 'sess_orchestrator' })
    setWaiting(ctx, f.id, 'start round 1?', 'plan')
    expect((await needs()).get('held')).toMatchObject({ kind: 'plan', held: false, words: 'Plan to approve' })
    setWaiting(ctx, f.id, null)
    setHandback(ctx, f.id, 'Plan is ready for your yes.')
    expect((await needs()).get('held')).toMatchObject({ kind: 'handback', held: true, words: 'With the orchestrator · Plan is ready for your yes' })
  })
})
