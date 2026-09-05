import type { Run, RunStatus, Ticket } from '@runcastle/core'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events } from '../db/schema'
import { getRunRow, listRunsByFeature } from './repo'
import { listByIds } from './tickets'

/**
 * Run history (decision #15b). A feature accumulates one run per burn, and only
 * the latest one used to be renderable — the rest were rows nothing could
 * reach. Everything a past run needs to draw its lanes is already stored: the
 * run row, the ticket rows, and the run's own events, which is where the join
 * between the two lives (every ticket event a run emits carries its `runId`).
 *
 * So this adds no persistence. It reads what the burn already wrote.
 */

/** One run as the runs list renders it — enough to name it, not to draw it. */
export interface RunSummary {
  id: string
  status: RunStatus
  startedAt: number
  endedAt?: number
  /** The feature's lap when the run started, stamped on its first event. */
  lap: number
  ticketIds: string[]
}

/** A run plus the ledger rows its lanes are, for rendering one in record mode. */
export type RunWithTickets = Run & { tickets: Ticket[] }

/**
 * The tickets a run touched, in the order the run first spoke about them.
 *
 * The events table is the only record of which tickets a given run burned — the
 * ticket row itself keeps no run id, because a ticket can be burned by several
 * runs (a retry is its own run) and only the last of them would survive a
 * column. Reading it back off the feed costs one indexed scan and cannot go
 * stale.
 */
function runTicketIds(ctx: AppCtx, runId: string): string[] {
  const rows = ctx.db
    .select({ ticketId: events.ticketId })
    .from(events)
    .where(and(eq(events.runId, runId), isNotNull(events.ticketId)))
    .orderBy(asc(events.id))
    .all()
  const seen = new Set<string>()
  for (const row of rows) if (row.ticketId) seen.add(row.ticketId)
  return [...seen]
}

/** The lap a run belongs to — the lap its first event was stamped with. */
function runLap(ctx: AppCtx, runId: string): number {
  const row = ctx.db
    .select({ lap: events.lap })
    .from(events)
    .where(eq(events.runId, runId))
    .orderBy(asc(events.id))
    .limit(1)
    .get()
  return row?.lap ?? 1
}

/** Every run of a feature, newest first, for the run-history picker. */
export function listRunSummaries(ctx: AppCtx, featureId: string): RunSummary[] {
  return listRunsByFeature(ctx, featureId).map((run) => ({
    id: run.id,
    status: run.status,
    startedAt: run.startedAt,
    ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
    lap: runLap(ctx, run.id),
    ticketIds: runTicketIds(ctx, run.id),
  }))
}

/**
 * One run with the ticket rows it burned. The live run view reads the feature's
 * whole ledger instead — it is watching work in flight, and a ticket admitted
 * mid-run (a review's fix wave) must appear the moment it exists. A past run is
 * the opposite: it is exactly the lanes it had, and nothing since.
 */
export function getRunWithTickets(ctx: AppCtx, runId: string): RunWithTickets {
  const run = getRunRow(ctx, runId)
  return { ...run, tickets: listByIds(ctx, runTicketIds(ctx, runId)) }
}
