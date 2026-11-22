import { AUTOSTART_FAILED, type DecidedWithoutYou, decidedWithoutYou, unresolvedMergeConflict } from '@runcastle/core'
import { featureDocsRel, scenarioDataDir } from '@runcastle/core/paths'
import { rmSync } from 'node:fs'
import type { AppCtx } from '../db/types'
import { stopDesignServer } from './design'
import { emit, listAfter } from './events'
import { retireShippedWorktree } from './feature-worktrees'
import { requireNotDraft } from './features'
import * as git from './git'
import { promoteOutcomeDoc } from './outcome'
import { clearFeatureWaits } from './waits'
import { deliverToLead } from './lead-delivery'
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
  /** A landed merge's commit, when it could be read. */
  sha?: string | null
}

/**
 * Merge a feature through runcastle's own record — the Merge button and the
 * orchestrator's `merge_feature` share this one flow, so either way the outcome
 * doc is promoted, the feature ships, its worktree is retired, and a conflict
 * lands on the timeline as `merge.conflict`.
 *
 * `opts.by` is the orchestrator thread whose `merge_feature` merged it, or
 * `runcastle` when a ready feature at "Involve me in: Nothing" merged by itself
 * (absent: the human). It rides on `feature.shipped`, with the merge commit, the
 * review summary and the decisions marked "Decided without you", so the
 * feature's epic hears who merged it and what was settled
 * (`autopilot-retires` decision 2); that news goes once the up-next drafts this
 * merge starts have started.
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
  let shaOf: string | null = null
  if (res.ok) {
    if (standingConflict) {
      emit(ctx, featureId, {
        type: 'merge.resolved',
        message: 'conflict retired by the merge',
      })
    }
    // The merge commit, read before the outcome doc commits on top of it.
    const sha = (await git.headSha(project.repoPath, res.target)) ?? null
    shaOf = sha
    // `outcome.md` for an old-shape feature, `brief.md` (its `## Review summary`) for a one-file one.
    const promoted = await promoteOutcomeDoc(ctx, project, feature, res.target, delta)
    const outcome = promoted.rel && (await git.headSha(project.repoPath, `${res.target}:${promoted.rel}`)) ? promoted.rel : null
    const shippedData: ShippedData = {
      base: res.target,
      sha,
      outcome,
      mergedBy: opts.by ?? null,
      reviewSummary: promoted.summary,
      decidedWithoutYou: await mergedDecisions(project.repoPath, res.target, feature.slug),
    }
    const shipped = emit(ctx, featureId, {
      type: 'feature.shipped',
      message: `merged to ${res.target}`,
      data: shippedData,
    })
    setFeatureStatus(ctx, featureId, 'shipped')
    clearFeatureWaits(ctx, featureId)
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
    // After the up-next starts, so the epic's news lists them as in progress (decision 5).
    announceMerge(ctx, shipped.id)
    // Before the worktree goes: the design server runs inside it.
    await stopDesignServer(ctx, featureId, 'shipped')
    // A shipped feature's workers go: each keeps a whole copy of the repo (interactive-workers decision 18).
    await removeFeatureWorkers(ctx, featureId, 'merged')
    // The feature's scenario data leaves with it. Best-effort: a stray copy is
    // harmless, and the merge has landed.
    try {
      rmSync(scenarioDataDir(featureId), { recursive: true, force: true })
    } catch {
      // left behind; nothing reads it once the feature has shipped
    }
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
    // No agent stands behind a conflict, so its lead hears it and decides whether the human does (needs-you decision 9).
    const files = res.files ?? []
    await deliverToLead(ctx, getFeatureRow(ctx, featureId), {
      text:
        `[runcastle] Merging ${feature.branch} into ${res.target} stopped on a conflict` +
        (files.length ? ` in: ${files.join(', ')}` : '') +
        `. Bring ${res.target} into the feature branch and resolve it, or, if the human must decide, ask them in your reply and call wait_for_you.`,
      source: 'runcastle',
    }).catch((err) => console.error(`feature ${featureId}: conflict delivery`, err))
  }
  return { ok: res.ok, conflict: res.conflict, base: res.target, files: res.files ?? [], ...(res.ok ? { sha: shaOf } : {}) }
}

/**
 * The decisions the lead settled without the human, as merged into `target`:
 * an older feature's decisions.md, else its brief.md. Empty when neither reads.
 */
async function mergedDecisions(repoPath: string, target: string, slug: string): Promise<DecidedWithoutYou[]> {
  try {
    const docs = featureDocsRel(slug)
    const text =
      (await git.fileAtRef(repoPath, target, `${docs}/decisions.md`)) ??
      (await git.fileAtRef(repoPath, target, `${docs}/brief.md`))
    return text === null ? [] : decidedWithoutYou(text)
  } catch {
    return []
  }
}
