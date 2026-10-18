import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newId, type TokenUsage, type WorkflowCtx, type WorkflowDef } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessions, tickets } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { emit, listAfter } from '../src/services/events'
import { getFeatureFull } from '../src/services/features'
import { listRounds } from '../src/services/runs'
import { storeTickets } from '../src/services/tickets'
import { addTicketTokens, refreshSessionTokens } from '../src/services/usage'
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
  let dir: string
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'building' }).id
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
      expect(refreshSessionTokens(ctx, lead.id, { lazy: true })).toBe(100)

      utimesSync(lead.path, new Date(counted + 60_000), new Date(counted + 60_000))
      expect(refreshSessionTokens(ctx, lead.id, { lazy: true })).toBe(120)
    })
  })

  describe('the burner’s harvest after a ticket attempt', () => {
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
})
