import type {
  Feature,
  FeatureStatus,
  Phase,
  Project,
  Run,
  SessionRow,
} from '@runcastle/core'
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
 */

type FeatureSelect = typeof features.$inferSelect
type ProjectSelect = typeof projects.$inferSelect
type RunSelect = typeof runs.$inferSelect
type SessionSelect = typeof sessions.$inferSelect

export function rowToFeature(row: FeatureSelect): Feature {
  return {
    id: row.id,
    projectId: row.projectId,
    slug: row.slug,
    title: row.title,
    oneLiner: row.oneLiner,
    size: row.size,
    mapped: row.mapped,
    phase: row.phase,
    branch: row.branch,
    status: row.status,
    createdAt: row.createdAt,
  }
}

export function rowToProject(row: ProjectSelect): Project {
  return {
    id: row.id,
    name: row.name,
    repoPath: row.repoPath,
    mainBranch: row.mainBranch,
    devCommand: row.devCommand ?? undefined,
  }
}

export function rowToRun(row: RunSelect): Run {
  return {
    id: row.id,
    featureId: row.featureId,
    workflow: row.workflow,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    summary: row.summary ?? undefined,
  }
}

export function rowToSession(row: SessionSelect): SessionRow {
  return {
    id: row.id,
    featureId: row.featureId,
    kind: row.kind,
    ccSessionId: row.ccSessionId ?? undefined,
    transcriptPath: row.transcriptPath ?? undefined,
    status: row.status,
    worktreePath: row.worktreePath,
  }
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

/** M1 is single-project: return the sole project row, or null before init. */
export function getProjectRow(ctx: AppCtx): Project | null {
  const row = ctx.db.select().from(projects).limit(1).get()
  return row ? rowToProject(row) : null
}

export function requireProject(ctx: AppCtx): Project {
  const project = getProjectRow(ctx)
  if (!project) throw new NotFoundError('no project initialised')
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
