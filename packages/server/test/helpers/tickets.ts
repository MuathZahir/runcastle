import type { ReviewGateRun, Ticket, TicketInput } from '@runcastle/core'
import { newId, resolveBatchBlocking } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../../src/db/types'
import { tickets } from '../../src/db/schema'
import { emit } from '../../src/services/events'
import { getTicket } from '../../src/services/tickets'

/**
 * Seeds for the FROZEN ticket history. Nothing in `src` writes tickets any more
 * (burns became workers); tests that read old features' tickets need rows to
 * read, and these are the only writers left.
 */

/** Insert a batch of ticket rows for a feature, seq continuing after any existing ones. */
export function storeTickets(
  ctx: AppCtx,
  featureId: string,
  inputs: TicketInput[],
  options: { blockedByAreGlobal?: boolean } = {},
): Ticket[] {
  if (inputs.length === 0) return []
  const existing = ctx.db.select({ seq: tickets.seq }).from(tickets).where(eq(tickets.featureId, featureId)).all()
  const startSeq = existing.reduce((max, r) => Math.max(max, r.seq), 0) + 1
  const resolved = options.blockedByAreGlobal
    ? inputs.map((input, index) => ({ seq: startSeq + index, blockedBy: input.blockedBy }))
    : resolveBatchBlocking(inputs, { startSeq })
  const rows = inputs.map((t, i) => ({
    id: newId('tkt'),
    featureId,
    seq: resolved[i].seq,
    title: t.title,
    goal: t.goal,
    context: t.context,
    acceptanceCriteria: t.acceptanceCriteria,
    seams: t.seams,
    blockedBy: resolved[i].blockedBy,
    kind: t.kind ?? ('implementation' as const),
    passKind: t.passKind ?? ('review' as const),
    reviewedCommit: null,
    reviewMode: null,
    reviewVerdict: null,
    reviewVerdictReason: null,
    reviewGateRun: null,
    completedAt: null,
    model: t.model?.trim() || null,
    status: 'pending' as const,
    commits: [] as string[],
    error: null,
    attemptBranch: null,
    conflictFiles: null,
    digest: null,
    originFindingId: t.originFindingId ?? null,
    tokens: null,
    tokenBreakdown: null,
  }))
  ctx.db.insert(tickets).values(rows).run()
  emit(ctx, featureId, {
    type: 'tickets.stored',
    message: `${rows.length} ticket(s) stored`,
    data: { count: rows.length, seqs: rows.map((r) => r.seq) },
  })
  return rows.map((r) => getTicket(ctx, r.id))
}

/** Patch a ticket row the way the retired burn did. */
export function updateTicket(
  ctx: AppCtx,
  id: string,
  patch: Partial<Pick<Ticket, 'status' | 'commits' | 'digest'>> & {
    error?: string | null
    attemptBranch?: string | null
    conflictFiles?: string[] | null
    reviewedCommit?: string | null
    reviewMode?: 'drive' | 'gates' | null
    reviewVerdict?: 'verified' | 'unverified' | null
    reviewVerdictReason?: string | null
    reviewGateRun?: ReviewGateRun | null
  },
): Ticket {
  const { status, ...rest } = patch
  const set: Partial<typeof tickets.$inferInsert> = { ...rest }
  if (status !== undefined) {
    set.status = status
    set.completedAt = ['done', 'failed', 'cancelled'].includes(status) ? Date.now() : null
  }
  ctx.db.update(tickets).set(set).where(eq(tickets.id, id)).run()
  return getTicket(ctx, id)
}
