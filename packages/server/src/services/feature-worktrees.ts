import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Feature, Project } from '@runcastle/core'
import { worktreeDir, worktreesRoot } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { features } from '../db/schema'
import { activeSessionsForFeature } from '../launcher/sessions'
import { emit } from './events'
import * as git from './git'
import { allProjects, hasActiveRun } from './repo'

/**
 * Retiring a finished feature's talk worktree (`worktrees/<projectId>/<slug>`).
 * Every one is a full checkout of the target repo, and nothing reads it once the
 * feature has shipped or been archived — left alone they filled a disk. Removal
 * is always recoverable: the branch is never touched, and `ensureTalkWorktree`
 * re-adds a missing worktree the next time a session launches on the feature.
 *
 * All of it is best-effort. A worktree that cannot go is kept and named in an
 * event; it never fails the ship or archive that asked for it.
 */

/** Why a retirement left the worktree where it was. */
type KeptReason = 'a session is live on it' | 'a run is in progress' | 'uncommitted changes'

/**
 * Remove a just-shipped feature's talk worktree. Called after the merge landed,
 * so everything the worktree held is on the base — `--force` loses nothing a
 * session still needs. A live session or run keeps it (the boot sweep collects
 * it once they are gone).
 */
export async function retireShippedWorktree(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<void> {
  await retireWorktree(ctx, project, feature, { requireClean: false })
}

/**
 * Remove an archived feature's talk worktree, but ONLY when it is clean: an
 * archived branch may carry unmerged work, and `--force` would destroy whatever
 * was never committed. A dirty one is kept and the event says why.
 */
export async function retireArchivedWorktree(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
): Promise<void> {
  await retireWorktree(ctx, project, feature, { requireClean: true })
}

async function retireWorktree(
  ctx: AppCtx,
  project: Project,
  feature: Feature,
  opts: { requireClean: boolean },
): Promise<void> {
  const path = worktreeDir(project.id, feature.slug)
  const state = await git.worktreeState(path)
  if (state === 'missing') return

  const kept = keptReason(ctx, feature, state, opts)
  if (kept) {
    emit(ctx, feature.id, {
      type: 'feature.worktree_kept',
      message: `talk worktree kept — ${kept}`,
      data: { path, reason: kept },
    })
    return
  }

  if (await git.discardWorktree(project.repoPath, path)) {
    emit(ctx, feature.id, {
      type: 'feature.worktree_removed',
      message: 'talk worktree removed',
      data: { path },
    })
  } else {
    emit(ctx, feature.id, {
      type: 'feature.worktree_remove_failed',
      message: `could not remove the talk worktree at ${path} — a file may be locked`,
      data: { path },
    })
  }
}

function keptReason(
  ctx: AppCtx,
  feature: Feature,
  state: git.WorktreeState,
  opts: { requireClean: boolean },
): KeptReason | undefined {
  if (activeSessionsForFeature(ctx, feature.id).length > 0) return 'a session is live on it'
  if (hasActiveRun(ctx, feature.id)) return 'a run is in progress'
  // `unreadable` is kept too: git could not vouch that nothing would be lost.
  if (opts.requireClean && state !== 'clean') return 'uncommitted changes'
  return undefined
}

/** What one boot sweep did, for its single summary log line. */
export interface WorktreeSweep {
  /** Feature worktrees removed. */
  removed: number
  /** Feature worktrees left in place because they were dirty or unreadable. */
  kept: number
  /** Feature worktrees whose removal failed (a locked file, typically). */
  failed: number
  /** Whole `worktrees/<projectId>/` dirs removed because the project is gone. */
  orphanProjects: number
}

/**
 * Boot sweep of `worktrees/`: collect what ship/archive retirement missed — every
 * worktree from before it existed, and every one it kept or failed on.
 *
 * - A `<projectId>/` dir with no project row goes whole, with no git per slug —
 *   test runs leaked thousands of these, so this path has to be cheap.
 * - A `<slug>/` dir goes when its feature is shipped or archived and clean, or
 *   when no feature row matches and it is clean or not a git checkout at all.
 * - `_`-prefixed slugs (the project session's `__project`) and features that
 *   are still active or parked are never touched. A leading `_` on a PROJECT id
 *   means nothing — `newId` can mint one.
 *
 * Run after the stale-session and stale-run reconciliation, so nothing still
 * marked live holds a worktree it swept. NEVER throws.
 */
export async function sweepFeatureWorktrees(ctx: AppCtx): Promise<WorktreeSweep> {
  const sweep: WorktreeSweep = { removed: 0, kept: 0, failed: 0, orphanProjects: 0 }
  const root = worktreesRoot()
  const projectsById = new Map(allProjects(ctx).map((p) => [p.id, p]))
  const statusBySlug = new Map(
    ctx.db
      .select({ projectId: features.projectId, slug: features.slug, status: features.status })
      .from(features)
      .all()
      .map((f) => [`${f.projectId}/${f.slug}`, f.status]),
  )

  for (const projectId of subdirs(root)) {
    const project = projectsById.get(projectId)
    if (!project) {
      try {
        rmSync(join(root, projectId), { recursive: true, force: true })
        sweep.orphanProjects++
      } catch {
        sweep.failed++
      }
      continue
    }
    for (const slug of subdirs(join(root, projectId))) {
      if (slug.startsWith('_')) continue
      const status = statusBySlug.get(`${projectId}/${slug}`)
      if (status === 'active' || status === 'draft') continue

      const path = worktreeDir(projectId, slug)
      const state = await git.worktreeState(path)
      const removable = state === 'clean' || (status === undefined && state === 'not-a-checkout')
      if (!removable) {
        sweep.kept++
      } else if (await git.discardWorktree(project.repoPath, path, { attempts: 1 })) {
        sweep.removed++
      } else {
        sweep.failed++
      }
    }
  }
  return sweep
}

/** Names of the directories directly under `dir`; none when it is unreadable. */
function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}
