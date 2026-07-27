import type { RunStatus, WorkflowCtx } from '@runcastle/core'
import { newId, nextGate, nextPhase } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { runs } from '../db/schema'
import { NotFoundError } from '../errors'
import { emit } from '../services/events'
import { checkGate } from '../services/gates'
import { detachWorktree, reattachWorktree } from '../services/git'
import { getFeatureRow, projectForFeature, setPhase } from '../services/repo'
import { listByFeature, sweepOrphanedBurning, updateTicket } from '../services/tickets'
import { claim as claimWaypoint, releaseForSession, resolve as resolveWaypoint } from '../services/waypoints'
import { getWorkflow } from './registry'

/**
 * Workflow runner (SPEC §3, task item 6). `startRun` creates the run row, wires
 * a `WorkflowCtx` to live services (emitEvent→events, updateTicket→tickets,
 * signal from a per-run AbortController), invokes the registered `WorkflowDef`,
 * catches, and finalizes the run row + a `run.finished` event. On a succeeded
 * run it auto-advances the feature to `review` when gate G4 passes.
 *
 * The workflow itself runs in the background (AFK); `startRun` returns as soon
 * as the run row exists. `done` resolves when the run finalizes — the tRPC
 * `feature.burn` procedure ignores it (returns `{ runId }`); tests await it.
 */

const controllers = new Map<string, AbortController>()

/**
 * Workflows that CLAIM the feature branch for the run's whole duration: their
 * sandcastle branch strategy checks `feature/<slug>` out in its own worktree,
 * so the talk worktree must be detached first (git forbids one branch in two
 * worktrees) and HITL terminals are refused while such a run is live. The
 * `research` workflow works on a per-run temp branch (`runcastle/research/...`)
 * merged back at finalize, so it claims nothing — the talk worktree stays
 * attached and HITL runs in parallel (ADR-0001 §7 "serial HITL, PARALLEL AFK").
 *
 * This flag arguably belongs on `WorkflowDef` itself (core-owned `workflow.ts`);
 * kept as a server-side map until core can change.
 */
const BRANCH_CLAIMING = new Set(['ticket-burner'])

/** Whether a workflow's run holds the feature branch (see `BRANCH_CLAIMING`). */
export function workflowClaimsFeatureBranch(workflowId: string): boolean {
  return BRANCH_CLAIMING.has(workflowId)
}

/**
 * Whether a run is genuinely in flight IN THIS PROCESS (its AbortController is
 * registered). Boot reconciliation uses this to skip runs still being driven
 * across a `bun --hot` reload rather than falsely failing them.
 */
export function isRunActive(runId: string): boolean {
  return controllers.has(runId)
}

export interface StartRunResult {
  runId: string
  done: Promise<void>
}

export interface StartRunOptions {
  /**
   * Per-run payload exposed to the workflow as `ctx.input` (SPEC §13.1). The
   * research workflow receives the `Waypoint` it works here.
   */
  input?: unknown
  /**
   * Claim this waypoint for the run before it starts (SPEC §13.2 research path):
   * the claim uses the fresh `runId` as claimant, is transactional (a waypoint no
   * longer on the frontier throws), and is auto-released by the finalizer if the
   * workflow does not resolve it. On a failed claim the run row is finalized as
   * failed and the error rethrown, so no orphaned run lingers.
   */
  claimWaypointId?: string
  /**
   * Per-run model override (issue #48) exposed to the workflow as
   * `ctx.modelOverride`; wins the `resolveModel` chain for the run's AFK agent.
   */
  modelOverride?: string
}

