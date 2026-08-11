import { Feature, Project, Run, SessionRow } from '@runcastle/core'
import type { FeatureStatus, Phase } from '@runcastle/core'
import { and, desc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { features, projects, runs, sessions } from '../db/schema'
import { NotFoundError } from '../errors'
import { emit } from './events'

/**
 * Data-access layer: row→wire mappers, basic getters, and the low-level phase /
 * status mutations shared by `features`, `gates` and the workflow runner.
 * Keeping these here (rather than in `features.ts`) breaks the would-be import
 * cycle between `features` and `gates` — both depend on `repo`, neither on the
 * other.
 *
 * Every mapper returns `Schema.parse(...)`, so the row→wire seam is where a row
 * that violates the domain contract stops. Drizzle's `$type<Phase>()` is a
 * compile-time cast with no runtime constraint, which means a value no build
 * recognises — a newer server's enum member, a hand-edited column, a bad import
 * — reads back as a well-typed lie and falls through every exhaustive switch
 * downstream at once (findings F19). Parsing here turns that into one named,
 * contained error. Deliberately uncaught: a corrupt row is not a degraded read.
 */

type FeatureSelect = typeof features.$inferSelect
type ProjectSelect = typeof projects.$inferSelect
type RunSelect = typeof runs.$inferSelect
type SessionSelect = typeof sessions.$inferSelect

export function rowToFeature(row: FeatureSelect): Feature {
  return Feature.parse({
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    title: row.title,
    oneLiner: row.oneLiner,
    mapped: row.mapped,
    lap: row.lap,
    phase: row.phase,
    branch: row.branch,
    baseBranch: row.baseBranch ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
  })
}

export function rowToProject(row: ProjectSelect): Project {
  return Project.parse({
    id: row.id,
    name: row.name,
    repoPath: row.repoPath,
    mainBranch: row.mainBranch,
    devCommand: row.devCommand ?? undefined,
    model: row.model ?? undefined,
    setupCommand: row.setupCommand ?? undefined,
    verifyCommands: row.verifyCommands ?? undefined,
    knownFailures: row.knownFailures ?? undefined,
    dbResetCommand: row.dbResetCommand ?? undefined,
    driveSetupCommand: row.driveSetupCommand ?? undefined,
    driveStopCommand: row.driveStopCommand ?? undefined,
    driveEnv: row.driveEnv ?? undefined,
    closedAt: row.closedAt ?? undefined,
  })
}

export function rowToRun(row: RunSelect): Run {
  return Run.parse({
    id: row.id,
    featureId: row.featureId,
    workflow: row.workflow,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    summary: row.summary ?? undefined,
  })
}

export function rowToSession(row: SessionSelect): SessionRow {
  return SessionRow.parse({
    id: row.id,
    featureId: row.featureId ?? undefined,
    projectId: row.projectId ?? undefined,
    kind: row.kind,
    ccSessionId: row.ccSessionId ?? undefined,
    transcriptPath: row.transcriptPath ?? undefined,
    status: row.status,
    awaitingInput: row.awaitingInput,
    worktreePath: row.worktreePath,
  })
}

// --- reads ------------------------------------------------------------------

export function tryGetFeature(ctx: AppCtx, id: string): Feature | null {
  const row = ctx.db.select().from(features).where(eq(features.id, id)).get()
  return row ? rowToFeature(row) : null
}

export function getFeatureRow(ctx: AppCtx, id: string): Feature {
  const feature = tryGetFeature(ctx, id)
  if (!feature) throw new NotFoundError(`feature ${id} not found`)
  return feature
}

/** Resolve a project by explicit id (the multi-project lookup). */
export function getProjectById(ctx: AppCtx, projectId: string): Project | null {
  const row = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
  return row ? rowToProject(row) : null
}

/**
 * Resolve a project by its repo path (open or closed). `openProject` upserts on
 * this so re-opening a known path returns the same row rather than a duplicate.
 */
export function getProjectByRepoPath(ctx: AppCtx, repoPath: string): Project | null {
  const row = ctx.db.select().from(projects).where(eq(projects.repoPath, repoPath)).get()
  return row ? rowToProject(row) : null
}

/** Every project row (open and closed) — for project-wide boot sweeps. */
export function allProjects(ctx: AppCtx): Project[] {
  return ctx.db.select().from(projects).all().map(rowToProject)
}

/** True while any feature of the project has a run in flight (blocks close). */
export function projectHasActiveRun(ctx: AppCtx, projectId: string): boolean {
  const row = ctx.db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(features, eq(runs.featureId, features.id))
    .where(and(eq(features.projectId, projectId), eq(runs.status, 'running')))
    .limit(1)
    .get()
  return !!row
}

/** Resolve a project by id or throw — used by CRUD mutations. */
export function requireProjectById(ctx: AppCtx, projectId: string): Project {
  const project = getProjectById(ctx, projectId)
  if (!project) throw new NotFoundError(`project ${projectId} not found`)
  return project
}

/** Resolve the project that owns a feature — the feature is the source of truth. */
export function projectForFeature(ctx: AppCtx, feature: Pick<Feature, 'projectId'>): Project {
  const project = getProjectById(ctx, feature.projectId)
  if (!project) throw new NotFoundError(`project ${feature.projectId} not found`)
  return project
}

export function getRunRow(ctx: AppCtx, id: string): Run {
  const row = ctx.db.select().from(runs).where(eq(runs.id, id)).get()
  if (!row) throw new NotFoundError(`run ${id} not found`)
  return rowToRun(row)
}

export function listRunsByFeature(ctx: AppCtx, featureId: string): Run[] {
  return ctx.db
    .select()
    .from(runs)
    .where(eq(runs.featureId, featureId))
    .orderBy(desc(runs.startedAt))
    .all()
    .map(rowToRun)
}

export function listSessionsByFeature(ctx: AppCtx, featureId: string): SessionRow[] {
  return ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.featureId, featureId))
    .all()
    .map(rowToSession)
}

export function hasActiveRun(ctx: AppCtx, featureId: string): boolean {
  const row = ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.featureId, featureId), eq(runs.status, 'running')))
    .limit(1)
    .get()
  return !!row
}

// --- phase / status mutations (each emits an event) -------------------------

/** Low-level phase setter used by `features.advance`, `gates.overrideGate`, the
 *  burn procedure and the runner's auto-advance. Emits one timeline event. */
export function setPhase(
  ctx: AppCtx,
  featureId: string,
  toPhase: Phase,
  eventType = 'phase.changed',
  message?: string,
): Feature {
  const current = getFeatureRow(ctx, featureId)
  ctx.db.update(features).set({ phase: toPhase }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: eventType,
    message: message ?? `phase ${current.phase} → ${toPhase}`,
    data: { from: current.phase, to: toPhase },
  })
  return { ...current, phase: toPhase }
}

export function setFeatureStatus(
  ctx: AppCtx,
  featureId: string,
  status: FeatureStatus,
): Feature {
  const current = getFeatureRow(ctx, featureId)
  ctx.db.update(features).set({ status }).where(eq(features.id, featureId)).run()
  emit(ctx, featureId, {
    type: 'feature.status',
    message: `status ${current.status} → ${status}`,
    data: { from: current.status, to: status },
  })
  return { ...current, status }
}
