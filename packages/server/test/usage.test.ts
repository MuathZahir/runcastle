import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newId, type TokenUsage, type WorkflowCtx, type WorkflowDef } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { events, sessions, tickets } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { emit, listAfter } from '../src/services/events'
import { getFeatureFull } from '../src/services/features'
import { listRounds } from '../src/services/runs'
import { storeTickets } from '../src/services/tickets'
import { markAwaitingInput, setThreadPurpose } from '../src/launcher/sessions'
import { getSessionRow } from '../src/launcher/sessions'
import { clearEndedErrand } from '../src/services/resolved-merge'
import { addTicketTokens, countConversation, recountAllSessions, refreshSessionTokens } from '../src/services/usage'
import { harvestTicketTokens } from '../src/workflows/ticket-burner'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * Token telemetry at the server seams (`the-feature-lead-runs-rounds`
 * decisions 3 and 25): a session's tokens summed from its transcript and a
 * ticket's from its workers' — recorded in the database, never read back out.
 */

/** One Claude Code assistant line with `total` tokens, all of them output. */
const ccLine = (id: string, at: number, output: number): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(at).toISOString(),
    message: {
      id,
      role: 'assistant',
      usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output },
    },
  })

const landingBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(wctx: WorkflowCtx) {
    for (const t of wctx.tickets) wctx.updateTicket(t.id, { status: 'done', commits: ['abc'] })
    return { status: 'succeeded', summary: 'all landed' }
  },
}

