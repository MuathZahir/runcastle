import type { RunStatus, WorkflowCtx } from '@runcastle/core'
import { newId, nextGate, nextPhase, worktreeDir } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { runs } from '../db/schema'
import { NotFoundError } from '../errors'
import { emit } from '../services/events'
import { checkGate } from '../services/gates'
import { detachWorktree, reattachWorktree } from '../services/git'
import { getFeatureRow, requireProject, setPhase } from '../services/repo'
import { listByFeature, updateTicket } from '../services/tickets'
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

export interface StartRunResult {
  runId: string
  done: Promise<void>
}

export async function startRun(
  ctx: AppCtx,
  featureId: string,
  workflowId: string,
): Promise<StartRunResult> {
  const feature = getFeatureRow(ctx, featureId)
  const project = requireProject(ctx)
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
  emit(ctx, featureId, {
    type: 'run.started',
    message: `run started (${workflowId})`,
    runId,
    data: { workflow: workflowId },
  })

  const controller = new AbortController()
  controllers.set(runId, controller)

  // Free the feature branch for the workflow's own worktree (SPEC §8): a live
  // talk worktree holds `feature/<slug>` checked out, which git refuses to let
  // the sandcastle burner check out again ('already used by worktree'). Detach it
  // for the duration of the run; reattach best-effort when the run finalizes.
  // No-op when no talk worktree exists (non-burner workflows, headless runs).
  const talkWorktree = worktreeDir(project.id, feature.slug)
  const talkDetached = await detachWorktree(talkWorktree)

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
    signal: controller.signal,
  }

  const done = executeRun(ctx, runId, featureId, def.run(wctx), controller, async () => {
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
