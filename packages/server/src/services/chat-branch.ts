import type { Feature, Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { featureDocsRel, worktreeDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { emit } from './events'
import type { CommitSummary, TempBranchMergeResult } from './git'
import {
  activeTestDriveFeatureId,
  branchChangesAhead,
  branchCommitsAhead,
  chatBranchInWorktree,
  chatBranchName,
  deleteTempBranch,
  detachWorktree,
  ensureDetachedTalkWorktree,
  ensureTalkWorktree,
  headSha,
  mergeTempBranch,
  reattachWorktree,
  startBranchInWorktree,
} from './git'
import { featureLandingQueue } from './landing-queue'
import { hasActiveRun, listRunsByFeature } from './repo'

/**
 * How the feature chat keeps working while a burn holds the feature branch
 * (`one-chat-per-feature` decisions 2 and 9).
 *
 * The talk worktree used to be DETACHED for the duration of a branch-claiming
 * run, which is why terminals were refused outright: a session spawned mid-run
 * would commit its docs onto a detached HEAD and orphan them. Instead the same
 * worktree now rides a temp branch — `runcastle/chat/<slug>/<unique>`, cut where
 * the worktree already stands, so no working file moves and a live session sees
 * nothing but the name its next commit lands on. The branch releases
 * `feature/<slug>` exactly as detaching did.
 *
 * Each docs commit is landed promptly through the feature's serial landing queue
 * ({@link landChatCommits}), so a note or a ticket edit is durable on the feature
 * branch even if the run crashes — and serialized against the burner's own
 * landings, which is what the queue was widened to per-feature for. At run end
 * whatever has not landed lands last and the worktree goes back to the feature
 * branch ({@link releaseTalkWorktreeAfterRun}).
 */

/** A fresh place for the chat to commit; `unique` in the ADR-0003 short form. */
function nextChatBranch(slug: string): string {
  return chatBranchName(slug, newId('c').slice(2, 10))
}

/** The feature's talk worktree — the one directory all of this happens in. */
function talkWorktree(project: Project, feature: Feature): string {
  return worktreeDir(project.id, feature.slug)
}

/**
 * Move the talk worktree onto a fresh chat branch and say so on the timeline —
 * the one mutation every path here performs, so the one place that announces it.
 * Returns the branch, or `undefined` when git refused to cut it; what that
 * means is the caller's to decide.
 */
async function startFreshChatBranch(
  ctx: AppCtx,
  feature: Feature,
  worktreePath: string,
): Promise<string | undefined> {
  const branch = nextChatBranch(feature.slug)
  if (!(await startBranchInWorktree(worktreePath, branch))) return undefined
  emit(ctx, feature.id, {
    type: 'chat.worktree_parked',
    message: `parked the chat worktree on ${branch}`,
    data: { branch, worktreePath },
  })
  return branch
}

/**
 * Release `feature/<slug>`: a fresh chat branch if one can be cut, the old
 * detach if not — so a run is never blocked by a worktree that will not move.
 */
async function parkWorktree(ctx: AppCtx, feature: Feature, worktreePath: string): Promise<void> {
  if (await startFreshChatBranch(ctx, feature, worktreePath)) return
  await detachWorktree(worktreePath)
  emit(ctx, feature.id, {
    type: 'chat.worktree_detached',
    message: 'detached the chat worktree while the run holds the feature branch',
    data: { worktreePath },
  })
}

/**
 * Free `feature/<slug>` for a branch-claiming run by putting the talk worktree
 * on a fresh chat branch. Falls back to the old detach when the branch cannot be
 * cut (so a run is never blocked by it), and no-ops when the worktree is already
 * parked — a crashed run's leftover, which the next release still lands.
 */
export async function parkTalkWorktreeForRun(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<void> {
  const worktreePath = talkWorktree(project, feature)
  if (await chatBranchInWorktree(worktreePath)) return
  await parkWorktree(ctx, feature, worktreePath)
}

/**
 * The talk worktree for a session spawning while a branch-claiming run is live:
 * ensured as usual, then parked on a chat branch if it is not already — the case
 * where the run started before the feature had a worktree at all.
 */
export async function ensureTalkWorktreeDuringRun(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<string> {
  const worktreePath = await ensureTalkWorktree(project, feature, () =>
    emit(ctx, feature.id, {
      type: 'repo.head_healed',
      message: 'created runcastle: initial commit so branches can be cut',
    }),
  )
  if (!(await chatBranchInWorktree(worktreePath))) {
    await parkWorktree(ctx, feature, worktreePath)
  }
  return worktreePath
}

/**
 * The talk worktree for a session spawning while a drive of the feature holds
 * the feature branch — a closed lead woken by Send to agent, or the human
 * resuming it mid-drive. The drive's detached worktree is used as it stands; one
 * added now is parked on a chat branch, so its commits land at the drive's stop
 * ({@link landChatCommitsAfterDrive}) rather than sit orphaned on a detached HEAD.
 */
export async function ensureTalkWorktreeDuringDrive(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<string> {
  const { worktreePath, added } = await ensureDetachedTalkWorktree(project, feature)
  if (added) await parkWorktree(ctx, feature, worktreePath)
  return worktreePath
}

/** What one chat landing did. `null` from a call that had nothing to land. */
export interface ChatLanding {
  /** The branch that was landed (or tried). */
  branch: string
  /** How many commits it carried. */
  commits: number
  result: TempBranchMergeResult
  /** Not attempted: a drive of the feature holds the slot, so the commits wait on `branch`. */
  deferred?: true
}

/**
 * Is a drive of this feature holding the project's drive slot? It runs the
 * feature branch on the main checkout, so a landing would change the app under
 * whoever is driving it (`the-feature-lead-runs-rounds` decision 19): chat
 * landings wait until it stops ({@link landChatCommitsAfterDrive}).
 */
function drivenNow(project: Project, feature: Feature): boolean {
  return activeTestDriveFeatureId(project.id) === feature.id
}

/** Leave `branch`'s commits where they are and say why on the timeline. */
function deferLanding(ctx: AppCtx, feature: Feature, branch: string, commits: number): ChatLanding {
  emit(ctx, feature.id, {
    type: 'chat.landing_deferred',
    message: `a drive of this feature is running — ${commits} chat commit(s) wait on ${branch} until it stops`,
    data: { branch, commits },
  })
  return {
    branch,
    commits,
    deferred: true,
    result: { ok: false, error: 'deferred while the feature is being driven' },
  }
}

/**
 * Put `branch` on the feature branch through the feature's serial queue —
 * between two ticket landings, never across one — and say so on the timeline.
 * A landing that throws is reported as a failed one: the chat's docs are a
 * best-effort checkpoint and must never break the tool call or the run finalizer
 * that asked for it.
 *
 * A landing that carries code — any file outside the feature's docs — is the
 * lead's own fix, and is announced as `lead.code_landed` too, for the round
 * trail's "agent fix" entries.
 */
async function land(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  branch: string,
  commits: number,
): Promise<ChatLanding> {
  // Read before the merge, which deletes the branch it lands.
  const changes = await branchChangesAhead(project.repoPath, feature.branch, branch)
  let result: TempBranchMergeResult
  try {
    result = await featureLandingQueue(feature.id)(() =>
      mergeTempBranch(project.repoPath, feature.branch, branch),
    )
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  emit(ctx, feature.id, {
    type: result.ok ? 'chat.landed' : 'chat.land_failed',
    message: result.ok
      ? `landed ${commits} chat commit(s) on ${feature.branch}`
      : `could not land ${commits} chat commit(s) — kept on ${branch}: ${result.error ?? 'merge failed'}`,
    data: { branch, commits },
  })
  if (result.ok) emitLeadCodeLanded(ctx, feature, changes)
  return { branch, commits, result }
}

/** `lead.code_landed` for a landing that touched files outside the feature's docs. */
function emitLeadCodeLanded(
  ctx: AppCtx,
  feature: Feature,
  changes: { commits: CommitSummary[]; files: string[] },
): void {
  const docs = `${featureDocsRel(feature.slug)}/`
  const codeFiles = changes.files.filter((f) => !f.startsWith(docs)).length
  if (codeFiles === 0) return
  emit(ctx, feature.id, {
    type: 'lead.code_landed',
    message: `the agent's own fix landed: ${changes.commits.length} commit(s), ${codeFiles} file(s)`,
    data: {
      commits: changes.commits,
      files: codeFiles,
      afterRunId: listRunsByFeature(ctx, feature.id)[0]?.id ?? null,
    },
  })
}

/**
 * Land the chat's docs commits, if it is committing to a chat branch at all —
 * outside a burn it commits to the feature branch directly and there is nothing
 * to do.
 *
 * The chat's NEXT branch is cut before the landing starts, because the merge
 * deletes the branch it lands and would detach the worktree still holding it.
 * Cutting first also means a failed landing loses nothing: the new branch stands
 * on the same commit, so it carries the same work into the next attempt.
 */
export async function landChatCommits(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<ChatLanding | null> {
  const worktreePath = talkWorktree(project, feature)
  const branch = await chatBranchInWorktree(worktreePath)
  if (!branch) return null
  const commits = await branchCommitsAhead(project.repoPath, feature.branch, branch)
  if (commits.length === 0) return null
  // Deferred commits stay on THIS branch — no rollover — so the drive's stop
  // finds them where the chat left them.
  if (drivenNow(project, feature)) return deferLanding(ctx, feature, branch, commits.length)

  await startFreshChatBranch(ctx, feature, worktreePath)
  return await land(ctx, project, feature, branch, commits.length)
}

/**
 * A drive of this feature has just stopped and the main checkout has let go of
 * the feature branch: land what the chat committed while it drove (decision
 * 19), then give the talk worktree back as it would be without the drive.
 *
 * `detachedWorktree` is the talk worktree the drive's start detached, if it
 * did. Checking the branch back out there would orphan anything the lead
 * committed on that detached HEAD, so such commits are put on a chat branch
 * first and land like any other. Mid-round the chat keeps a chat branch (the
 * run still claims the feature branch); outside one it is handed back exactly
 * as at a run's end.
 */
export async function landChatCommitsAfterDrive(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  detachedWorktree: string | undefined,
): Promise<ChatLanding | null> {
  const worktreePath = talkWorktree(project, feature)
  if (detachedWorktree) {
    const head = await headSha(detachedWorktree, 'HEAD')
    const ahead = head ? await branchCommitsAhead(project.repoPath, feature.branch, head) : []
    if (ahead.length === 0 || !(await startFreshChatBranch(ctx, feature, detachedWorktree))) {
      await reattachWorktree(detachedWorktree, feature.branch)
      return null
    }
  }
  if (!(await chatBranchInWorktree(worktreePath))) return null
  return hasActiveRun(ctx, feature.id)
    ? await landChatCommits(ctx, project, feature)
    : await releaseTalkWorktreeAfterRun(ctx, project, feature)
}

/**
 * Hand the feature branch back at run end — success, failure or cancel alike,
 * because commits the chat made mid-run are the human's notes and which way the
 * burn went says nothing about whether they should survive.
 *
 * Anything the chat has not landed lands last, the worktree checks back out to
 * `feature/<slug>` at the new tip, and a chat branch that never carried a commit
 * is deleted. A branch whose landing did not succeed is KEPT, like every other
 * unmerged temp branch: the boot sweep's rule covers it from there.
 */
export async function releaseTalkWorktreeAfterRun(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<ChatLanding | null> {
  const worktreePath = talkWorktree(project, feature)
  const branch = await chatBranchInWorktree(worktreePath)
  if (!branch) {
    // Detached (the fallback park, or a pre-chat leftover) — restore it as before.
    await reattachWorktree(worktreePath, feature.branch)
    emit(ctx, feature.id, {
      type: 'chat.worktree_released',
      message: `returned the chat worktree to ${feature.branch}`,
      data: { branch: feature.branch, worktreePath },
    })
    return null
  }

  const commits = await branchCommitsAhead(project.repoPath, feature.branch, branch)
  // A drive still holding the branch keeps the worktree on its chat branch; the
  // drive's stop lands it and hands the worktree back.
  if (commits.length > 0 && drivenNow(project, feature)) {
    return deferLanding(ctx, feature, branch, commits.length)
  }
  const landed =
    commits.length > 0 ? await land(ctx, project, feature, branch, commits.length) : null

  await reattachWorktree(worktreePath, feature.branch)
  emit(ctx, feature.id, {
    type: 'chat.worktree_released',
    message: `returned the chat worktree to ${feature.branch}`,
    data: { branch: feature.branch, worktreePath },
  })
  // Only the empty branch is ours to delete: a successful landing already
  // deleted the branch it consumed, and an unlanded one holds real commits.
  if (commits.length === 0) {
    await deleteTempBranch(project.repoPath, branch)
    emit(ctx, feature.id, {
      type: 'chat.branch_deleted',
      message: `deleted empty chat branch ${branch}`,
      data: { branch },
    })
  }
  return landed
}
