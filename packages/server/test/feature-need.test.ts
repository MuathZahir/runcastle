import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { eq } from 'drizzle-orm'
import { features, projects, workers } from '../src/db/schema'
import { needFacts } from '../src/services/feature-need'
import { getFeatureRow } from '../src/services/repo'
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

  it('holds every need but the feature’s own questions for the chat that owns it (every-feature-has-one-owner decision 16)', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'held', heldBy: 'sess_orchestrator' })
    setWaiting(ctx, f.id, 'start round 1?', 'plan')
    expect((await needs()).get('held')).toMatchObject({ kind: 'plan', held: true, words: 'With sess_orchestrator · Plan to approve' })
    setWaiting(ctx, f.id, null)
    setHandback(ctx, f.id, 'Plan is ready for your yes.')
    expect((await needs()).get('held')).toMatchObject({ kind: 'handback', held: true, words: 'With sess_orchestrator · Plan is ready for your yes' })
  })

  /** An orchestrator chat named "Notes triage" whose last turn showed `featureId`'s plan and ended on `words`. */
  function chatThatShowed(featureId: string, words: string): string {
    const id = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' }).id
    appendThreadEvent(id, { type: 'title', title: 'Notes triage', renamed: true })
    appendThreadEvent(id, { type: 'prompt', id: 'p', text: 'run it for me', source: 'human' })
    appendThreadEvent(id, { type: 'turn_started' })
    appendThreadEvent(id, { type: 'plan_shown', featureId })
    appendThreadEvent(id, { type: 'agent_text', messageId: 'm', text: words })
    appendThreadEvent(id, { type: 'turn_ended', reason: 'end_turn' })
    return id
  }

  it('reads With <Chat> · asking you while the owner chat asks about it, and only that feature (decision 17)', async () => {
    const asked = seedFeature(ctx, projectId, { slug: 'asked' })
    const other = seedFeature(ctx, projectId, { slug: 'other' })
    const chat = chatThatShowed(asked.id, 'Does this plan look right?')
    for (const f of [asked, other]) {
      ctx.db.update(features).set({ heldBy: chat, chatId: chat }).where(eq(features.id, f.id)).run()
      setHandback(ctx, f.id, 'Plan is ready for your yes.')
    }
    const all = await needs()
    expect(all.get('asked')).toMatchObject({ kind: 'handback', held: true, words: 'With Notes triage · asking you' })
    expect(all.get('other')).toMatchObject({ kind: 'handback', held: true, words: 'With Notes triage · Plan is ready for your yes' })
  })

  it('reads a human-owned feature whose lead asks its chat as Asking <Chat> · its line, held (decision 20)', async () => {
    const f = seedFeature(ctx, projectId, { slug: 'mine' })
    const chat = chatThatShowed('elsewhere', 'Done.')
    ctx.db.update(features).set({ chatId: chat }).where(eq(features.id, f.id)).run()
    setHandback(ctx, f.id, 'Should the notes feature own the inbox?')
    expect((await caller.feature.get({ id: f.id })).need).toMatchObject({
      kind: 'handback', held: true, words: 'Asking Notes triage · Should the notes feature own the inbox?',
    })
  })
})

/** triage-batch decision 13: workers working or queued count as work in the need's facts. */
describe('needFacts reads workers at work', () => {
  function seedWorker(featureId: string, status: 'working' | 'queued' | 'handed-back'): void {
    const row = createSessionRow(ctx, { featureId, kind: 'worker', worktreePath: '/wt' })
    const now = Date.now()
    ctx.db
      .insert(workers)
      .values({
        id: row.id, featureId, projectId, label: 'Add laps', purpose: 'p', kind: 'on-its-own', model: 'm', runtime: 'claude-code',
        startedBy: 'lead', status, engine: 'docker', featureBranch: 'feature/x', createdAt: now, updatedAt: now,
      })
      .run()
  }

  it('is true while a worker works or waits to start, false once it handed back', () => {
    const f = seedFeature(ctx, projectId, { slug: 'busy' })
    const facts = () => needFacts(ctx, getFeatureRow(ctx, f.id))
    expect(facts().workersAtWork).toBe(false)
    seedWorker(f.id, 'handed-back')
    expect(facts().workersAtWork).toBe(false)
    seedWorker(f.id, 'queued')
    expect(facts().workersAtWork).toBe(true)
  })
})