export async function startRun(
  ctx: AppCtx,
  featureId: string,
  workflowId: string,
  opts: StartRunOptions = {},
): Promise<StartRunResult> {
  const feature = getFeatureRow(ctx, featureId)
  const project = projectForFeature(ctx, feature)
  const def = getWorkflow(workflowId)
  if (!def) throw new NotFoundError(`workflow ${workflowId} not registered`)

  const tickets = listByFeature(ctx, featureId)

  const runId = newId('run')
  ctx.db
    .insert(runs)
    .values({
      id: runId,
      featureId,
      workflow: workflowId,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      summary: null,
    })
    .run()

  // A research run claims its waypoint with the run id as claimant BEFORE any
  // work starts (SPEC §13.2). A failed claim (no longer on the frontier) must not
  // leave a dangling `running` row: finalize it failed and rethrow.
  if (opts.claimWaypointId) {
    try {
      claimWaypoint(ctx, opts.claimWaypointId, runId)
    } catch (e) {
      const summary = e instanceof Error ? e.message : 'claim failed'
      ctx.db.update(runs).set({ status: 'failed', endedAt: Date.now(), summary }).where(eq(runs.id, runId)).run()
      throw e
    }
  }

  emit(ctx, featureId, {
    type: 'run.started',
    message: `run started (${workflowId})`,
    runId,
    data: { workflow: workflowId },
  })

  const controller = new AbortController()
  controllers.set(runId, controller)

  // Free the feature branch for the workflow's own worktree (SPEC §8) — ONLY
  // for branch-claiming workflows: a live talk worktree holds `feature/<slug>`
  // checked out, which git refuses to let the sandcastle burner check out again
  // ('already used by worktree'). Detach it for the duration of the run;
  // reattach best-effort when the run finalizes. Non-claiming workflows
  // (research: per-run temp branch) skip the dance entirely, so the talk
  // worktree — and any live HITL session inside it — is never yanked onto a
  // detached HEAD by a run (ADR-0001 §7).
  const talkWorktree = worktreeDir(project.id, feature.slug)
  const talkDetached = workflowClaimsFeatureBranch(workflowId)
    ? await detachWorktree(talkWorktree)
    : false

  const wctx: WorkflowCtx = {
    project,
    feature,
    tickets,
    emitEvent: (e) => {
      emit(ctx, featureId, {
        type: e.type,
        message: e.message,
        ticketId: e.ticketId,
        data: e.data,
        runId,
      })
    },
    updateTicket: (id, patch) => {
      updateTicket(ctx, id, patch)
    },
    input: opts.input,
    modelOverride: opts.modelOverride,
    resolveWaypoint: (id, disposition, summary) => {
      resolveWaypoint(ctx, id, disposition, summary)
    },
    signal: controller.signal,
  }

  const done = executeRun(ctx, runId, featureId, workflowId, def.run(wctx), controller, async () => {
    if (talkDetached) await reattachWorktree(talkWorktree, feature.branch)
  })
  return { runId, done }
}

/** Cancel an in-flight run (aborts its signal); no-op if unknown/finished. */
export function cancelRun(runId: string): void {
  controllers.get(runId)?.abort()
}

async function executeRun(
  ctx: AppCtx,
  runId: string,
  featureId: string,
  workflow: string,
  runPromise: Promise<{ status: 'succeeded' | 'failed'; summary: string }>,
  controller: AbortController,
  cleanup?: () => Promise<void>,
): Promise<void> {
  let status: RunStatus = 'failed'
  let summary = 'run failed'
  try {
    const result = await runPromise
    status = result.status
    summary = result.summary
  } catch (e) {
    if (controller.signal.aborted) {
      status = 'cancelled'
      summary = 'run cancelled'
    } else {
      status = 'failed'
      summary = e instanceof Error ? e.message : 'run failed'
    }
    emit(ctx, featureId, { type: 'run.error', message: summary, runId })
  } finally {
    controllers.delete(runId)
  }

  ctx.db.update(runs).set({ status, endedAt: Date.now(), summary }).where(eq(runs.id, runId)).run()
  // A run that worked a waypoint (research) auto-releases it if it did not resolve
  // it itself (SPEC §13.2 run finalizer); no-op for ticket-burner runs.
  releaseForSession(ctx, runId)
  // Mirror for tickets: the burner normally lands every lane itself, but a
  // workflow that threw between "mark burning" and the outcome write (or an
  // abort that raced the ticket's own handler) leaves a `burning` row with no
  // agent behind it — a state nothing else can move (see `sweepOrphanedBurning`).
  // Only branch-claiming workflows own tickets, so only they sweep; a no-op when
  // the run ended cleanly.
  if (workflowClaimsFeatureBranch(workflow)) {
    sweepOrphanedBurning(ctx, featureId, `orphaned — the run ended (${status}) while it was burning`)
  }
  emit(ctx, featureId, {
    type: 'run.finished',
    message: `run ${status}: ${summary}`,
    runId,
    data: { status, summary },
  })

  if (status === 'succeeded') maybeAutoAdvance(ctx, featureId)

  if (cleanup) {
    try {
      await cleanup()
    } catch {
      // best-effort talk-worktree reattach — never fail a finalized run on it
    }
  }
}

/** After a succeeded run, advance to `review` if G4 (all-tickets-terminal). */
function maybeAutoAdvance(ctx: AppCtx, featureId: string): void {
  const feature = getFeatureRow(ctx, featureId)
  const gate = nextGate(feature)
  if (!gate || gate.check !== 'all-tickets-terminal') return
  if (!checkGate(ctx, gate.check, feature).satisfied) return
  const next = nextPhase(feature)
  if (next) setPhase(ctx, featureId, next, 'phase.advanced', 'auto-advanced to review after successful run')
}
