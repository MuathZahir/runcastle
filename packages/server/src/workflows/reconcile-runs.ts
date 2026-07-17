import type { Run } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { runs } from '../db/schema'
import { emit } from '../services/events'
import { cleanupResearchBranches, reattachWorktree } from '../services/git'
import { getProjectRow, rowToRun, tryGetFeature } from '../services/repo'
import { releaseForSession } from '../services/waypoints'
import { isRunActive, workflowClaimsFeatureBranch } from './runner'

/**
 * Boot reconciliation for runs (mirror of `launcher/reconcile.ts` for
 * sessions). Run promises live in-process, so after a cold server start every
 * `running` run row is stale by definition — its workflow died with the old
 * server. Left alone, those rows wedge the launcher's active-run guard forever,
 * keep their claimed waypoints off the frontier, and (for branch-claiming
 * workflows) leave the talk worktree parked on a detached HEAD.
 *
 * For each stale run this mirrors the finalizer minus the workflow itself:
 * mark the row `failed` (summary "orphaned by server restart"), auto-release
 * any waypoint it still claims, best-effort reattach the talk worktree that a
 * branch-claiming run detached, and emit ONE `run.reconciled` event per run.
 * Afterwards it sweeps leftover research temp branches — deleting only those
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
    const released = releaseForSession(ctx, run.id)

    // A branch-claiming run detached the talk worktree at start and its
    // finalizer (which would have reattached it) never ran — restore it so the
    // next HITL session lands on the feature branch, not a detached HEAD.
    if (workflowClaimsFeatureBranch(run.workflow)) {
      const feature = tryGetFeature(ctx, run.featureId)
      const project = getProjectRow(ctx)
      if (feature && project) {
        try {
          await reattachWorktree(worktreeDir(project.id, feature.slug), feature.branch)
        } catch {
          // best-effort — a detached worktree is still readable; never fail boot
        }
      }
    }

    emit(ctx, run.featureId, {
      type: 'run.reconciled',
      message: `run marked failed at boot — the server restarted while it was running (${run.workflow})`,
      runId: run.id,
      data: {
        runId: run.id,
        workflow: run.workflow,
        releasedWaypointIds: released.map((w) => w.id),
      },
    })
    reconciled.push(run)
  }

  // Sweep research temp branches orphaned by crashed runs (merged-only; see
  // `cleanupResearchBranches`). Best-effort: a missing/broken repo never
  // blocks boot.
  const project = getProjectRow(ctx)
  if (project) {
    try {
      await cleanupResearchBranches(project.repoPath)
    } catch {
      // best-effort
    }
  }

  return reconciled
}
