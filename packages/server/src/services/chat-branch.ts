import type { Feature, Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
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
 *
 * Returns whether the feature branch is now free of the talk worktree.
 */
export async function parkTalkWorktreeForRun(project: Project, feature: Feature): Promise<boolean> {
  const worktreePath = talkWorktree(project, feature)
  if (await chatBranchInWorktree(worktreePath)) return true
  if (await startBranchInWorktree(worktreePath, nextChatBranch(feature.slug))) return true
  return await detachWorktree(worktreePath)
}

/**
 * The talk worktree for a session spawning while a branch-claiming run is live:
 * ensured as usual, then parked on a chat branch if it is not already — the case
 * where the run started before the feature had a worktree at all.
 */
export async function ensureTalkWorktreeDuringRun(
  project: Project,
  feature: Feature,
): Promise<string> {
  const worktreePath = await ensureTalkWorktree(project, feature)
  if (!(await chatBranchInWorktree(worktreePath))) {
    await startBranchInWorktree(worktreePath, nextChatBranch(feature.slug))
  }
  return worktreePath
}

/** What one chat landing did, for the timeline. `null` when there was nothing. */
export interface ChatLanding {
  /** The branch that was landed (or tried). */
  branch: string
  /** How many commits it carried. */
  commits: number
  result: TempBranchMergeResult
}

/**
 * Land the chat's commits on the feature branch through the feature's serial
 * queue — between two ticket landings, never across one.
 *
 * The chat's NEXT branch is cut before the landing starts, because the merge
 * deletes the branch it lands and would detach the worktree still holding it.
 * Cutting first also means a failed landing loses nothing: the new branch stands
 * on the same commit, so it carries the same work into the next attempt.
 */
export async function landChatCommits(
  project: Project,
  feature: Feature,
): Promise<ChatLanding | null> {
  const worktreePath = talkWorktree(project, feature)
  const branch = await chatBranchInWorktree(worktreePath)
  if (!branch) return null
  const commits = await branchCommitsAhead(project.repoPath, feature.branch, branch)
  if (commits.length === 0) return null

  await startBranchInWorktree(worktreePath, nextChatBranch(feature.slug))
  const result = await featureLandingQueue(feature.id)(() =>
    mergeTempBranch(project.repoPath, feature.branch, branch),
  )
  return { branch, commits: commits.length, result }
}

/** What the boundary at run end did, for the timeline. */
export interface ChatHandoff {
  /** The landing it ran last, if the chat had anything unlanded. */
  landed?: ChatLanding
  /** The empty chat branch it deleted, if there was one. */
  deleted?: string
}

/**
 * Hand the feature branch back at run end — success, failure or cancel alike.
 * Anything the chat has not landed lands last, the worktree checks back out to
 * `feature/<slug>` at the new tip, and a chat branch that never carried a commit
 * is deleted. A branch whose landing did not succeed is KEPT, like every other
 * unmerged temp branch: the boot sweep's rule covers it from there.
 */
export async function releaseTalkWorktreeAfterRun(
  project: Project,
  feature: Feature,
): Promise<ChatHandoff> {
  const worktreePath = talkWorktree(project, feature)
  const branch = await chatBranchInWorktree(worktreePath)
  if (!branch) {
    // Detached (the fallback park, or a pre-chat leftover) — restore it as before.
    await reattachWorktree(worktreePath, feature.branch)
    return {}
  }

  const commits = await branchCommitsAhead(project.repoPath, feature.branch, branch)
  const landed =
    commits.length > 0
      ? {
          branch,
          commits: commits.length,
          result: await featureLandingQueue(feature.id)(() =>
            mergeTempBranch(project.repoPath, feature.branch, branch),
          ),
        }
      : undefined

  await reattachWorktree(worktreePath, feature.branch)
  // Only the empty branch is ours to delete: a successful landing already
  // deleted the branch it consumed, and an unlanded one holds real commits.
  const deleted = commits.length === 0 && (await deleteTempBranch(project.repoPath, branch))
  return { ...(landed ? { landed } : {}), ...(deleted ? { deleted: branch } : {}) }
}
