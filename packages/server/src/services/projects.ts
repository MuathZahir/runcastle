import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Project } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { eq, isNull } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { projects } from '../db/schema'
import { InvalidInputError, isNotImplemented } from '../errors'
import { emitProject } from './events'
import { expandPath } from './fsbrowse'
import * as git from './git'
import {
  allProjects,
  getProjectByRepoPath,
  projectHasActiveRun,
  requireProjectById,
  rowToProject,
} from './repo'

/**
 * Project service (SPEC §3/§4, issue #43): the projects table is a real list.
 * `openProject` upserts by repo path (re-open returns the same project and
 * clears its closed state), `closeProject` hides a project (refusing while runs
 * are in flight), `listProjects` returns the open projects, `renameProject` sets
 * the display name. Opening detects and stores nothing about branches (decision
 * 4): every surface that cuts one names its own base, so there is no
 * project-level default left to refresh. Repo validation is B2's git service;
 * until B2 lands we tolerate its stub and fall back to a lightweight `.git`
 * existence check.
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
 * True when `repoPath` is a Windows drive served into Linux through a
 * translation layer (WSL DrvFS — `/mnt/<drive>/…`). From inside WSL such a
 * path *works*, silently, while git, installs, and burns all pay a per-file
 * 9P tax — usually the exact tax the user moved to WSL to escape (ADR-0005).
 * Pure; platform injectable for tests.
 */
export function isTranslatedWindowsMount(
  repoPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'linux' && /^\/mnt\/[a-z](\/|$)/i.test(repoPath)
}

/** Warn (as a project event) when an opened repo sits on a translated mount. */
function warnIfTranslatedMount(ctx: AppCtx, projectId: string, repoPath: string): void {
  if (!isTranslatedWindowsMount(repoPath)) return
  emitProject(ctx, projectId, {
    type: 'project.slow-path',
    message: `${repoPath} is a Windows drive mounted into Linux (/mnt) — git and burns pay a per-file translation tax here; clone the repo into the Linux filesystem (e.g. ~/projects) for native speed`,
  })
}

/**
 * Open a project at `repoPath`, upserting by path: a known path returns the same
 * project (and clears any closed state — a closed project reappears with its
 * features intact); an unknown path inserts a new one.
 */
export async function openProject(ctx: AppCtx, rawPath: string): Promise<Project> {
  // Normalize before anything touches the DB: `~/repo`, `./repo`, a trailing
  // slash and (on Windows) `C:/repo` vs `C:\repo` all name one directory, and
  // the picker always submits the fully-resolved form. Upserting on the raw
  // string would file those as separate projects.
  const repoPath = expandPath(rawPath)
  await assertRepoTolerant(ctx, repoPath)
  const name = basename(repoPath) || repoPath

  const existing = getProjectByRepoPath(ctx, repoPath) ?? findProjectByCanonPath(ctx, repoPath)
  if (existing) {
    ctx.db
      .update(projects)
      // Rewrite `repoPath` to the normalized form so a row stored raw by an
      // older build converges the first time it is re-opened.
      .set({ repoPath, closedAt: null })
      .where(eq(projects.id, existing.id))
      .run()
    // `closedAt: undefined` mirrors the column we just cleared — a re-opened
    // project must not return carrying the closed stamp it had a line ago.
    const reopened = { ...existing, repoPath, closedAt: undefined }
    emitProject(ctx, existing.id, {
      type: 'project.opened',
      message: `project ${existing.name} re-opened at ${repoPath}`,
    })
    warnIfTranslatedMount(ctx, existing.id, repoPath)
    return reopened
  }

  const row = {
    id: newId('proj'),
    name,
    repoPath,
    devCommand: null,
    closedAt: null,
  }
  const inserted = ctx.db.insert(projects).values(row).returning().get()
  const project = rowToProject(inserted)
  emitProject(ctx, project.id, {
    type: 'project.opened',
    message: `project ${name} at ${repoPath}`,
  })
  warnIfTranslatedMount(ctx, project.id, repoPath)
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

/**
 * Find a project whose stored path names the same directory as `repoPath`, for
 * rows written before paths were normalized (or written by hand). Falls back to
 * `git.canon` — the repo's existing canonical-key helper, which resolves
 * symlinks and folds Windows slash-direction/casing — so `C:\Repo\` and
 * `c:/repo` match the one project instead of forking it.
 */
function findProjectByCanonPath(ctx: AppCtx, repoPath: string): Project | null {
  const key = git.canon(repoPath)
  return allProjects(ctx).find((p) => git.canon(p.repoPath) === key) ?? null
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
