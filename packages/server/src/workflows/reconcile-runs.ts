import type { EventRow, Run } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { runs } from '../db/schema'
import { releaseTalkWorktreeAfterRun } from '../services/chat-branch'
import { emit, listAfter } from '../services/events'
import { cleanupTempBranches } from '../services/git'
import { deliverToLead } from '../services/lead-delivery'
import { notifyOrchestrator } from '../services/orchestrator-notify'
import { allProjects, getProjectById, rowToRun, tryGetFeature } from '../services/repo'
import { listRounds } from '../services/runs'
import { listByFeature, sweepOrphanedBurning } from '../services/tickets'
import { isRunActive, workflowClaimsFeatureBranch } from './runner'

/**
 * Boot reconciliation for runs (mirror of `launcher/reconcile.ts` for
 * sessions). Run promises live in-process, so after a cold server start every
 * `running` run row is stale by definition — its workflow died with the old
 * server. Left alone, those rows wedge the launcher's active-run guard forever
 * and (for branch-claiming workflows) leave the talk worktree parked on a
 * detached HEAD.
 *
 * For each stale run this mirrors the finalizer minus the workflow itself:
 * mark the row `failed` (summary "orphaned by server restart"), fail the ticket
 * lanes it left `burning` (their agents died with it — see
 * `sweepOrphanedBurning`), best-effort hand back the talk worktree a
 * branch-claiming run parked on a chat branch, and emit ONE `run.reconciled`
 * event per run.
 * Afterwards it sweeps leftover ticket temp branches — deleting only those
 * fully merged into their feature branch; unmerged ones hold unlanded commits
 * (mid-run crash or a conflict preserved for manual recovery) and are kept.
 *
 * `bun --hot` safety: a run whose AbortController is still registered in this
 * process (`isRunActive`) is genuinely in flight across a hot reload and is
 * skipped — reconciliation only fails runs with no living driver behind them.
 */
export async function reconcileStaleRuns(ctx: AppCtx): Promise<Run[]> {
  const stale = ctx.db
    .select()
    .from(runs)
    .where(eq(runs.status, 'running'))
    .all()
    .map(rowToRun)

  const reconciled: Run[] = []
  for (const run of stale) {
    if (isRunActive(run.id)) continue // genuinely in flight across a hot reload

    ctx.db
      .update(runs)
      .set({ status: 'failed', endedAt: Date.now(), summary: 'orphaned by server restart' })
      .where(eq(runs.id, run.id))
      .run()
    // The run's in-flight ticket lanes died with it. Their `burning` rows would
    // otherwise survive forever — non-terminal, unretryable, and invisible to
    // the next burn's scheduler (see `sweepOrphanedBurning`).
    const swept = workflowClaimsFeatureBranch(run.workflow)
      ? sweepOrphanedBurning(ctx, run.featureId, 'orphaned by server restart — retry to resume its commits')
      : []

    // A branch-claiming run parked the talk worktree on a chat branch at start
    // and its finalizer (which would have handed the feature branch back) never
    // ran — run the same boundary here, so the chat's unlanded commits land and
    // the next HITL session opens on the feature branch.
    if (workflowClaimsFeatureBranch(run.workflow)) {
      const feature = tryGetFeature(ctx, run.featureId)
      const project = feature ? getProjectById(ctx, feature.projectId) : null
      if (feature && project) {
        try {
          await releaseTalkWorktreeAfterRun(ctx, project, feature)
        } catch {
          // best-effort — a parked worktree is still readable; never fail boot
        }
      }
    }

    const burnTickets = run.workflow === 'ticket-burner' ? listByFeature(ctx, run.featureId) : []
    const landedTickets = burnTickets.filter((ticket) => ticket.status === 'done').length
    const pendingTickets = burnTickets.filter(
      (ticket) => ticket.status !== 'done' && ticket.status !== 'cancelled',
    ).length
    const interruptionMessage = `A burn was interrupted by a server restart: ${landedTickets} ticket${landedTickets === 1 ? '' : 's'} landed, ${pendingTickets} pending`

    emit(ctx, run.featureId, {
      type: 'run.reconciled',
      message:
        run.workflow === 'ticket-burner'
          ? interruptionMessage
          : `run marked failed at boot — the server restarted while it was running (${run.workflow})`,
      runId: run.id,
      data: {
        runId: run.id,
        workflow: run.workflow,
        sweptTicketSeqs: swept.map((t) => t.seq),
        ...(run.workflow === 'ticket-burner' ? { landedTickets, pendingTickets } : {}),
      },
    })
    reconciled.push(run)
  }

  // Sweep runcastle ticket temp branches orphaned by crashed runs
  // (merged-only; see `cleanupTempBranches`). Best-effort: a missing/broken repo
  // never blocks boot. Project-wide (multi-project, issue #43): every project.
  for (const project of allProjects(ctx)) {
    try {
      await cleanupTempBranches(project.repoPath)
    } catch {
      // best-effort
    }
  }

  return reconciled
}

