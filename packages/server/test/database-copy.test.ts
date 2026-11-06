import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newId } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushSubscriptions, runs, sessions } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import {
  COPIED_WHILE_RUNNING,
  DATABASE_IS_COPY_ENV,
  detachCopiedDatabase,
  detachCopyOnce,
  detachedMarkerPath,
  mayStartInBackground,
} from '../src/services/database-copy'
import { emit, listAfter } from '../src/services/events'
import { deliverToLead, LEAD_MESSAGE_NOT_SENT } from '../src/services/lead-delivery'
import { notifyOrchestrator, ORCHESTRATOR_GATHER_MS } from '../src/services/orchestrator-notify'
import { getRunRow } from '../src/services/repo'
import { getTicket, storeTickets, updateTicket } from '../src/services/tickets'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import type { AgentHost } from '../src/threads/types'
import { withTempDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * A test drive of runcastle boots on a copy of the live database
 * (drives-never-touch-real-conversations): the copy is cut loose from the live
 * install at its first boot, and background messages never start an agent the
 * driver has not started.
 */

const COPY = { [DATABASE_IS_COPY_ENV]: '1' }

let ctx: AppCtx
let projectId: string
let featureId: string
let restoreDataDir: () => void

beforeEach(async () => {
  restoreDataDir = withTempDataDir()
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  featureId = seedFeature(ctx, projectId).id
})

afterEach(() => {
  delete process.env[DATABASE_IS_COPY_ENV]
  restoreDataDir()
})

function run(status: 'running' | 'succeeded'): string {
  const id = newId('run')
  ctx.db
    .insert(runs)
    .values({ id, featureId, workflow: 'ticket-burner', status, startedAt: 1, endedAt: status === 'running' ? null : 2, summary: null })
    .run()
  return id
}

/** A session with a conversation on record, as the live install left it. */
function conversation(kind: 'chat' | 'project' = 'chat'): string {
  const row = createSessionRow(ctx, kind === 'chat' ? { featureId, kind, worktreePath: '/wt' } : { projectId, kind, worktreePath: '/wt' })
  markSessionLive(ctx, row.id, { ccSessionId: `cc-${row.id}` })
  ctx.db.update(sessions).set({ transcriptPath: `/transcripts/${row.id}.jsonl` }).where(eq(sessions.id, row.id)).run()
  markSessionEnded(ctx, row.id)
  return row.id
}

describe('detachCopiedDatabase', () => {
  it('cuts conversations, running runs, burning tickets and phone subscriptions loose, and keeps the rest', () => {
    const chat = conversation()
    const running = run('running')
    const finished = run('succeeded')
    const [burning, done] = storeTickets(ctx, featureId, [
      { title: 'burning', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
      { title: 'done', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: [], blockedBy: [] },
    ])
    updateTicket(ctx, burning.id, { status: 'burning' })
    updateTicket(ctx, done.id, { status: 'done', commits: ['abc'] })
    ctx.db.insert(pushSubscriptions).values({ endpoint: 'https://push/phone', p256dh: 'k', auth: 'a', createdAt: 1 }).run()
    const eventsBefore = listAfter(ctx, featureId, 0).length

    expect(detachCopiedDatabase(ctx, 99)).toEqual({ conversations: 1, runs: 1, tickets: 1, pushSubscriptions: 1 })

    const row = getSessionRow(ctx, chat)
    expect(row?.ccSessionId ?? null).toBeNull()
    expect(row?.transcriptPath).toBe(`/transcripts/${chat}.jsonl`)
    expect(getRunRow(ctx, running)).toMatchObject({ status: 'failed', endedAt: 99, summary: COPIED_WHILE_RUNNING })
    expect(getRunRow(ctx, finished)).toMatchObject({ status: 'succeeded', endedAt: 2 })
    expect(getTicket(ctx, burning.id)).toMatchObject({ status: 'failed', error: COPIED_WHILE_RUNNING })
    expect(getTicket(ctx, done.id).status).toBe('done')
    expect(ctx.db.select().from(pushSubscriptions).all()).toEqual([])
    // Quiet: nothing for a lead or a holder to hear.
    expect(listAfter(ctx, featureId, 0)).toHaveLength(eventsBefore)
  })
})

describe('detachCopyOnce', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-copy-'))
  })
  afterEach(() => rmTemp(dir))

  it('does nothing on a live install', () => {
    const chat = conversation()
    expect(detachCopyOnce(ctx, join(dir, 'runcastle.db'), {})).toBeNull()
    expect(getSessionRow(ctx, chat)?.ccSessionId).toBe(`cc-${chat}`)
  })

  it('detaches a copy at its first boot only, so a restart keeps the drive’s own conversations', () => {
    const db = join(dir, 'runcastle.db')
    conversation()
    expect(detachCopyOnce(ctx, db, COPY)?.conversations).toBe(1)
    expect(existsSync(detachedMarkerPath(db))).toBe(true)

    const driveBorn = conversation()
    expect(detachCopyOnce(ctx, db, COPY)).toBeNull()
    expect(getSessionRow(ctx, driveBorn)?.ccSessionId).toBe(`cc-${driveBorn}`)
  })
})

