import type { EventRow } from '@runcastle/core'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, features } from '../db/schema'
import { NotFoundError } from '../errors'

/**
 * The timeline. Every mutating service function emits an event here — the UI
 * polls `events.list` at 1.5s, so events are the app's live feed (SPEC §12).
 * `events.id` is an autoincrement integer that doubles as the polling cursor.
 *
 * Every event carries its project id (issue #44). Feature-scoped events derive
 * that id from the feature; project-level events (open/close/rename) carry it
 * directly and leave `featureId` null. Listing by project returns both, so a
 * project stream shows everything happening in it — including the project-level
 * events that were invisible to any per-feature view.
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
    projectId: row.projectId,
    featureId: row.featureId ?? undefined,
    runId: row.runId ?? undefined,
    ticketId: row.ticketId ?? undefined,
    ts: row.ts,
    type: row.type,
    message: row.message,
    data: row.data ?? undefined,
  }
}

/** The project a feature belongs to — the required project id for its events. */
function projectIdForFeature(ctx: AppCtx, featureId: string): string {
  const row = ctx.db
    .select({ projectId: features.projectId })
    .from(features)
    .where(eq(features.id, featureId))
    .get()
  if (!row) throw new NotFoundError(`feature ${featureId} not found`)
  return row.projectId
}

/** Append a feature-scoped timeline event; project id is derived from the feature. */
export function emit(ctx: AppCtx, featureId: string, e: EmitInput): EventRow {
  return insertEvent(ctx, projectIdForFeature(ctx, featureId), featureId, e)
}

/** Append a project-level timeline event (open/close/rename); no feature. */
export function emitProject(ctx: AppCtx, projectId: string, e: EmitInput): EventRow {
  return insertEvent(ctx, projectId, null, e)
}

function insertEvent(
  ctx: AppCtx,
  projectId: string,
  featureId: string | null,
  e: EmitInput,
): EventRow {
  const row = ctx.db
    .insert(events)
    .values({
      projectId,
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

/**
 * Events for a project with `id > afterId`, oldest first — feature-scoped events
 * AND project-level ones (open/close/rename). Same cursor semantics as
 * `listAfter`, so a project stream polls identically (issue #44).
 */
export function listByProject(ctx: AppCtx, projectId: string, afterId = 0): EventRow[] {
  const rows = ctx.db
    .select()
    .from(events)
    .where(and(eq(events.projectId, projectId), gt(events.id, afterId)))
    .orderBy(asc(events.id))
    .all()
  return rows.map(rowToEvent)
}