const RECONCILED = 'run.reconciled'

/** A count of tickets in words: "1 ticket", "3 tickets". */
const ticketCount = (n: number): string => `${n} ticket${n === 1 ? '' : 's'}`

/** The landed/pending counts a burn's `run.reconciled` event carries. */
function countsOf(event: EventRow): { landed: number; pending: number } {
  const data = (event.data ?? {}) as { landedTickets?: unknown; pendingTickets?: unknown }
  return {
    landed: typeof data.landedTickets === 'number' ? data.landedTickets : 0,
    pending: typeof data.pendingTickets === 'number' ? data.pendingTickets : 0,
  }
}

/**
 * What the lead hears about a round a restart cut off (you-always-know-what-s-
 * waiting decision 10), or null when `run` is not a round. The round before it
 * having been cut off too means this was its one rerun, so the lead stops and
 * waits for the human rather than dispatching it on every boot.
 */
export function composeInterruptedWake(ctx: AppCtx, run: Run): string | null {
  const reconciled = listAfter(ctx, run.featureId).filter((e) => e.type === RECONCILED)
  const event = reconciled.find((e) => e.runId === run.id)
  const rounds = listRounds(ctx, run.featureId)
  const round = rounds.find((r) => r.runId === run.id)
  if (!event || !round) return null
  // A second interruption is a rerun of the round before it that a restart
  // also cut off: the same tickets, not merely the next round number.
  const before = rounds.find((r) => r.round === round.round - 1)
  const again =
    before !== undefined &&
    reconciled.some((e) => e.runId === before.runId) &&
    round.ticketSeqs.some((seq) => before.ticketSeqs.includes(seq))
  const { landed, pending } = countsOf(event)
  const counts = `${ticketCount(landed)} landed, ${pending} pending`
  return again
    ? `[runcastle] Round ${round.round} was interrupted by a server restart, the second time running this round: ${counts}. ` +
        'Do not dispatch it again: call wait_for_you with kind "stuck" and tell the human what happened.'
    : `[runcastle] Round ${round.round} was interrupted by a server restart: ${counts}. ` +
        'You may dispatch it again once without asking.'
}

/**
 * Tell whoever is responsible about the rounds {@link reconcileStaleRuns} cut
 * off (decision 10): the lead hears it as it hears a round's end, and the
 * holder gets its news line. Called once the server listens and the holders'
 * notifier runs, since a woken agent reaches runcastle's MCP server and the
 * `run.reconciled` events were emitted before anyone was listening. Best
 * effort: a failed wake reads "Stopped" on its own, and nothing here throws.
 */
export async function wakeInterruptedRounds(ctx: AppCtx, reconciled: Run[]): Promise<void> {
  for (const run of reconciled) {
    if (run.workflow !== 'ticket-burner') continue
    try {
      const event = listAfter(ctx, run.featureId).find((e) => e.type === RECONCILED && e.runId === run.id)
      if (event) notifyOrchestrator(ctx, event.id)
      const feature = tryGetFeature(ctx, run.featureId)
      const text = composeInterruptedWake(ctx, run)
      if (feature && text) await deliverToLead(ctx, feature, { text, source: 'runcastle' })
    } catch (err) {
      console.error('could not wake the lead of an interrupted round', err)
    }
  }
}
