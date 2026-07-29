import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { PREPARED_KEYS } from '@runcastle/core'
import { projectWorktreesDir, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import {
  events,
  features,
  gateOverrides,
  projectFindings,
  projects,
  runs,
  sessions,
  tickets,
  waypoints,
} from '../db/schema'
import * as git from '../services/git'

/**
 * Dev-only state surgery, behind `bun run dev:tool` (see `scripts/devtool.ts`).
 *
 * Testing runcastle by hand needs operations the product deliberately refuses:
 * hard-delete a project (`closeProject` only hides one, and refuses while a run
 * is live), drop a feature regardless of state (`deleteFeature` refuses on a
 * shipped one), forget what preparation established, or empty the projects
 * table so the first-run wizard comes back. Those refusals are right for a real
 * install and wrong for a dev loop, so the bypass lives here — in ONE module,
 * where "this ignores the product's guards" is stated once — rather than being
 * sprinkled through the services as dev-mode branches.
 *
 * Deletion is therefore direct drizzle, not the services. Nothing here ships:
 * the published package bundles `src/index.ts` + `src/bin/runcastle.ts`
 * (`scripts/build-package.ts`), and no path from either reaches `src/dev/`.
 *
 * Caller's contract: `ctx` must point at the dev data dir. `scripts/devtool.ts`
 * enforces that before it opens the db; this module does not re-check, because
 * the paths it deletes (`worktreeDir`, `sessionDir`) are derived from whatever
 * data dir the caller configured.
 */

export type ProjectRow = typeof projects.$inferSelect
export type FeatureRow = typeof features.$inferSelect

/** Best-effort notes from a delete — surfaced by the CLI, never fatal. */
export type Note = string

export function allProjects(ctx: AppCtx): ProjectRow[] {
  return ctx.db.select().from(projects).all()
}

export function featuresOf(ctx: AppCtx, projectId: string): FeatureRow[] {
  return ctx.db.select().from(features).where(eq(features.projectId, projectId)).all()
}

/**
 * Resolve a project by id, then exact (case-insensitive) name, then unique name
 * prefix — `all` matches everything. The ladder exists so the common dev case is
 * `project rm myapp` rather than pasting a `proj_…` id read off a list.
 */
export function resolveProjects(ctx: AppCtx, target: string): ProjectRow[] {
  const all = allProjects(ctx)
  if (target === 'all') return all
  const byId = all.filter((p) => p.id === target)
  if (byId.length > 0) return byId
  const lower = target.toLowerCase()
  const byName = all.filter((p) => p.name.toLowerCase() === lower)
  if (byName.length > 0) return byName
  return all.filter((p) => p.name.toLowerCase().startsWith(lower))
}

/** Resolve a feature by id or slug (`all` matches everything). */
export function resolveFeatures(ctx: AppCtx, target: string): FeatureRow[] {
  const all = ctx.db.select().from(features).all()
  if (target === 'all') return all
  return all.filter((f) => f.id === target || f.slug === target)
}

export function projectOf(ctx: AppCtx, projectId: string): ProjectRow | null {
  return ctx.db.select().from(projects).where(eq(projects.id, projectId)).get() ?? null
}

/**
 * Hard-delete one feature: its talk worktree, its session artifact dirs, every
 * row keyed by it, and — only with `branches` — the `feature/<slug>` and
 * runcastle temp branches it left behind.
 *
 * Branch deletion is opt-in because the target repo is the developer's real one:
 * everything else this removes lives under the dev data dir, but branches do
 * not, and a dev reset silently deleting work in a real repo is a different
 * class of surprise. Worktree *deregistration* is not opt-in — a stale
 * `.git/worktrees` entry makes the next `git worktree add` for the same slug
 * fail, which would break the very re-test this enables.
 */
export async function removeFeature(
  ctx: AppCtx,
  project: ProjectRow,
  feature: FeatureRow,
  branches: boolean,
): Promise<Note[]> {
  const notes: Note[] = []

  try {
    await git.removeTalkWorktree(project.repoPath, worktreeDir(project.id, feature.slug))
  } catch (e) {
    // A locked or already-gone worktree must not strand the rest of the delete;
    // `pruneWorktrees` clears the registration either way.
    notes.push(`worktree for ${feature.slug} not cleanly removed (${describe(e)})`)
  }
  if (branches) {
    try {
      await git.deleteFeatureBranches(project.repoPath, feature.slug)
    } catch (e) {
      notes.push(`branches for ${feature.slug} not deleted (${describe(e)})`)
    }
  }

  for (const s of ctx.db.select().from(sessions).where(eq(sessions.featureId, feature.id)).all()) {
    rmBestEffort(sessionDir(s.id))
  }

  ctx.db.delete(tickets).where(eq(tickets.featureId, feature.id)).run()
  ctx.db.delete(sessions).where(eq(sessions.featureId, feature.id)).run()
  ctx.db.delete(runs).where(eq(runs.featureId, feature.id)).run()
  ctx.db.delete(events).where(eq(events.featureId, feature.id)).run()
  ctx.db.delete(gateOverrides).where(eq(gateOverrides.featureId, feature.id)).run()
  ctx.db.delete(waypoints).where(eq(waypoints.featureId, feature.id)).run()
  ctx.db.delete(features).where(eq(features.id, feature.id)).run()

  return notes
}

/**
 * Hard-delete a project: every feature, its preparation history and findings,
 * its project-scoped events (which outlive features by design — `feature.deleted`
 * carries a null feature id), then the row itself.
 */
export async function removeProject(
  ctx: AppCtx,
  project: ProjectRow,
  branches: boolean,
): Promise<Note[]> {
  const notes: Note[] = []
  for (const f of featuresOf(ctx, project.id)) {
    notes.push(...(await removeFeature(ctx, project, f, branches)))
  }

  ctx.db.delete(projectFindings).where(eq(projectFindings.projectId, project.id)).run()
  ctx.db.delete(events).where(eq(events.projectId, project.id)).run()
  ctx.db.delete(projects).where(eq(projects.id, project.id)).run()

  rmBestEffort(projectWorktreesDir(project.id))
  pruneWorktrees(project.repoPath)
  return notes
}

/**
 * Forget everything preparation established for a project: the provenance rows
 * and the prepared VALUES themselves.
 *
 * Clearing the values is the part that matters. `keysToPrepare` scopes a
 * conversation to whichever prepared columns are empty, so deleting only the
 * findings would leave the values in place and the next conversation would
 * correctly find nothing to do.
 *
 * Human-entered values go too. This is "prepare from scratch", which is the
 * thing that cannot otherwise be tested twice on one repo.
 */
export function resetPrep(ctx: AppCtx, project: ProjectRow): number {
  ctx.db.delete(projectFindings).where(eq(projectFindings.projectId, project.id)).run()
  ctx.db
    .update(projects)
    .set(Object.fromEntries(PREPARED_KEYS.map((k) => [k, null])))
    .where(eq(projects.id, project.id))
    .run()
  return PREPARED_KEYS.length
}

/** Counts for the `status` command. */
export interface DevCounts {
  projects: number
  openProjects: number
  features: number
  tickets: number
}

export function counts(ctx: AppCtx): DevCounts {
  const all = allProjects(ctx)
  return {
    projects: all.length,
    openProjects: all.filter((p) => p.closedAt === null).length,
    features: ctx.db.select().from(features).all().length,
    tickets: ctx.db.select().from(tickets).all().length,
  }
}

// --- helpers ---------------------------------------------------------------

export function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function rmBestEffort(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // A locked file leaves a stray dir behind; never worth failing a dev reset.
  }
}

/** Drop stale `.git/worktrees` registrations left by the deleted worktree dirs. */
export function pruneWorktrees(repoPath: string): void {
  try {
    execFileSync('git', ['-C', repoPath, 'worktree', 'prune'], { stdio: 'ignore' })
  } catch {
    // The repo may be gone, or never have been one — the DB rows still go.
  }
}
