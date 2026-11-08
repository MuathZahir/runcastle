import type { ReviewGateRun, RoundGates, RoundSummary, Run, Ticket } from '@runcastle/core'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { events, runs, tickets } from '../db/schema'
import { releaseTalkWorktreeAfterRun } from './chat-branch'
import { emit } from './events'
import { getProjectById, getRunRow, listRunsByFeature, rowToRun, tryGetFeature } from './repo'
import { listByFeature } from './tickets'

/**
 * Run history, read only. Runs, rounds and tickets are frozen: nothing writes
 * them any more (burns became workers), and these reads serve the History view
 * and `get_work_record` for features built before. Everything a past run needs
 * is already stored: the run row, the ticket rows, and the run's own events,
 * which is where the join between the two lives (every ticket event a run
 * emitted carries its `runId`).
 */

/**
 * Boot step for the upgrade that retired the burn engine: a run still marked
 * `running` died with the old server and nothing will ever finish it, so it is
 * closed as failed (and its `burning` lanes with it) rather than wedging the
 * "a run is in progress" guards forever. Idempotent: once nothing is `running`
 * it does nothing. Returns how many runs it closed.
 */
export async function freezeStaleRuns(ctx: AppCtx): Promise<number> {
  const stale = ctx.db.select().from(runs).where(eq(runs.status, 'running')).all().map(rowToRun)
  for (const run of stale) {
    ctx.db
      .update(runs)
      .set({ status: 'failed', endedAt: Date.now(), summary: 'orphaned by server restart' })
      .where(eq(runs.id, run.id))
      .run()
    const reason = 'the burn engine is retired — hand this work to a worker'
    ctx.db
      .update(tickets)
      .set({ status: 'failed', error: reason })
      .where(and(eq(tickets.featureId, run.featureId), eq(tickets.status, 'burning')))
      .run()
    const feature = tryGetFeature(ctx, run.featureId)
    const project = feature ? getProjectById(ctx, feature.projectId) : null
    if (feature && project) {
      try {
        await releaseTalkWorktreeAfterRun(ctx, project, feature)
      } catch {
        // best-effort — a parked worktree is still readable; never fail boot
      }
    }
    emit(ctx, run.featureId, {
      type: 'run.reconciled',
      message: 'a round left running by the old server was closed — the burn engine is retired',
      runId: run.id,
    })
  }
  return stale.length
}

/** The only workflow that ever claimed a feature branch: the retired burn. */
function workflowClaimsFeatureBranch(workflowId: string): boolean {
  return workflowId === 'ticket-burner'
}

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

/**
 * Every ticket a run HOLDS, which is more than the ones it has spoken about: a
 * lane is claimed from the moment the schedule has it, and the schedule is set
 * before any event names a ticket. At concurrency 1 a five-ticket burn spends
 * almost its whole life with four claimed tickets it has said nothing about.
 *
 * The two moments the schedule is set are already on the feed: `run.started`
 * carries the lanes the run opened with, and `burn.admitted` the seqs a review's
 * defects added mid-run. Reading them back keeps {@link runTicketIds} — which
 * run HISTORY renders, and which means "what this run did" — exactly as narrow
 * as it was.
 */
export function runClaimedTicketIds(ctx: AppCtx, runId: string): string[] {
  const claimed = new Set(runTicketIds(ctx, runId))
  const admittedSeqs = new Set<number>()
  const rows = ctx.db
    .select({ type: events.type, data: events.data })
    .from(events)
    .where(and(eq(events.runId, runId), inArray(events.type, ['run.started', 'burn.admitted'])))
    .all()
  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>
    if (row.type === 'run.started' && Array.isArray(data.ticketIds)) {
      for (const id of data.ticketIds) if (typeof id === 'string') claimed.add(id)
    }
    if (row.type === 'burn.admitted' && Array.isArray(data.seqs)) {
      for (const seq of data.seqs) if (typeof seq === 'number') admittedSeqs.add(seq)
    }
  }
  // `burn.admitted` speaks in seqs, the number the human and the scheduler use;
  // one ticket read turns them into ids, and only when a run had admissions.
  if (admittedSeqs.size > 0) {
    const run = getRunRow(ctx, runId)
    for (const ticket of listByFeature(ctx, run.featureId)) {
      if (admittedSeqs.has(ticket.seq)) claimed.add(ticket.id)
    }
  }
  return [...claimed]
}

/**
 * The feature's newest burn — its newest branch-claiming run, however that run
 * ended. A run of a non-claiming workflow burns no tickets, so it is not what
 * "the latest run" means to anyone asking.
 */
export function latestBurn(ctx: AppCtx, featureId: string): Run | undefined {
  return listRunsByFeature(ctx, featureId).find((run) => workflowClaimsFeatureBranch(run.workflow))
}

/**
 * A round's verify-gate record as the trail reads it: every command passed, or
 * which did not. `null` when no verify command is configured, or the gates have
 * not run yet — there is no result to show, which is not the same as a pass.
 */
export function roundGatesOf(gates: ReviewGateRun | undefined): RoundGates | null {
  if (!gates || gates.status === 'none_configured') return null
  if (gates.status === 'couldnt_run') return { ok: false, failed: [`gates could not run: ${gates.reason}`] }
  const failed = gates.commands.filter((c) => c.outcome !== 'passed').map((c) => c.command)
  return { ok: failed.length === 0, failed }
}

/**
 * The feature's rounds (`the-feature-lead-runs-rounds` decision 16): every
 * branch-claiming run, numbered from 1 in start order — derived, never stored,
 * the way the lap counter was. Each carries the tickets it held and how they
 * ended, and its gates. No tokens: they are recorded, never shown (decision 25).
 */
export function listRounds(ctx: AppCtx, featureId: string): RoundSummary[] {
  const byId = new Map(listByFeature(ctx, featureId).map((t) => [t.id, t]))
  return listRunsByFeature(ctx, featureId)
    .filter((run) => workflowClaimsFeatureBranch(run.workflow))
    .reverse()
    .map((run, i) => {
      const held = runClaimedTicketIds(ctx, run.id)
        .map((id) => byId.get(id))
        .filter((t): t is Ticket => t !== undefined)
        .sort((a, b) => a.seq - b.seq)
      return {
        round: i + 1,
        runId: run.id,
        status: run.status,
        ticketSeqs: held.map((t) => t.seq),
        landed: held.filter((t) => t.status === 'done').map((t) => t.seq),
        failed: held.filter((t) => t.status === 'failed').map((t) => t.seq),
        gates: roundGatesOf(run.gates),
        startedAt: run.startedAt,
        finishedAt: run.endedAt ?? null,
      }
    })
}