describe('token telemetry', () => {
  let ctx: AppCtx
  let featureId: string
  let projectId: string
  let dir: string
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    featureId = seedFeature(ctx, projectId, {}).id
    dir = mkdtempSync(join(tmpdir(), 'rc-usage-'))
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', landingBurner)
  })

  afterEach(() => {
    rmTemp(dir)
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  /** A chat (lead) session whose transcript is `lines`, written at `<dir>/<name>.jsonl`. */
  function seedLead(lines: string[], name = 'lead'): { id: string; path: string } {
    const path = join(dir, `${name}.jsonl`)
    writeFileSync(path, `${lines.join('\n')}\n`)
    const id = newId('sess')
    ctx.db
      .insert(sessions)
      .values({ id, featureId, kind: 'chat', transcriptPath: path, status: 'live', worktreePath: dir })
      .run()
    return { id, path }
  }

  const sessionRow = (id: string) => ctx.db.select().from(sessions).where(eq(sessions.id, id)).get()

  describe('refreshSessionTokens', () => {
    it('sums the transcript and its subagent transcripts into sessions.tokens and emits', () => {
      const lead = seedLead([ccLine('m1', 1, 100), ccLine('m1', 2, 100), ccLine('m2', 3, 50)])
      mkdirSync(join(dir, 'lead', 'subagents'), { recursive: true })
      writeFileSync(join(dir, 'lead', 'subagents', 'agent-a.jsonl'), `${ccLine('s1', 4, 7)}\n`)

      expect(refreshSessionTokens(ctx, lead.id)).toBe(157)
      expect(sessionRow(lead.id)).toMatchObject({
        tokens: 157,
        tokenBreakdown: { input: 0, cacheCreation: 0, cacheRead: 0, output: 157 },
      })
      const counted = listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.tokens_counted')
      expect(counted).toHaveLength(1)
    })

    it('leaves a session whose transcript is gone uncounted', () => {
      const id = newId('sess')
      ctx.db
        .insert(sessions)
        .values({ id, featureId, kind: 'chat', transcriptPath: join(dir, 'gone.jsonl'), status: 'live', worktreePath: dir })
        .run()
      expect(refreshSessionTokens(ctx, id)).toBeNull()
      expect(sessionRow(id)?.tokens).toBeNull()
    })

    it('on a lazy read, re-sums only a transcript that has grown since the last count', () => {
      const lead = seedLead([ccLine('m1', 1, 100)])
      refreshSessionTokens(ctx, lead.id)
      writeFileSync(lead.path, `${[ccLine('m1', 1, 100), ccLine('m2', 2, 20)].join('\n')}\n`)
      const counted = sessionRow(lead.id)?.tokenBreakdown?.countedAt ?? 0
      utimesSync(lead.path, new Date(counted + 1000), new Date(counted + 1000))
      expect(refreshSessionTokens(ctx, lead.id, { mode: 'lazy' })).toBe(100)

      utimesSync(lead.path, new Date(counted + 60_000), new Date(counted + 60_000))
      expect(refreshSessionTokens(ctx, lead.id, { mode: 'lazy' })).toBe(120)
    })
  })

  describe('the worker’s harvest after a ticket attempt', () => {
    /** The slice of the run's WorkflowCtx the harvest touches, wired to the real services. */
    const harvestCtx = (): WorkflowCtx =>
      ({
        emitEvent: (e: { type: string; message: string; ticketId?: string; data?: unknown }) =>
          emit(ctx, featureId, e),
        addTicketTokens: (id: string, usage: TokenUsage, sessionIds: string[]) =>
          addTicketTokens(ctx, id, usage, sessionIds),
      }) as unknown as WorkflowCtx

    const ticketRow = (id: string) => ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()
    const seedTicket = () =>
      storeTickets(ctx, featureId, [
        { title: 'Add the form', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] },
      ])[0]

    it('sums every iteration’s whole transcript — not the last-message snapshot — and accumulates across attempts', () => {
      const t = seedTicket()
      const first = join(dir, 'iter-1.jsonl')
      writeFileSync(first, `${[ccLine('m1', 1, 100), ccLine('m1', 2, 100), ccLine('m2', 3, 50)].join('\n')}\n`)
      mkdirSync(join(dir, 'iter-1', 'subagents'), { recursive: true })
      writeFileSync(join(dir, 'iter-1', 'subagents', 'agent-x.jsonl'), `${ccLine('s1', 4, 5)}\n`)
      const second = join(dir, 'iter-2.jsonl')
      writeFileSync(second, `${ccLine('m3', 5, 45)}\n`)
      const snapshot = { inputTokens: 1, cacheCreationInputTokens: 1, cacheReadInputTokens: 1, outputTokens: 1 }

      harvestTicketTokens(
        harvestCtx(),
        t,
        [
          { sessionId: 'cc-1', sessionFilePath: first, usage: snapshot },
          { sessionId: 'cc-2', sessionFilePath: second, usage: snapshot },
        ],
        'claude-code',
      )
      expect(ticketRow(t.id)).toMatchObject({
        tokens: 200,
        tokenBreakdown: { input: 0, cacheCreation: 0, cacheRead: 0, output: 200, sessionIds: ['cc-1', 'cc-2'] },
      })

      // A retry attempt adds to what the ticket already spent.
      harvestTicketTokens(harvestCtx(), t, [{ sessionId: 'cc-3', sessionFilePath: second }], 'claude-code')
      expect(ticketRow(t.id)?.tokens).toBe(245)
      expect(ticketRow(t.id)?.tokenBreakdown?.sessionIds).toEqual(['cc-1', 'cc-2', 'cc-3'])
    })

    it('leaves tokens null and reports it when no transcript can be read', () => {
      const t = seedTicket()
      expect(() =>
        harvestTicketTokens(
          harvestCtx(),
          t,
          [{ sessionId: 'cc-1', sessionFilePath: join(dir, 'gone.jsonl') }, {}],
          'claude-code',
        ),
      ).not.toThrow()
      expect(ticketRow(t.id)?.tokens).toBeNull()
      const unreadable = listAfter(ctx, featureId, 0).filter((e) => e.type === 'ticket.tokens_unreadable')
      expect(unreadable).toHaveLength(1)
      expect(unreadable[0].ticketId).toBe(t.id)
    })
  })

  // Decision 25: recorded as durable telemetry, never read back out.
  it('no read exposes a token figure, while reading still records the lead’s', async () => {
    const [t] = storeTickets(ctx, featureId, [
      { title: 'Add the form', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] },
    ])
    const { done } = await startRun(ctx, featureId, 'ticket-burner', {
      ticketIds: [t.id],
      roundGates: async () => ({ status: 'none_configured' }),
    })
    await done
    ctx.db.update(tickets).set({ tokens: 1000 }).where(eq(tickets.id, t.id)).run()
    const lead = seedLead([ccLine('m1', 1, 300)])

    const full = getFeatureFull(ctx, featureId)
    expect(JSON.stringify(full)).not.toMatch(/"tokens(Total)?"/)
    expect(JSON.stringify(listRounds(ctx, featureId))).not.toMatch(/"tokens"/)
    expect(sessionRow(lead.id)?.tokens).toBe(300)
  })

  it('a returning round refreshes the lead session’s tokens', async () => {
    const lead = seedLead([ccLine('m1', 1, 42)])
    const [t] = storeTickets(ctx, featureId, [
      { title: 'Add the form', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] },
    ])
    const { done } = await startRun(ctx, featureId, 'ticket-burner', {
      ticketIds: [t.id],
      roundGates: async () => ({ status: 'none_configured' }),
    })
    await done
    expect(sessionRow(lead.id)?.tokens).toBe(42)
  })

  describe('a conversation counted once (honest-token-counts)', () => {
    /** A row of the conversation at `path`, created at `createdAt`. */
    function seedRow(path: string, createdAt: number, extra: Partial<typeof sessions.$inferInsert> = {}): string {
      const id = newId('sess')
      ctx.db
        .insert(sessions)
        .values({ id, featureId, kind: 'chat', transcriptPath: path, status: 'ended', worktreePath: dir, createdAt, ...extra })
        .run()
      return id
    }
    /** A launch record at `ts`. */
    function launch(sessionId: string, ts: number, type: string, purpose?: string | null): void {
      ctx.db
        .insert(events)
        .values({ projectId, featureId, ts, type, message: 'm', data: { sessionId, ...(purpose !== undefined ? { purpose } : {}) } })
        .run()
    }
    const write = (path: string, lines: string[]) => writeFileSync(path, `${lines.join('\n')}\n`)

    it('files each message under the launch that wrote it, so the rows sum to the transcript', () => {
      const path = join(dir, 'conv.jsonl')
      write(path, [ccLine('m1', 2000, 10), ccLine('m2', 6000, 20), ccLine('m3', 9000, 40)])
      const plan = seedRow(path, 1000, { purpose: 'self-plan' })
      const chat = seedRow(path, 5000)
      launch(plan, 1000, 'session.launching', 'self-plan')
      launch(chat, 5000, 'session.launching')
      launch(chat, 8000, 'session.purpose_set', 'resolve-conflict')

      expect(countConversation(ctx, path)).toBe('counted')
      expect(sessionRow(plan)).toMatchObject({
        tokens: 10,
        tokenBreakdown: { output: 10, byPurpose: { 'self-plan': { output: 10 } }, conversationTotal: 70 },
      })
      expect(sessionRow(chat)).toMatchObject({
        tokens: 60,
        tokenBreakdown: { output: 60, byPurpose: { none: { output: 20 }, 'resolve-conflict': { output: 40 } } },
      })
    })

    it('ends a planning errand at its recorded end, for rows from before purpose changes were recorded', () => {
      const path = join(dir, 'planned.jsonl')
      write(path, [ccLine('m1', 2000, 10), ccLine('m2', 4000, 5)])
      const id = seedRow(path, 1000)
      launch(id, 1000, 'session.launching', 'self-plan')
      launch(id, 3000, 'session.self_plan_ended')
      countConversation(ctx, path)
      expect(sessionRow(id)?.tokenBreakdown?.byPurpose).toMatchObject({ 'self-plan': { output: 10 }, none: { output: 5 } })
    })

    it('never lowers a figure when the transcript is cut short or gone', () => {
      const path = join(dir, 'cut.jsonl')
      write(path, [ccLine('m1', 2000, 10), ccLine('m2', 3000, 20)])
      const id = seedRow(path, 1000)
      countConversation(ctx, path)
      write(path, [ccLine('m2', 3000, 20)])
      expect(countConversation(ctx, path)).toBe('shrunk')
      expect(sessionRow(id)?.tokens).toBe(30)
      rmTemp(path)
      expect(refreshSessionTokens(ctx, id)).toBe(30)
    })

    it('recounts old duplicated rows once, and collapses a conversation whose transcript is gone', async () => {
      const kept = join(dir, 'kept.jsonl')
      write(kept, [ccLine('m1', 2000, 10), ccLine('m2', 6000, 20)])
      const a = seedRow(kept, 1000, { tokens: 30 })
      const b = seedRow(kept, 5000, { tokens: 30 })
      const gone = join(dir, 'gone.jsonl')
      const split = (output: number) => ({ input: 0, cacheCreation: 0, cacheRead: 0, output })
      const g1 = seedRow(gone, 1000, { tokens: 500, tokenBreakdown: split(500) })
      const g2 = seedRow(gone, 2000, { tokens: 400, tokenBreakdown: split(400) })

      expect(await recountAllSessions(ctx)).toEqual({ recounted: 1, collapsed: 1 })
      expect([sessionRow(a)?.tokens, sessionRow(b)?.tokens]).toEqual([10, 20])
      expect(sessionRow(g1)).toMatchObject({ tokens: 0, tokenBreakdown: { recounted: false } })
      // The newest row takes the largest figure with the split that goes with it.
      expect(sessionRow(g2)).toMatchObject({ tokens: 500, tokenBreakdown: { output: 500, recounted: false } })
      expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.tokens_counted' && (e.data as { sessionId?: string }).sessionId === g1)).toHaveLength(1)
      // Self-marking: a second boot finds nothing to do.
      expect(await recountAllSessions(ctx)).toEqual({ recounted: 0, collapsed: 0 })
    })

    it('leaves a conversation it already counted honest when its transcript later goes', async () => {
      const path = join(dir, 'later-gone.jsonl')
      write(path, [ccLine('m1', 2000, 10)])
      const counted = seedRow(path, 1000)
      countConversation(ctx, path)
      const fresh = seedRow(path, 5000)
      rmTemp(path)
      await recountAllSessions(ctx)
      expect(sessionRow(counted)).toMatchObject({ tokens: 10, tokenBreakdown: { conversationTotal: 10, recounted: true } })
      expect(sessionRow(fresh)).toMatchObject({ tokens: null, tokenBreakdown: { recounted: false } })
    })

    it('files a non-chat session under the purpose it was created with', () => {
      const path = join(dir, 'scenario.jsonl')
      write(path, [ccLine('m1', 2000, 9)])
      const id = seedRow(path, 1000, { kind: 'scenario', purpose: 'scenario-setup' })
      launch(id, 1000, 'session.launching')
      countConversation(ctx, path)
      expect(sessionRow(id)?.tokenBreakdown?.byPurpose).toEqual({ 'scenario-setup': expect.objectContaining({ output: 9 }) })
    })

    it('counts a session with no feature when its turn ends', () => {
      const path = join(dir, 'orchestrator.jsonl')
      write(path, [ccLine('m1', 2000, 77)])
      const id = newId('sess')
      ctx.db
        .insert(sessions)
        .values({ id, projectId, kind: 'project', transcriptPath: path, status: 'live', worktreePath: dir, createdAt: 1000 })
        .run()
      markAwaitingInput(ctx, id)
      expect(sessionRow(id)?.tokens).toBe(77)
    })
  })

  describe('an errand belongs to its launch (honest-token-counts decisions 7, 12)', () => {
    function seedChat(purpose: 'resolve-conflict' | 'lead-wake'): string {
      const id = newId('sess')
      ctx.db.insert(sessions).values({ id, featureId, kind: 'chat', status: 'ended', worktreePath: dir, purpose }).run()
      return id
    }

    it('records every change of errand on the timeline', () => {
      const id = seedChat('lead-wake')
      setThreadPurpose(ctx, id, null)
      setThreadPurpose(ctx, id, null)
      const set = listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.purpose_set')
      expect(set).toHaveLength(1)
      expect(set[0]?.data).toMatchObject({ sessionId: id, purpose: null })
    })

    it('clears a retired errand, and a merge conflict that no longer stands, before the next launch', () => {
      for (const purpose of ['lead-wake', 'resolve-conflict'] as const) {
        const id = seedChat(purpose)
        const row = getSessionRow(ctx, id)
        if (!row) throw new Error('no row')
        expect(clearEndedErrand(ctx, row).purpose).toBeUndefined()
        expect(sessionRow(id)?.purpose).toBeNull()
      }
    })

    it('keeps resolve-conflict while the conflict stands', () => {
      const id = seedChat('resolve-conflict')
      emit(ctx, featureId, {
        type: 'merge.conflict',
        message: 'conflict',
        data: { base: 'main', files: ['a.ts'] },
      })
      const row = getSessionRow(ctx, id)
      if (!row) throw new Error('no row')
      expect(clearEndedErrand(ctx, row).purpose).toBe('resolve-conflict')
    })
  })
})
