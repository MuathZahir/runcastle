import type { Ticket, TicketInput } from '@runcastle/core'
import { BlockingEdgeError, newId, resolveBatchBlocking } from '@runcastle/core'
import { asc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { tickets } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'

/**
 * Ticket storage. The ideation session emits `TicketInput[]` in one batch via
 * MCP; `storeTickets` assigns each a global `seq` and resolves the batch-local
 * `blockedBy` references (see the note in `storeTickets` and
 * docs/research/CORRECTIONS.md).
 */

type TicketSelect = typeof tickets.$inferSelect

function rowToTicket(row: TicketSelect): Ticket {
  return {
    id: row.id,
    featureId: row.featureId,
    seq: row.seq,
    title: row.title,
    goal: row.goal,
    context: row.context,
    acceptanceCriteria: row.acceptanceCriteria,
    seams: row.seams,
    blockedBy: row.blockedBy,
    status: row.status,
    commits: row.commits,
    error: row.error ?? undefined,
  }
}

/**
 * Delegate to core's IO-free `resolveBatchBlocking`, mapping its
 * transport-agnostic `BlockingEdgeError` onto the service's `InvalidInputError`
 * (so the tRPC layer surfaces it as `BAD_REQUEST`, unchanged).
 */
function resolveBlocking(inputs: TicketInput[], startSeq: number) {
  try {
    return resolveBatchBlocking(inputs, { startSeq })
  } catch (e) {
    if (e instanceof BlockingEdgeError) throw new InvalidInputError(e.message)
    throw e
  }
}

export function listByFeature(ctx: AppCtx, featureId: string): Ticket[] {
  return ctx.db
    .select()
    .from(tickets)
    .where(eq(tickets.featureId, featureId))
    .orderBy(asc(tickets.seq))
    .all()
    .map(rowToTicket)
}

/**
 * Store a batch of tickets for a feature.
 *
 * seq is assigned globally per feature, continuing after any existing tickets
 * (`max(existing.seq) + 1`); the batch-local `blockedBy` positions are resolved
 * to global seqs — and out-of-range/self edges rejected — by core's
 * `resolveBatchBlocking` (see that utility for the seq-vs-id note). An invalid
 * edge surfaces as `InvalidInputError`.
 */
export function storeTickets(
  ctx: AppCtx,
  featureId: string,
  inputs: TicketInput[],
): Ticket[] {
  if (inputs.length === 0) return []

  const existing = ctx.db
    .select({ seq: tickets.seq })
    .from(tickets)
    .where(eq(tickets.featureId, featureId))
    .all()
  const startSeq = existing.reduce((max, r) => Math.max(max, r.seq), 0) + 1

  const resolved = resolveBlocking(inputs, startSeq)

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
    status: 'pending' as const,
    commits: [] as string[],
    error: null,
  }))

  ctx.db.insert(tickets).values(rows).run()
  emit(ctx, featureId, {
    type: 'tickets.stored',
    message: `${rows.length} ticket(s) stored`,
    data: { count: rows.length, seqs: rows.map((r) => r.seq) },
  })

  return rows.map(rowToTicket)
}

export function updateTicket(
  ctx: AppCtx,
  id: string,
  patch: Partial<Pick<Ticket, 'status' | 'commits' | 'error'>>,
): Ticket {
  const current = ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!current) throw new NotFoundError(`ticket ${id} not found`)

  const set: Partial<TicketSelect> = {}
  if (patch.status !== undefined) set.status = patch.status
  if (patch.commits !== undefined) set.commits = patch.commits
  if (patch.error !== undefined) set.error = patch.error

  ctx.db.update(tickets).set(set).where(eq(tickets.id, id)).run()

  emit(ctx, current.featureId, {
    type: 'ticket.updated',
    message: `ticket ${current.seq} → ${patch.status ?? current.status}`,
    ticketId: id,
    data: patch,
  })

  const updated = ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()
  return rowToTicket(updated as TicketSelect)
}
