import type { Ticket, TicketInput } from '@runcastle/core'
import { newId } from '@runcastle/core'
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
 * - **seq**: assigned globally per feature, continuing after any existing
 *   tickets (`max(existing.seq) + 1`, then +1 per ticket in array order).
 * - **blockedBy**: on input these are 1-based positions within *this batch*
 *   (`TicketInput.blockedBy` = "seq numbers of other tickets in the same
 *   batch"). We resolve each to the referenced ticket's assigned global `seq`
 *   and store it as `number[]`. NOTE: SPEC §3 phrases this as "seq→id"; the
 *   pinned core schema types `Ticket.blockedBy` as `number[]`, so we resolve to
 *   global seq (not id). Recorded in docs/research/CORRECTIONS.md.
 * - An out-of-range or self position throws `InvalidInputError`.
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
  const n = inputs.length

  inputs.forEach((t, i) => {
    for (const pos of t.blockedBy) {
      if (!Number.isInteger(pos) || pos < 1 || pos > n) {
        throw new InvalidInputError(
          `ticket ${i + 1} blockedBy references invalid batch position ${pos} (batch has ${n} ticket(s), positions 1..${n})`,
        )
      }
      if (pos === i + 1) {
        throw new InvalidInputError(`ticket ${i + 1} cannot block on itself`)
      }
    }
  })

  const rows = inputs.map((t, i) => ({
    id: newId('tkt'),
    featureId,
    seq: startSeq + i,
    title: t.title,
    goal: t.goal,
    context: t.context,
    acceptanceCriteria: t.acceptanceCriteria,
    seams: t.seams,
    // batch position -> assigned global seq
    blockedBy: t.blockedBy.map((pos) => startSeq + (pos - 1)),
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
