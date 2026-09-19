import type { Feature, Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { emit } from './events'
import type { TempBranchMergeResult } from './git'
import {
  branchCommitsAhead,
  chatBranchInWorktree,
  chatBranchName,
  deleteTempBranch,
  detachWorktree,
  ensureTalkWorktree,
  mergeTempBranch,
  reattachWorktree,
  startBranchInWorktree,
} from './git'
import { featureLandingQueue } from './landing-queue'

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
  const branch = nextChatBranch(feature.slug)
  if (await startBranchInWorktree(worktreePath, branch)) {
    emit(ctx, feature.id, {
      type: 'chat.worktree_parked',
      message: `parked the chat worktree on ${branch}`,
      data: { branch, worktreePath },
    })
    return
  }
  await detachWorktree(worktreePath)
  emit(ctx, feature.id, {
    type: 'chat.worktree_detached',
    message: 'detached the chat worktree while the run holds the feature branch',
    data: { worktreePath },
  })
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
  const worktreePath = await ensureTalkWorktree(project, feature)
  if (!(await chatBranchInWorktree(worktreePath))) {
    const branch = nextChatBranch(feature.slug)
    if (await startBranchInWorktree(worktreePath, branch)) {
      emit(ctx, feature.id, {
        type: 'chat.worktree_parked',
        message: `parked the chat worktree on ${branch}`,
        data: { branch, worktreePath },
      })
    } else {
      await detachWorktree(worktreePath)
      emit(ctx, feature.id, {
        type: 'chat.worktree_detached',
        message: 'detached the chat worktree while the run holds the feature branch',
        data: { worktreePath },
      })
    }
  }
  return worktreePath
}

/** What one chat landing did. `null` from a call that had nothing to land. */
export interface ChatLanding {
  /** The branch that was landed (or tried). */
  branch: string
  /** How many commits it carried. */
  commits: number
  result: TempBranchMergeResult
}

/**
 * Put `branch` on the feature branch through the feature's serial queue —
 * between two ticket landings, never across one — and say so on the timeline.
 * A landing that throws is reported as a failed one: the chat's docs are a
 * best-effort checkpoint and must never break the tool call or the run finalizer
 * that asked for it.
 */
async function land(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  branch: string,
  commits: number,
): Promise<ChatLanding> {
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
  return { branch, commits, result }
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

  await startBranchInWorktree(worktreePath, nextChatBranch(feature.slug))
  return await land(ctx, project, feature, branch, commits.length)
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
