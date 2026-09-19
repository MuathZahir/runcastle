import type { RunStatus, Ticket, WorkflowCtx } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { runs } from '../db/schema'
import { NotFoundError } from '../errors'
import { emit } from '../services/events'
import { detachWorktree, reattachWorktree } from '../services/git'
import { getFeatureRow, projectForFeature, setPhase } from '../services/repo'
import { listByFeature as listFindingsByFeature, markFixProgress } from '../services/review-findings'
import { listByFeature, storeTickets, sweepOrphanedBurning, updateTicket } from '../services/tickets'
import { claim as claimWaypoint, releaseForSession, resolve as resolveWaypoint } from '../services/waypoints'
import type { KillOutcome } from './kill-registry'
import { killRegistry } from './kill-registry'
import { getWorkflow } from './registry'

/**
 * Workflow runner (SPEC §3, task item 6). `startRun` creates the run row, wires
 * a `WorkflowCtx` to live services (emitEvent→events, updateTicket→tickets,
 * signal from a per-run AbortController), invokes the registered `WorkflowDef`,
 * catches, and finalizes the run row + a `run.finished` event. On a succeeded
 * run it auto-advances a `building` feature to `review`.
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
  /**
   * Restrict this run to these tickets. Unset (the normal burn) means the
   * feature's whole ticket set, which is what "Burn" has always meant.
   *
   * Set by the agentic-review mint, which is a request for ONE review pass, not
   * for the pending fix queue sitting beside it: scoping only `tickets` would
   * not be enough, because the scheduler re-reads the store when a review
   * settles (`admitNewTickets`) and would fold that queue in a moment later. So
   * the scope also narrows `listTickets`, by hiding exactly the rows that
   * existed at run start and were left out — tickets minted DURING the run (a
   * review's own fix tickets) are never hidden and still join it.
   */
  ticketIds?: string[]
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

  const opened = listByFeature(ctx, featureId)
  const scope = opts.ticketIds ? new Set(opts.ticketIds) : undefined
  const tickets = scope ? opened.filter((t) => scope.has(t.id)) : opened
  /** Rows the scope left behind — hidden from the run's re-reads, forever. */
  const excluded = new Set(scope ? opened.filter((t) => !scope.has(t.id)).map((t) => t.id) : [])
  const listRunTickets = (): Ticket[] => {
    const rows = listByFeature(ctx, featureId)
    return excluded.size === 0 ? rows : rows.filter((t) => !excluded.has(t.id))
  }

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
    runId,
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
    listTickets: listRunTickets,
    storeTickets: (inputs) => storeTickets(ctx, featureId, inputs),
    listFindings: () => listFindingsByFeature(ctx, featureId),
    updateFinding: (findingId, progress, reason) => {
      markFixProgress(ctx, findingId, progress, reason)
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

/**
 * Cancel an in-flight run: abort its signal, then kill every agent it has
 * running and wait, bounded, for them to be gone. No-op if unknown/finished.
 *
 * The abort alone only interrupts sandcastle's fiber — the containers keep
 * burning and keep streaming events — so the kill is what actually ends the
 * run, and what makes each lane's `run()` reject into the failure path that
 * writes its terminal state. That path waits on the same kill before it writes
 * anything (see `executeRun`), so the run row cannot read cancelled ahead of
 * the agents dying. `confirmed: false` means at least one agent outlived the
 * kill's deadline and may still be running.
 */
export async function cancelRun(runId: string): Promise<KillOutcome> {
  controllers.get(runId)?.abort()
  return await killRegistry().killAllForRun(runId)
}

async function executeRun(
  ctx: AppCtx,
  runId: string,
  featureId: string,
  workflow: string,
  runPromise: Promise<{ status: 'succeeded' | 'failed'; summary: string; digest?: string }>,
  controller: AbortController,
  cleanup?: () => Promise<void>,
): Promise<void> {
  let status: RunStatus = 'failed'
  let summary = 'run failed'
  // The workflow's long-form account of what this run produced, if it kept one.
  let digest: string | undefined
  // Whether the workflow threw: its `run.error` breadcrumb waits behind the kill
  // gate with the row it describes, rather than announcing a cancel that has not
  // happened yet.
  let threw = false
  try {
    const result = await runPromise
    status = result.status
    summary = result.summary
    digest = result.digest
  } catch (e) {
    if (controller.signal.aborted) {
      status = 'cancelled'
      summary = 'run cancelled'
    } else {
      status = 'failed'
      summary = e instanceof Error ? e.message : 'run failed'
    }
    threw = true
  } finally {
    controllers.delete(runId)
  }

  // `cancelRun` aborts the signal and waits for the kill second, and the abort
  // alone is enough to reject the workflow — so this continuation is already
  // running while the run's containers are still being removed. Nothing about
  // the run reads finished until every kill it ordered has settled, confirmed
  // or timed out. A run nobody cancelled has none in flight and passes straight
  // through.
  await killRegistry().whenRunKillsSettled(runId)
  if (threw) emit(ctx, featureId, { type: 'run.error', message: summary, runId })

  ctx.db
    .update(runs)
    .set({ status, endedAt: Date.now(), summary, ...(digest ? { digest } : {}) })
    .where(eq(runs.id, runId))
    .run()
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

/** A successful burn reaches review unless the feature was already shipped. */
function maybeAutoAdvance(ctx: AppCtx, featureId: string): void {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.phase !== 'building') return
  setPhase(ctx, featureId, 'review', 'phase.advanced', 'auto-advanced to review after successful run')
}
