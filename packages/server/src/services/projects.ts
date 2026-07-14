import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { projects } from '../db/schema'
import { InvalidInputError, isNotImplemented } from '../errors'
import { emit } from './events'
import * as git from './git'
import { getProjectRow, rowToProject } from './repo'

/**
 * Project service (SPEC §3/§4). M1 is single-project: `initProject` creates (or
 * re-points) the sole project row. Repo validation + main-branch detection are
 * B2's git service; until B2 lands we tolerate its stub and fall back to a
 * lightweight `.git` existence check + the configured default branch, so the UI
 * is usable end-to-end before wave B.
 */

export function getProject(ctx: AppCtx): Project | null {
  return getProjectRow(ctx)
}

export async function initProject(ctx: AppCtx, repoPath: string): Promise<Project> {
  await assertRepoTolerant(ctx, repoPath)
  const mainBranch = await detectMainBranchTolerant(ctx, repoPath)
  const name = basename(repoPath) || repoPath

  const existing = getProjectRow(ctx)
  if (existing) {
    ctx.db
      .update(projects)
      .set({ repoPath, mainBranch, name })
      .where(eq(projects.id, existing.id))
      .run()
    const updated = { ...existing, repoPath, mainBranch, name }
    emit(ctx, existing.id, {
      type: 'project.reinitialised',
      message: `project re-pointed at ${repoPath} (${mainBranch})`,
    })
    return updated
  }

  const row = {
    id: newId('proj'),
    name,
    repoPath,
    mainBranch,
    devCommand: null,
  }
  const inserted = ctx.db.insert(projects).values(row).returning().get()
  const project = rowToProject(inserted)
  emit(ctx, project.id, {
    type: 'project.initialised',
    message: `project ${name} at ${repoPath} (${mainBranch})`,
  })
  return project
}

export function updateProject(
  ctx: AppCtx,
  patch: { devCommand?: string },
): Project {
  const existing = getProjectRow(ctx)
  if (!existing) throw new InvalidInputError('no project to update')
  const set: { devCommand?: string | null } = {}
  if (patch.devCommand !== undefined) set.devCommand = patch.devCommand
  ctx.db.update(projects).set(set).where(eq(projects.id, existing.id)).run()
  emit(ctx, existing.id, {
    type: 'project.updated',
    message: 'project settings updated',
    data: patch,
  })
  return { ...existing, devCommand: patch.devCommand ?? existing.devCommand }
}

// --- B2 tolerance -----------------------------------------------------------

async function assertRepoTolerant(ctx: AppCtx, repoPath: string): Promise<void> {
  void ctx
  try {
    await git.assertRepo(repoPath)
  } catch (e) {
    if (!isNotImplemented(e)) throw e
    // Fallback until B2: a git repo has a `.git` dir (or file, for worktrees).
    if (!existsSync(join(repoPath, '.git'))) {
      throw new InvalidInputError(`not a git repository: ${repoPath}`)
    }
  }
}

async function detectMainBranchTolerant(ctx: AppCtx, repoPath: string): Promise<string> {
  try {
    return await git.detectMainBranch(repoPath)
  } catch (e) {
    if (!isNotImplemented(e)) throw e
    return ctx.config.mainBranch
  }
}
