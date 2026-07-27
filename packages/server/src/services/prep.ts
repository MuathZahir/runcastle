import type { PreparedKey, PrepRun, PrepStatus, Project } from '@runcastle/core'
import { PREPARED_KEYS, newId } from '@runcastle/core'
import { desc, eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { projectPreps } from '../db/schema'
import { InvalidInputError } from '../errors'
import type { PrepCtx, PrepDeps, PrepFindings } from '../workflows/project-prep'
import { prepHeadSha, prepRun, resolvePrepDeps } from '../workflows/project-prep'
import { emitProject } from './events'
import { isOverwritable, recordFinding, unsetPreparedKeys } from './findings'
import { requireProjectById } from './repo'

/**
 * Project preparation service — the run bookkeeping and the write-back.
 *
 * Preparation is project-scoped and deliberately does NOT go through
 * `runner.startRun`: a run is feature-scoped by construction (`runs.feature_id`
 * is NOT NULL, and the finalizer advances feature phases and sweeps tickets),
 * while preparation belongs to the project and normally happens before any
 * feature exists. It keeps the parts that matter — a row, an AbortController,
 * a streamed event timeline — without pushing a null feature through paths that
 * assume one.
 *
 * It is also non-blocking by design. `openProject` returns immediately and
 * preparation runs behind it: the only consumer of the findings is a burn,
 * which is several gates downstream, so there is no reason to make anyone watch
 * a progress bar before they can start a feature.
 */

/** In-flight preparation runs, by project id (at most one per project). */
const controllers = new Map<string, { runId: string; controller: AbortController }>()

export interface StartPrepOptions {
  /**
   * Re-measure fields a PREVIOUS PREPARATION RUN established, not just the
   * empty ones — what the "re-prepare" action does when a baseline has gone
   * stale. Human-entered values are never in scope either way (see
   * {@link isOverwritable}); clearing a field is how you hand it back.
   */
  refresh?: boolean
  /** Restrict the run to these keys (default: everything in scope). */
  keys?: readonly PreparedKey[]
  /** Test seam: inject fake deps instead of resolving the real sandcastle path. */
  deps?: PrepDeps
}

export interface StartPrepResult {
  prepId: string
  /** The keys the run will try to establish (empty → nothing to do). */
  keys: PreparedKey[]
  /** Resolves when the run finalizes; tests await it, callers may ignore it. */
  done: Promise<void>
}

/** True while a preparation run for this project is in flight IN THIS PROCESS. */
export function isPreparing(projectId: string): boolean {
  return controllers.has(projectId)
}

/**
 * Which keys a run should try to establish.
 *
 * Base scope is every prepared key that is currently EMPTY. `refresh` widens it
 * to already-set keys as well, so a re-prepare can replace a stale baseline
 * rather than skipping it as "already answered". Both are then filtered through
 * provenance, which removes anything a human typed.
 */
export function keysToPrepare(
  ctx: AppCtx,
  project: Project,
  opts: Pick<StartPrepOptions, 'refresh' | 'keys'> = {},
): PreparedKey[] {
  const unset = new Set<PreparedKey>(unsetPreparedKeys(project))
  const candidates = opts.keys ?? (opts.refresh ? PREPARED_KEYS : [...unset])
  return candidates.filter(
    (key) => (opts.refresh || unset.has(key)) && isOverwritable(ctx, project.id, key),
  )
}

/**
 * Start a preparation run for a project. Returns as soon as the row exists —
 * the agent works in the background and reports through project events.
 *
 * Refuses a second concurrent run for the same project: two agents measuring
 * the same repo would race on the write-back and one would silently win.
 */
export async function startPrep(
  ctx: AppCtx,
  projectId: string,
  opts: StartPrepOptions = {},
): Promise<StartPrepResult> {
  const project = requireProjectById(ctx, projectId)
  if (controllers.has(projectId)) {
    throw new InvalidInputError(`${project.name} is already being prepared`)
  }

  const keys = keysToPrepare(ctx, project, opts)
  const prepId = newId('prep')
  const headSha = await prepHeadSha(project)

  ctx.db
    .insert(projectPreps)
    .values({
      id: prepId,
      projectId,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      summary: null,
      headSha: headSha ?? null,
    })
    .run()

  emitProject(ctx, projectId, {
    type: 'prep.run.started',
    message:
      keys.length === 0
        ? `preparing ${project.name} — nothing left to establish`
        : `preparing ${project.name} — ${keys.length} field(s) to establish`,
    data: { prepId, keys },
  })

  const controller = new AbortController()
  controllers.set(projectId, { runId: prepId, controller })

  const prepCtx: PrepCtx = {
    project,
    keys,
    emitEvent: (e) => {
      emitProject(ctx, projectId, { type: e.type, message: e.message, data: e.data })
    },
    signal: controller.signal,
  }

  const deps = opts.deps ?? resolvePrepDeps(project)
  const done = finalize(ctx, project, prepId, prepCtx, deps, controller, headSha)
  return { prepId, keys, done }
}

/** Cancel an in-flight preparation run; no-op when none is running. */
export function cancelPrep(projectId: string): void {
  controllers.get(projectId)?.controller.abort()
}

async function finalize(
  ctx: AppCtx,
  project: Project,
  prepId: string,
  prepCtx: PrepCtx,
  deps: PrepDeps,
  controller: AbortController,
  headSha: string | undefined,
): Promise<void> {
  let status: PrepStatus = 'failed'
  let summary = 'preparation failed'
  let findings: PrepFindings | undefined

  try {
    const result = await prepRun(prepCtx, deps)
    status = result.status === 'succeeded' ? 'succeeded' : 'failed'
    summary = result.summary
    findings = result.findings
  } catch (e) {
    if (controller.signal.aborted) {
      status = 'cancelled'
      summary = 'preparation cancelled'
    } else {
      status = 'failed'
      summary = e instanceof Error ? e.message : 'preparation failed'
    }
  } finally {
    controllers.delete(project.id)
  }

  // Apply BEFORE finalizing the row, so a client that sees `succeeded` can read
  // the findings in the same poll rather than racing the write-back.
  const applied = findings ? applyFindings(ctx, project, findings, headSha) : []

  ctx.db
    .update(projectPreps)
    .set({ status, endedAt: Date.now(), summary })
    .where(eq(projectPreps.id, prepId))
    .run()

  emitProject(ctx, project.id, {
    type: 'prep.run.finished',
    message: `preparation ${status}: ${summary}`,
    data: { prepId, status, summary, applied },
  })
}

/**
 * Write the agent's findings to the project, honouring provenance: a value a
 * human typed is skipped (and reported as skipped), everything else is written
 * with its evidence and the sha it was measured at. Returns the keys applied.
 *
 * The re-check against `isOverwritable` is not redundant with the one that
 * built the key list: a preparation run can take many minutes, and a human may
 * have answered a field in the settings UI while the agent was measuring it.
 * The human's answer wins.
 */
export function applyFindings(
  ctx: AppCtx,
  project: Project,
  findings: PrepFindings,
  headSha: string | undefined,
): PreparedKey[] {
  const applied: PreparedKey[] = []
  for (const [key, finding] of Object.entries(findings.values) as [PreparedKey, { value: string; evidence?: string }][]) {
    if (!isOverwritable(ctx, project.id, key)) {
      emitProject(ctx, project.id, {
        type: 'prep.skipped_field',
        message: `kept your ${key} — preparation proposed "${truncate(finding.value)}" but you set this by hand`,
        data: { key, proposed: finding.value },
      })
      continue
    }
    recordFinding(ctx, project.id, {
      key,
      value: finding.value,
      source: 'prep',
      ...(finding.evidence ? { evidence: finding.evidence } : {}),
      ...(headSha ? { establishedSha: headSha } : {}),
    })
    applied.push(key)
    emitProject(ctx, project.id, {
      type: 'prep.established',
      message: `${key}: ${truncate(finding.value)}`,
      data: { key, value: finding.value, evidence: finding.evidence },
    })
  }

  if (findings.notes) {
    emitProject(ctx, project.id, {
      type: 'prep.notes',
      message: `preparation notes: ${findings.notes}`,
      data: { notes: findings.notes },
    })
  }
  return applied
}

/** One-line preview of a value for an event message. */
function truncate(value: string, max = 120): string {
  const oneLine = value.replace(/\s*\n\s*/g, ' · ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

/** The most recent preparation run for a project, or `null`. */
export function latestPrep(ctx: AppCtx, projectId: string): PrepRun | null {
  const row = ctx.db
    .select()
    .from(projectPreps)
    .where(eq(projectPreps.projectId, projectId))
    .orderBy(desc(projectPreps.startedAt))
    .get()
  if (!row) return null
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    startedAt: row.startedAt,
    ...(row.endedAt !== null ? { endedAt: row.endedAt } : {}),
    ...(row.summary !== null ? { summary: row.summary } : {}),
    ...(row.headSha !== null ? { headSha: row.headSha } : {}),
  }
}

/**
 * Reconcile preparation rows left `running` by a server that died mid-run (or a
 * `bun --hot` reload). A row with no controller in this process has no agent
 * behind it and can never finish on its own.
 */
export function reconcilePreps(ctx: AppCtx): number {
  const stale = ctx.db
    .select({ id: projectPreps.id, projectId: projectPreps.projectId })
    .from(projectPreps)
    .where(eq(projectPreps.status, 'running'))
    .all()
    .filter((row) => !controllers.has(row.projectId))

  for (const row of stale) {
    ctx.db
      .update(projectPreps)
      .set({ status: 'failed', endedAt: Date.now(), summary: 'server stopped while preparing' })
      .where(eq(projectPreps.id, row.id))
      .run()
  }
  return stale.length
}

/** Test-only: forget in-memory prep state (no router calls this). */
export function __resetPrepState(): void {
  controllers.clear()
}
