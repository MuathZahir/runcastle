import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { eq, isNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { projects } from '../db/schema'
import { InvalidInputError, isNotImplemented } from '../errors'
import { emitProject } from './events'
import * as git from './git'
import { getProjectByRepoPath, projectHasActiveRun, requireProjectById, rowToProject } from './repo'

/**
 * Project service (SPEC §3/§4, issue #43): the projects table is a real list.
 * `openProject` upserts by repo path (re-open returns the same project and
 * clears its closed state), `closeProject` hides a project (refusing while runs
 * are in flight), `listProjects` returns the open projects, `renameProject` sets
 * the display name. Repo validation + main-branch detection are B2's git
 * service; until B2 lands we tolerate its stub and fall back to a lightweight
 * `.git` existence check + the configured default branch.
 *
 * Project-level events (open/close/rename) are emitted with `emitProject` — they
 * carry the project id and no feature id (issue #44), so a project stream shows
 * them alongside its feature events, per the events-are-the-UI's-lifeblood rule
 * (SPEC §12).
 */

/** Open projects (closed ones are hidden), newest-known first is not required. */
export function listProjects(ctx: AppCtx): Project[] {
  return ctx.db
    .select()
    .from(projects)
    .where(isNull(projects.closedAt))
    .all()
    .map(rowToProject)
}

/**
 * Open a project at `repoPath`, upserting by path: a known path returns the same
 * project (and clears any closed state — a closed project reappears with its
 * features intact); an unknown path inserts a new one.
 */
export async function openProject(ctx: AppCtx, repoPath: string): Promise<Project> {
  await assertRepoTolerant(ctx, repoPath)
  const mainBranch = await detectMainBranchTolerant(ctx, repoPath)
  const name = basename(repoPath) || repoPath

  const existing = getProjectByRepoPath(ctx, repoPath)
  if (existing) {
    ctx.db
      .update(projects)
      .set({ mainBranch, closedAt: null })
      .where(eq(projects.id, existing.id))
      .run()
    const reopened = { ...existing, mainBranch }
    emitProject(ctx, existing.id, {
      type: 'project.opened',
      message: `project ${existing.name} re-opened at ${repoPath} (${mainBranch})`,
    })
    return reopened
  }

  const row = {
    id: newId('proj'),
    name,
    repoPath,
    mainBranch,
    devCommand: null,
    closedAt: null,
  }
  const inserted = ctx.db.insert(projects).values(row).returning().get()
  const project = rowToProject(inserted)
  emitProject(ctx, project.id, {
    type: 'project.opened',
    message: `project ${name} at ${repoPath} (${mainBranch})`,
  })
  return project
}

/**
 * Hide a project. Refuses (destroying nothing) while any of its runs are in
 * flight; the project's features and rows are left intact so a later `open`
 * brings it back.
 */
export function closeProject(ctx: AppCtx, projectId: string): Project {
  const project = requireProjectById(ctx, projectId)
  if (projectHasActiveRun(ctx, projectId)) {
    throw new InvalidInputError(
      `cannot close ${project.name}: a run is in flight — wait for it to finish or cancel it first`,
    )
  }
  ctx.db.update(projects).set({ closedAt: Date.now() }).where(eq(projects.id, projectId)).run()
  emitProject(ctx, projectId, {
    type: 'project.closed',
    message: `project ${project.name} closed`,
  })
  return project
}

/** Set a project's display name. */
export function renameProject(ctx: AppCtx, projectId: string, name: string): Project {
  const project = requireProjectById(ctx, projectId)
  ctx.db.update(projects).set({ name }).where(eq(projects.id, projectId)).run()
  emitProject(ctx, projectId, {
    type: 'project.renamed',
    message: `project renamed ${project.name} → ${name}`,
    data: { from: project.name, to: name },
  })
  return { ...project, name }
}

// `updateProject` is retired (issue #46): a project's devCommand/model/sandbox
// overrides are written through the `settings` service now, not a project CRUD op.

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