describe('mayStartInBackground', () => {
  it('is always true on a live install, and on a copy only for a conversation begun there', () => {
    const copied = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt' })
    expect(mayStartInBackground(copied, {})).toBe(true)
    expect(mayStartInBackground(copied, COPY)).toBe(false)
    expect(mayStartInBackground(null, COPY)).toBe(false)
    expect(mayStartInBackground({ ...copied, ccSessionId: 'cc-drive' }, COPY)).toBe(true)
  })
})

describe('background messages on a copy', () => {
  let fake: FakeAcp
  let host: AgentHost

  beforeEach(() => {
    setRuntimeCtx(ctx)
    fake = createFakeAcp()
    host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })
    setAgentHostForTests(host)
    process.env[DATABASE_IS_COPY_ENV] = '1'
  })

  afterEach(async () => {
    await host.stopAll('shutdown')
    setAgentHostForTests(undefined)
    clearRuntimeCtx()
    vi.restoreAllMocks()
  })

  const feature = () => seedFeature(ctx, projectId, { slug: `copy-${newId('x').slice(-6)}` })

  it('drops a round-end wake to a lead the drive has not started, and says so', async () => {
    const f = feature()
    const copied = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' })
    markSessionEnded(ctx, copied.id)

    await deliverToLead(ctx, f, { text: '[runcastle] Round 1 returned', source: 'runcastle', background: true })

    expect(fake.processes).toHaveLength(0)
    expect(promptsOf(copied.id)).toEqual([])
    const types = listAfter(ctx, f.id, 0).map((e) => e.type)
    expect(types).toContain(LEAD_MESSAGE_NOT_SENT)
    expect(types).not.toContain('lead.message_queued')
  })

  it('still wakes a lead whose conversation began in the drive', async () => {
    const f = feature()
    const chat = createSessionRow(ctx, { featureId: f.id, kind: 'chat', worktreePath: '/wt' })
    markSessionLive(ctx, chat.id, { ccSessionId: `cc-${chat.id}` })
    markSessionEnded(ctx, chat.id)

    await deliverToLead(ctx, f, { text: '[runcastle] Round 1 returned', source: 'runcastle', background: true })

    expect(listAfter(ctx, f.id, 0).map((e) => e.type)).toContain('lead.message_queued')
  })

  it('lets a click the driver made start the lead', async () => {
    const f = feature()
    await deliverToLead(ctx, f, { text: '[runcastle] The human pressed Stop.', source: 'runcastle' })
    // It goes for the chat (this fixture cannot open a fresh one, so the try is
    // recorded as a failed wake); it is not held back as background news.
    const types = listAfter(ctx, f.id, 0).map((e) => e.type)
    expect(types).not.toContain(LEAD_MESSAGE_NOT_SENT)
    expect(types.some((t) => t === 'lead.message_queued' || t === 'lead.wake_failed')).toBe(true)
  })

  it('tells no holder the drive has not started', async () => {
    const holder = createSessionRow(ctx, { projectId, kind: 'project', worktreePath: '/wt' })
    markSessionEnded(ctx, holder.id)
    const f = seedFeature(ctx, projectId, { slug: 'held-copy', heldBy: holder.id })
    const event = emit(ctx, f.id, { type: 'feature.ready_declared', message: 'ready' })

    notifyOrchestrator(ctx, event.id)
    await new Promise((r) => setTimeout(r, ORCHESTRATOR_GATHER_MS + 50))

    expect(promptsOf(holder.id)).toEqual([])
    expect(fake.processes).toHaveLength(0)
  })
})
