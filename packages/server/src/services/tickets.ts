import type { TicketInput } from '@runcastle/core'
import { BlockingEdgeError, Ticket, newId, resolveBatchBlocking } from '@runcastle/core'
import { and, asc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { tickets } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { emit } from './events'
import { getFeatureRow } from './repo'

/**
 * Ticket storage. The ideation session emits `TicketInput[]` in one batch via
 * MCP; `storeTickets` assigns each a global `seq` and resolves the batch-local
 * `blockedBy` references (see the note in `storeTickets` and
 * docs/research/CORRECTIONS.md).
 */

type TicketSelect = typeof tickets.$inferSelect

function rowToTicket(row: TicketSelect): Ticket {
  return Ticket.parse({
    id: row.id,
    featureId: row.featureId,
    seq: row.seq,
    title: row.title,
    goal: row.goal,
    context: row.context,
    acceptanceCriteria: row.acceptanceCriteria,
    seams: row.seams,
    blockedBy: row.blockedBy,
    lap: row.lap,
    status: row.status,
    commits: row.commits,
    error: row.error ?? undefined,
    attemptBranch: row.attemptBranch ?? undefined,
    conflictFiles: row.conflictFiles ?? undefined,
    digest: row.digest ?? undefined,
  })
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
 *
 * Every row is stamped with the feature's CURRENT lap (ADR-0010 / SPEC §15.1);
 * the emitting session never chooses it, which is why `TicketInput` has no
 * `lap`. Earlier laps' tickets keep the lap they were stored in.
 */
export function storeTickets(
  ctx: AppCtx,
  featureId: string,
  inputs: TicketInput[],
): Ticket[] {
  if (inputs.length === 0) return []

  const { lap } = getFeatureRow(ctx, featureId)

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
    lap,
    status: 'pending' as const,
    commits: [] as string[],
    error: null,
    attemptBranch: null,
    conflictFiles: null,
    digest: null,
  }))

  ctx.db.insert(tickets).values(rows).run()
  emit(ctx, featureId, {
    type: 'tickets.stored',
    message: `${rows.length} ticket(s) stored`,
    data: { count: rows.length, seqs: rows.map((r) => r.seq) },
  })

  return rows.map(rowToTicket)
}

export function getTicket(ctx: AppCtx, id: string): Ticket {
  const row = ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!row) throw new NotFoundError(`ticket ${id} not found`)
  return rowToTicket(row)
}

/** Content fields a human/agent may rewrite after the fact (revisit sessions). */
export type TicketContentPatch = Partial<
  Pick<Ticket, 'title' | 'goal' | 'context' | 'acceptanceCriteria' | 'seams'>
>

/** Statuses whose content may still change / that may still be cancelled. */
const MUTABLE_STATUSES = new Set<Ticket['status']>(['pending', 'failed'])

function assertMutable(t: Ticket, verb: string): void {
  if (!MUTABLE_STATUSES.has(t.status)) {
    throw new InvalidInputError(
      `cannot ${verb} ticket ${t.seq} — it is ${t.status}; only pending or failed tickets can be ${verb}${verb.endsWith('l') ? 'led' : 'ed'}`,
    )
  }
}

/**
 * Rewrite a ticket's content (title/goal/context/acceptanceCriteria/seams) —
 * the ticket-surgery half of a revisit session. Only `pending`/`failed` tickets
 * are editable: a `burning` ticket's prompt is already rendered, and rewriting
 * `done`/`cancelled` history would lie about what was burned.
 */
