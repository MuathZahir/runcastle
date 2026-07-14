import type { EventRow } from '@runcastle/core'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events } from '../db/schema'

/**
 * The timeline. Every mutating service function emits an event here — the UI
 * polls `events.list` at 1.5s, so events are the app's live feed (SPEC §12).
 * `events.id` is an autoincrement integer that doubles as the polling cursor.
 */

export interface EmitInput {
  type: string
  message: string
  runId?: string
  ticketId?: string
  data?: unknown
}

type EventSelect = typeof events.$inferSelect

function rowToEvent(row: EventSelect): EventRow {
  return {
    id: row.id,
    featureId: row.featureId,
    runId: row.runId ?? undefined,
    ticketId: row.ticketId ?? undefined,
    ts: row.ts,
    type: row.type,
    message: row.message,
    data: row.data ?? undefined,
  }
}

/** Append a timeline event for a feature; returns the stored row (with id). */
export function emit(ctx: AppCtx, featureId: string, e: EmitInput): EventRow {
  const row = ctx.db
    .insert(events)
    .values({
      featureId,
      runId: e.runId ?? null,
      ticketId: e.ticketId ?? null,
      ts: Date.now(),
      type: e.type,
      message: e.message,
      data: e.data ?? null,
    })
    .returning()
    .get()
  return rowToEvent(row)
}

/** Events for a feature with `id > afterId`, oldest first (the poll cursor). */
export function listAfter(ctx: AppCtx, featureId: string, afterId = 0): EventRow[] {
  const rows = ctx.db
    .select()
    .from(events)
    .where(and(eq(events.featureId, featureId), gt(events.id, afterId)))
    .orderBy(asc(events.id))
    .all()
  return rows.map(rowToEvent)
}
