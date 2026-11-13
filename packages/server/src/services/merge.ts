import { AUTOSTART_FAILED, unresolvedMergeConflict } from '@runcastle/core'
import { featureDocsRel } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { stopDesignServer } from './design'
import { emit, listAfter } from './events'
import { retireShippedWorktree } from './feature-worktrees'
import { requireNotDraft } from './features'
import * as git from './git'
import { promoteOutcomeDoc } from './outcome'
import { clearHandback } from './lead-status'
import { announceMerge, type ShippedData } from './orchestrator-notify'
import { getFeatureRow, projectForFeature, setFeatureStatus } from './repo'
import { startUpNextDependents } from './up-next'
import { removeFeatureWorkers } from '../workers/service'

/** What a merge click answers: landed, or the conflict and the files it stands on. */
export interface MergeFlowResult {
  ok: boolean
  conflict?: boolean
  base: string
  files: string[]
}

/**
 * Merge a feature through runcastle's own record — the Merge button and the
 * orchestrator's `merge_feature` share this one flow, so either way the outcome
 * doc is promoted, the feature ships, its worktree is retired, and a conflict
 * lands on the timeline as `merge.conflict`.
 *
 * `opts.by` is the orchestrator thread whose `merge_feature` merged it (absent:
 * the human). It rides on `feature.shipped`, with the merge commit, so the
 * feature's epic hears who merged it (`the-epic-hears-when-its-features-merge`);
 * that news goes once the up-next drafts this merge starts have started.
 */
export async function mergeFeatureFlow(
  ctx: AppCtx,
  featureId: string,
  opts: { by?: string } = {},
): Promise<MergeFlowResult> {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  const project = projectForFeature(ctx, feature)
  // A test drive of THIS feature holds the main checkout on the feature
  // branch; stop it first (restores main) so the merge can proceed. This lets
  // the Merge button work whether or not the branch is currently test-driven.
  if (git.activeTestDriveFeatureId(project.id) === feature.id) {
    await git.testDrive(ctx, project, feature, 'stop')
  }
  // A project drive serves from the very checkout the merge commits in;
  // merging underneath its dev server would leave it describing old code.
  // Stop it the same way (project-level-test-drive decision 6).
  const drive = git.activeDriveInfo(project.id)
  if (drive?.projectDrive) {
    await git.projectDrive(ctx, project, 'stop')
  }
  const delta = await git.mergeDelta(project, feature)
  const standingConflict = unresolvedMergeConflict(listAfter(ctx, feature.id, 0))
  const res = await git.mergeFeature(project, feature)
  if (res.ok) {
    if (standingConflict) {
      emit(ctx, featureId, {
        type: 'merge.resolved',
        message: 'conflict retired by the merge',
      })
    }
    // The merge commit, read before the outcome doc commits on top of it.
    const sha = (await git.headSha(project.repoPath, res.target)) ?? null
    await promoteOutcomeDoc(ctx, project, feature, res.target, delta)
    const outcomeRel = `${featureDocsRel(feature.slug)}/outcome.md`
    const outcome = (await git.headSha(project.repoPath, `${res.target}:${outcomeRel}`)) ? outcomeRel : null
    const shippedData: ShippedData = { base: res.target, sha, outcome, mergedBy: opts.by ?? null }
    const shipped = emit(ctx, featureId, {
      type: 'feature.shipped',
      message: `merged to ${res.target}`,
      data: shippedData,
    })
    setFeatureStatus(ctx, featureId, 'shipped')
    clearHandback(ctx, featureId, 'closed')
    // Best-effort: the merge has landed, so a start that fails is an event on
    // the dependent (startUpNextDependents records them), never a failed ship.
    try {
      await startUpNextDependents(ctx, getFeatureRow(ctx, featureId))
    } catch (err) {
      emit(ctx, featureId, {
        type: AUTOSTART_FAILED,
        message: `couldn't start up-next dependents: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
    // After the up-next starts, so the epic's wake test counts them (decision 5).
    announceMerge(ctx, shipped.id)
    // Before the worktree goes: the design server runs inside it.
    await stopDesignServer(ctx, featureId, 'shipped')
    // A shipped feature's workers go: each keeps a whole copy of the repo (interactive-workers decision 18).
    await removeFeatureWorkers(ctx, featureId, 'merged')
    // Last, and best-effort: the merge has landed, so a worktree that will
    // not go is reported by an event, never by failing the ship.
    await retireShippedWorktree(ctx, project, feature)
  } else {
    // Carry the base branch + conflicting files on the event so the review
    // UI can surface the conflict card after a reload and brief the
    // resolve-with-agent session (kickoff needs both).
    emit(ctx, featureId, {
      type: 'merge.conflict',
      message: 'merge conflict — resolve and retry',
      data: { conflict: res.conflict, base: res.target, files: res.files ?? [] },
    })
  }
  return { ok: res.ok, conflict: res.conflict, base: res.target, files: res.files ?? [] }
}