export function editTicket(ctx: AppCtx, id: string, patch: TicketContentPatch): Ticket {
  const current = getTicket(ctx, id)
  assertMutable(current, 'edit')

  const set: Partial<TicketSelect> = {}
  if (patch.title !== undefined) set.title = patch.title
  if (patch.goal !== undefined) set.goal = patch.goal
  if (patch.context !== undefined) set.context = patch.context
  if (patch.acceptanceCriteria !== undefined) set.acceptanceCriteria = patch.acceptanceCriteria
  if (patch.seams !== undefined) set.seams = patch.seams
  if (Object.keys(set).length === 0) {
    throw new InvalidInputError('nothing to edit — pass at least one content field')
  }

  ctx.db.update(tickets).set(set).where(eq(tickets.id, id)).run()
  emit(ctx, current.featureId, {
    type: 'ticket.edited',
    message: `ticket ${current.seq} content edited (${Object.keys(set).join(', ')})`,
    ticketId: id,
    data: { fields: Object.keys(set) },
  })
  return getTicket(ctx, id)
}

/**
 * Cancel a ticket — terminal, human/agent-initiated (never the burner). Only
 * `pending`/`failed` tickets can be cancelled. The scheduler skips cancelled
 * tickets and treats a cancelled blocker as satisfied, so dependents still burn.
 */
export function cancelTicket(ctx: AppCtx, id: string, reason?: string): Ticket {
  const current = getTicket(ctx, id)
  assertMutable(current, 'cancel')

  ctx.db
    .update(tickets)
    .set({ status: 'cancelled', error: reason?.trim() ? reason.trim() : null })
    .where(eq(tickets.id, id))
    .run()
  emit(ctx, current.featureId, {
    type: 'ticket.cancelled',
    message: `ticket ${current.seq} cancelled${reason?.trim() ? `: ${reason.trim()}` : ''}`,
    ticketId: id,
    data: { reason: reason ?? null },
  })
  return getTicket(ctx, id)
}

/**
 * Sweep tickets left `burning` with nothing behind them — the run that owned
 * them is over (finalized, cancelled, or killed with the server), so no agent
 * will ever move them again.
 *
 * A stranded `burning` row is a dead end in every direction: it is non-terminal
 * so G4 never passes, the scheduler only picks up `pending` tickets so a
 * re-burn finishes instantly with the ticket still stuck (`8/9 tickets done`),
 * `retry`/`cancel`/`edit` all refuse a non-`pending`/`failed` ticket, and "Stop
 * ticket" finds no live agent to abort. Marking them `failed` — keeping
 * `attemptBranch`/`conflictFiles`, so a retry resumes the committed work rather
 * than redoing it — puts them back on the paths that CAN move them.
 *
 * Callers must first establish that no agent is live for these tickets (the run
 * finalizer, boot reconciliation, and burn restart each know this by
 * construction).
 */
export function sweepOrphanedBurning(ctx: AppCtx, featureId: string, reason: string): Ticket[] {
  const orphaned = ctx.db
    .select()
    .from(tickets)
    .where(and(eq(tickets.featureId, featureId), eq(tickets.status, 'burning')))
    .all()
    .map(rowToTicket)

  for (const t of orphaned) {
    updateTicket(ctx, t.id, { status: 'failed', error: reason })
    emit(ctx, featureId, {
      type: 'ticket.failed',
      message: `ticket ${t.seq} failed: ${reason}`,
      ticketId: t.id,
      data: { error: reason, orphaned: true },
    })
  }
  return orphaned.map((t) => ({ ...t, status: 'failed' as const, error: reason }))
}

export function updateTicket(
  ctx: AppCtx,
  id: string,
  // `null` clears a stored error/attemptBranch/conflictFiles (retry +
  // successful-landing paths).
  patch: Partial<Pick<Ticket, 'status' | 'commits' | 'digest'>> & {
    error?: string | null
    attemptBranch?: string | null
    conflictFiles?: string[] | null
  },
): Ticket {
  const current = ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!current) throw new NotFoundError(`ticket ${id} not found`)

  const set: Partial<TicketSelect> = {}
  if (patch.status !== undefined) set.status = patch.status
  if (patch.commits !== undefined) set.commits = patch.commits
  if (patch.error !== undefined) set.error = patch.error
  if (patch.attemptBranch !== undefined) set.attemptBranch = patch.attemptBranch
  if (patch.conflictFiles !== undefined) set.conflictFiles = patch.conflictFiles
  if (patch.digest !== undefined) set.digest = patch.digest

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
