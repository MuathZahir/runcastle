import type { ModelEntry } from '@runcastle/core'
import { Ticket, modelRoster } from '@runcastle/core'
import { asc, count, eq, inArray } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features, tickets } from '../db/schema'
import { InvalidInputError, NotFoundError } from '../errors'
import { rosterConfig } from './model-discovery'

/**
 * Ticket history, read only. Tickets are frozen: nothing writes them any more
 * (burns became workers), and these reads serve the History view, outcome and
 * `get_work_record` for features built before.
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
    kind: row.kind,
    passKind: row.passKind,
    reviewedCommit: row.reviewedCommit,
    reviewMode: row.reviewMode,
    reviewVerdict: row.reviewVerdict,
    reviewVerdictReason: row.reviewVerdictReason,
    reviewGateRun: row.reviewGateRun,
    completedAt: row.completedAt,
    model: row.model ?? undefined,
    status: row.status,
    commits: row.commits,
    error: row.error ?? undefined,
    attemptBranch: row.attemptBranch ?? undefined,
    conflictFiles: row.conflictFiles ?? undefined,
    digest: row.digest ?? undefined,
    originFindingId: row.originFindingId ?? undefined,
  })
}

/** One annotated roster entry, as the tickets session is offered it. */
export interface AnnotatedModel {
  id: string
  runtime: ModelEntry['runtime']
  note: string
}

/**
 * The roster entries carrying a use-case note, in roster order. A blank note is
 * no note — the operator cleared the field rather than describing a use case.
 * This is the whole set a session may assign (`get_feature_context` serves it,
 * {@link requireAnnotatedModels} enforces it); the human's own edits reach the
 * wider roster through {@link normalizeModel} alone.
 */
export function annotatedModels(ctx: AppCtx): AnnotatedModel[] {
  return modelRoster(rosterConfig(ctx)).flatMap((m) =>
    m.note?.trim() ? [{ id: m.id, runtime: m.runtime, note: m.note.trim() }] : [],
  )
}

/**
 * Refuse any session-assigned model outside the annotated roster. A curated id
 * the operator never annotated is on the roster, so `normalizeModel` would take
 * it — but a session has no stated reason to pick it, and in practice it is an
 * id remembered from an older roster. Blank still clears, so it passes. The
 * message carries the current annotated ids so the agent can correct itself in
 * one step.
 */
export function requireAnnotatedModels(
  ctx: AppCtx,
  values: readonly (string | null | undefined)[],
): void {
  const ids = values.flatMap((v) => v?.trim() || [])
  if (ids.length === 0) return
  const allowed = annotatedModels(ctx).map((m) => m.id)
  const refused = ids.find((id) => !allowed.includes(id))
  if (refused === undefined) return
  throw new InvalidInputError(
    allowed.length === 0
      ? `model "${refused}" is not annotated — no models are annotated, so omit \`model\``
      : `model "${refused}" is not annotated — assign one of the annotated models (${allowed.join(', ')}) or omit \`model\``,
  )
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
 * How many tickets each feature of a project has in each status, keyed by
 * feature id. One query for the whole project: the feature list is read on every
 * signal, and reading each ticket whole to count it was most of what it cost.
 */
export function ticketStatusCounts(ctx: AppCtx, projectId: string): Map<string, Map<string, number>> {
  const rows = ctx.db
    .select({ featureId: tickets.featureId, status: tickets.status, n: count() })
    .from(tickets)
    .innerJoin(features, eq(features.id, tickets.featureId))
    .where(eq(features.projectId, projectId))
    .groupBy(tickets.featureId, tickets.status)
    .all()
  const out = new Map<string, Map<string, number>>()
  for (const { featureId, status, n } of rows) {
    const byStatus = out.get(featureId) ?? new Map<string, number>()
    byStatus.set(status, n)
    out.set(featureId, byStatus)
  }
  return out
}

/**
 * Is this a ticket the burner still has to run?
 *
 * `done`, `failed` and `cancelled` are the terminal statuses; everything else —
 * `pending`, `burning`, and any lane a run leaves mid-flight — is work a burn
 * would still pick up. One definition, because three callers ask the same
 * question for three reasons: the round itself, the planning-progress model
 * ("are there tickets to burn yet"), and the round warnings.
 */
export function isPendingTicket(ticket: Ticket): boolean {
  return ticket.status !== 'done' && ticket.status !== 'failed' && ticket.status !== 'cancelled'
}

export function getTicket(ctx: AppCtx, id: string): Ticket {
  const row = ctx.db.select().from(tickets).where(eq(tickets.id, id)).get()
  if (!row) throw new NotFoundError(`ticket ${id} not found`)
  return rowToTicket(row)
}

/**
 * The ticket rows a given set of ids resolves to, in ledger (`seq`) order —
 * what lets a finished run render the lanes it burned. Ids the ledger no longer
 * holds are simply absent: a past run is history, and a hole in it is not worth
 * an error.
 */
export function listByIds(ctx: AppCtx, ids: readonly string[]): Ticket[] {
  if (ids.length === 0) return []
  return ctx.db
    .select()
    .from(tickets)
    .where(inArray(tickets.id, [...ids]))
    .orderBy(asc(tickets.seq))
    .all()
    .map(rowToTicket)
}
