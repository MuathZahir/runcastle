import { EventRow } from '@runcastle/core'
import type { SessionRow } from '@runcastle/core'
import { and, asc, desc, eq, gt, max } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, features } from '../db/schema'
import { NotFoundError } from '../errors'
import { publishLive } from './bus'

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
  return EventRow.parse({
    id: row.id,
    projectId: row.projectId,
    featureId: row.featureId ?? undefined,
    runId: row.runId ?? undefined,
    ticketId: row.ticketId ?? undefined,
    ts: row.ts,
    type: row.type,
    message: row.message,
    data: row.data ?? undefined,
  })
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

/**
 * The lap to stamp on a feature's events (ADR-0010 / SPEC §15.1).
 *
 * Deliberately total: `insertEvent` runs on paths where a throw is not a failed
 * request but a server that will not start (boot reconciliation) or a session
 * that cannot be closed (PTY teardown). A missing feature row there means the
 * lap is unknowable, not that the event should be lost — same posture as
 * `emitForSession`, which drops rather than throws. Lap 1 is the honest
 * fallback: it is where every event lived before laps existed.
 */
function lapForFeature(ctx: AppCtx, featureId: string): number {
  const row = ctx.db
    .select({ lap: features.lap })
    .from(features)
    .where(eq(features.id, featureId))
    .get()
  return row?.lap ?? 1
}

/** Append a feature-scoped timeline event; project id is derived from the feature. */
export function emit(ctx: AppCtx, featureId: string, e: EmitInput): EventRow {
  return insertEvent(ctx, projectIdForFeature(ctx, featureId), featureId, e)
}

/** Append a project-level timeline event (open/close/rename); no feature. */
export function emitProject(ctx: AppCtx, projectId: string, e: EmitInput): EventRow {
  return insertEvent(ctx, projectId, null, e)
}

/**
 * Which timeline something's events land on. A test drive has a feature; the
 * preparation dry-run drive replays the same machinery with no feature at all,
 * so the machinery takes the scope rather than a feature id.
 */
export type EmitScope = { featureId: string } | { projectId: string }

/** Append an event at whichever scope its producer is running under. */
export function emitScoped(ctx: AppCtx, scope: EmitScope, e: EmitInput): EventRow {
  return 'featureId' in scope ? emit(ctx, scope.featureId, e) : emitProject(ctx, scope.projectId, e)
}

/**
 * Emit for a session at whichever scope that session has: feature-scoped for
 * every ordinary kind, project-scoped for `prepare` (which has no feature).
 *
 * This exists so the six lifecycle emitters — boot reconciliation, PTY
 * teardown, the launcher's own events — do not each grow their own branch on a
 * column that is now nullable. They are also the paths where getting it wrong
 * is worst: several run during boot or teardown, where a throw is not a failed
 * request but a server that will not start or a session that cannot be closed.
 *
 * A session with neither scope cannot be produced by any code path here, so it
 * means a corrupt row. Emitting is never the caller's actual goal — it is the
 * bookkeeping alongside it — so this drops the event and returns null rather
 * than taking down a boot sweep over a timeline entry.
 */
export function emitForSession(ctx: AppCtx, session: SessionRow, e: EmitInput): EventRow | null {
  if (session.featureId) return emit(ctx, session.featureId, e)
  if (session.projectId) return emitProject(ctx, session.projectId, e)
  return null
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
      // Feature-scoped events carry their feature's lap; project-level ones
      // (open/close/rename) have no feature and sit on lap 1.
      lap: featureId ? lapForFeature(ctx, featureId) : 1,
      runId: e.runId ?? null,
      ticketId: e.ticketId ?? null,
      ts: Date.now(),
      type: e.type,
      message: e.message,
      data: e.data ?? null,
    })
    .returning()
    .get()
  const event = rowToEvent(row)
  // Push the change to connected browsers (services/bus.ts). Every mutating
  // service function lands here, so this one call makes the whole app live —
  // polling stays only as the fallback for a dropped stream.
  publishLive({
    kind: 'event',
    projectId: event.projectId,
    featureId: event.featureId,
    eventId: event.id,
  })
  return event
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
 * When a feature's most recent event of `type` landed, if it ever did.
 *
 * The timeline is where a fact like "this shipped" is recorded — the feature row
 * carries `status: shipped` but not when it happened — so the work record reads
 * its ship date from here (`feature.shipped`, emitted by the merge). Absent is a
 * normal answer: an unmerged feature simply has no such event.
 */
export function latestEventTs(ctx: AppCtx, featureId: string, type: string): number | undefined {
  const row = ctx.db
    .select({ ts: events.ts })
    .from(events)
    .where(and(eq(events.featureId, featureId), eq(events.type, type)))
    .orderBy(desc(events.ts))
    .limit(1)
    .get()
  return row?.ts
}

/**
 * When each feature in a project last did anything, keyed by feature id.
 *
 * One grouped query for the whole project rather than a scan per feature:
 * `feature.list` is polled at 1.5s and already runs a query per row, so the
 * sidebar's activity stamp must not add another. Features with no events are
 * absent from the map — the caller decides what "never" means for it (the list
 * falls back to `createdAt`, so a brand-new feature reads as its own age).
 */
export function latestTsByFeature(ctx: AppCtx, projectId: string): Map<string, number> {
  const rows = ctx.db
    .select({ featureId: events.featureId, ts: max(events.ts) })
    .from(events)
    .where(eq(events.projectId, projectId))
    .groupBy(events.featureId)
    .all()

  const out = new Map<string, number>()
  // Project-level events (open/close/rename) carry no feature and are skipped.
  for (const row of rows) {
    if (row.featureId !== null && row.ts !== null) out.set(row.featureId, row.ts)
  }
  return out
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
