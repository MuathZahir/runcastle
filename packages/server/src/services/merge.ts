import { unresolvedMergeConflict } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { emit, listAfter } from './events'
import { retireShippedWorktree } from './feature-worktrees'
import { requireNotDraft } from './features'
import * as git from './git'
import { promoteOutcomeDoc } from './outcome'
import { getFeatureRow, projectForFeature, setFeatureStatus, setPhase } from './repo'

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
 */
export async function mergeFeatureFlow(ctx: AppCtx, featureId: string): Promise<MergeFlowResult> {
  const feature = getFeatureRow(ctx, featureId)
  requireNotDraft(feature)
  const project = projectForFeature(ctx, feature)
  // A test drive of THIS feature holds the main checkout on the feature
  // branch; stop it first (restores main) so the merge can proceed. This lets
  // the Merge button work whether or not the branch is currently test-driven.
  if (git.activeTestDriveFeatureId() === feature.id) {
    await git.testDrive(ctx, project, feature, 'stop')
  }
  // A project drive serves from the very checkout the merge commits in;
  // merging underneath its dev server would leave it describing old code.
  // Stop it the same way (project-level-test-drive decision 6).
  const drive = git.activeDriveInfo()
  if (drive?.projectDrive && drive.projectId === project.id) {
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
    await promoteOutcomeDoc(ctx, project, feature, res.target, delta)
    setPhase(ctx, featureId, 'shipped', 'feature.shipped', `merged to ${res.target}`)
    setFeatureStatus(ctx, featureId, 'shipped')
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
